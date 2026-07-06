import { Worker } from 'bullmq';
import { config } from '../config.js';
import { createRedisConnection } from '../queue/connection.js';
import { saveResult } from '../queue/resultStore.js';
import { VERDICTS } from '../shared/schema.js';
import { generateTestCases } from './testGenerator.js';
import {
  createWorkDir,
  cleanupWorkDir,
  writeSource,
  compileInSandbox,
  runBatchInSandbox,
  runGeneratorBatch,
} from './sandbox.js';

/** Normalize output for comparison: trim trailing whitespace per line + overall. */
function normalizeOutput(s) {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '');
}

/**
 * Core pipeline for a single submission:
 *   1. parse schema -> generate test inputs
 *   2. compile candidate (and reference, if any) in the sandbox
 *   3. run each test input in a fresh ephemeral container
 *   4. if a reference exists, diff outputs -> verdict; else report crash-only
 *   5. aggregate into a verdict + the first failing case for reproduction
 */
async function processSubmission(job) {
  const submission = job.data;
  const { id } = submission;
  const timeLimitMs = submission.timeLimitMs || config.sandbox.runTimeoutMs;
  const seed = submission.seed ?? (Number.parseInt(id.replace(/\D/g, '').slice(0, 8) || '1', 10) || 1);

  await saveResult(id, { status: 'running' });

  // Two input sources: an explicit list of stdin blobs (paste/upload mode), or
  // a typed schema the generator fuzzes. Explicit mode runs EVERY case so the
  // caller sees each output; schema mode stops on the first failure.
  const explicit = Array.isArray(submission.tests);
  const tests = explicit
    ? submission.tests.map((stdin, index) => ({ index, kind: 'explicit', stdin }))
    : generateTestCases(submission.schema, config.testCaseCount, seed);
  const workDir = await createWorkDir();

  try {
    // --- Compile candidate ---
    await writeSource(workDir, 'candidate.cpp', submission.sourceCode);
    const cand = await compileInSandbox(workDir, 'candidate.cpp', 'candidate.bin');
    if (!cand.ok) {
      return finalize(id, {
        mode: explicit ? 'submission' : undefined,
        verdict: VERDICTS.COMPILE_ERROR,
        which: 'optimized',
        message: cand.timedOut ? 'Compilation timed out' : 'Candidate failed to compile',
        compilerOutput: cand.stderr.slice(0, 4000),
      });
    }

    // --- Compile optional reference ---
    let hasReference = false;
    if (submission.reference?.sourceCode) {
      await writeSource(workDir, 'reference.cpp', submission.reference.sourceCode);
      const ref = await compileInSandbox(workDir, 'reference.cpp', 'reference.bin');
      if (!ref.ok) {
        return finalize(id, {
          mode: explicit ? 'submission' : undefined,
          verdict: VERDICTS.COMPILE_ERROR,
          which: 'reference',
          message: 'Reference solution failed to compile',
          compilerOutput: ref.stderr.slice(0, 4000),
        });
      }
      hasReference = true;
    }

    // --- Run every test case (batched: one container per binary) ---
    const candRuns = await runBatchInSandbox(workDir, 'candidate.bin', tests.map((t) => t.stdin), { timeoutMs: timeLimitMs, stopOnFailure: !explicit });
    // Reference gets a looser per-case limit; a slow-but-correct oracle is fine.
    const refRuns = hasReference
      ? await runBatchInSandbox(workDir, 'reference.bin', tests.map((t) => t.stdin), { timeoutMs: timeLimitMs * 4 })
      : null;

    // Explicit mode: report the full per-case table rather than one verdict.
    if (explicit) {
      return finalizeExplicitCases(id, { tests, candRuns, refRuns, hasReference, timeLimitMs });
    }

    let maxTimeMs = 0;
    let passed = 0;
    for (const tc of tests) {
      const candRun = candRuns[tc.index];
      maxTimeMs = Math.max(maxTimeMs, candRun.timeMs || 0);

      if (candRun.status === 'tle') {
        return finalize(id, failingVerdict(VERDICTS.TIME_LIMIT_EXCEEDED, tc, {
          observedMs: Math.round(candRun.timeMs), timeLimitMs,
        }, tests.length, passed, maxTimeMs));
      }
      if (candRun.status === 're') {
        return finalize(id, failingVerdict(VERDICTS.RUNTIME_ERROR, tc, {
          reason: candRun.reason,
        }, tests.length, passed, maxTimeMs));
      }
      if (candRun.status === 'error') {
        return finalize(id, {
          verdict: VERDICTS.RUNTIME_ERROR,
          message: `Sandbox error: ${candRun.message}`,
        });
      }

      // Correctness check requires a reference oracle.
      if (hasReference) {
        const refRun = refRuns[tc.index];
        if (refRun.status !== 'ok') {
          // Reference itself misbehaved on this input — skip, don't blame candidate.
          continue;
        }
        if (normalizeOutput(candRun.stdout) !== normalizeOutput(refRun.stdout)) {
          return finalize(id, failingVerdict(VERDICTS.WRONG_ANSWER, tc, {
            expected: normalizeOutput(refRun.stdout).slice(0, 2000),
            got: normalizeOutput(candRun.stdout).slice(0, 2000),
          }, tests.length, passed, maxTimeMs));
        }
      }
      passed += 1;
    }

    return finalize(id, {
      verdict: hasReference ? VERDICTS.ACCEPTED : VERDICTS.NO_CRASH,
      testsRun: tests.length,
      testsPassed: passed,
      maxTimeMs: Math.round(maxTimeMs),
      seed,
    });
  } finally {
    await cleanupWorkDir(workDir);
  }
}

function failingVerdict(verdict, tc, detail, total, passed, maxTimeMs) {
  return {
    verdict,
    testsRun: passed + 1,
    testsPassed: passed,
    maxTimeMs: Math.round(maxTimeMs),
    failingCase: {
      index: tc.index,
      kind: tc.kind,
      stdin: tc.stdin.slice(0, 4000),
      ...detail,
    },
  };
}

async function finalize(id, payload) {
  const record = await saveResult(id, { status: 'done', ...payload });
  return record;
}

/**
 * Explicit-input submission: build a per-case table (input / candidate output /
 * expected) instead of returning on the first failure, so the caller can see
 * how the solution handled every provided test. The overall verdict is the
 * worst status observed across all cases.
 */
function finalizeExplicitCases(id, { tests, candRuns, refRuns, hasReference, timeLimitMs }) {
  const cases = [];
  let passed = 0;
  let maxTimeMs = 0;
  let anyTLE = false;
  let anyRE = false;
  let anyWA = false;

  for (const tc of tests) {
    const cand = candRuns[tc.index];
    const timeMs = Math.round(cand.timeMs || 0);
    maxTimeMs = Math.max(maxTimeMs, cand.timeMs || 0);
    const base = { index: tc.index, input: tc.stdin.slice(0, 4000), timeMs };

    if (cand.status === 'tle') {
      anyTLE = true;
      cases.push({ ...base, status: 'tle', observedMs: timeMs, timeLimitMs, output: (cand.stdout || '').slice(0, 4000) });
      continue;
    }
    if (cand.status === 're' || cand.status === 'error') {
      anyRE = true;
      cases.push({ ...base, status: 're', reason: cand.reason || cand.message || 'runtime error', output: (cand.stdout || '').slice(0, 4000) });
      continue;
    }

    const output = normalizeOutput(cand.stdout);
    if (!hasReference) {
      passed += 1;
      cases.push({ ...base, status: 'ok', output: output.slice(0, 4000) });
      continue;
    }

    const ref = refRuns[tc.index];
    if (!ref || ref.status !== 'ok') {
      // The oracle itself misbehaved on this input — can't judge correctness.
      cases.push({ ...base, status: 'unchecked', output: output.slice(0, 4000), reason: 'reference failed on this input' });
      continue;
    }
    const expected = normalizeOutput(ref.stdout);
    if (expected !== output) {
      anyWA = true;
      cases.push({ ...base, status: 'wa', output: output.slice(0, 4000), expected: expected.slice(0, 4000), overflowSuspected: overflowHeuristic(expected, output) });
    } else {
      passed += 1;
      cases.push({ ...base, status: 'ok', output: output.slice(0, 4000), expected: expected.slice(0, 4000) });
    }
  }

  const verdict = anyTLE
    ? VERDICTS.TIME_LIMIT_EXCEEDED
    : anyRE
      ? VERDICTS.RUNTIME_ERROR
      : hasReference
        ? anyWA
          ? VERDICTS.WRONG_ANSWER
          : VERDICTS.ACCEPTED
        : VERDICTS.NO_CRASH;

  return finalize(id, {
    mode: 'submission',
    verdict,
    hasReference,
    testsRun: tests.length,
    testsPassed: passed,
    maxTimeMs: Math.round(maxTimeMs),
    cases,
  });
}

/* ------------------------------------------------------------------ *
 * Stress-test mode: gen.cpp -> brute vs optimized, diff per iteration.
 * ------------------------------------------------------------------ */

/**
 * Heuristic flag for an integer-overflow-looking mismatch: both outputs are
 * pure integers that disagree, and either the sign flipped or they differ by
 * more than 2^31 — the classic 32-bit wrap signature. Reported as *suspected*;
 * the mismatch itself is the ground truth.
 */
function overflowHeuristic(expected, actual) {
  const e = expected.trim();
  const a = actual.trim();
  if (!/^-?\d+$/.test(e) || !/^-?\d+$/.test(a)) return false;
  try {
    const ev = BigInt(e);
    const av = BigInt(a);
    if (ev === av) return false;
    const signFlip = ev < 0n !== av < 0n;
    const diff = ev > av ? ev - av : av - ev;
    return signFlip || diff > 1n << 31n;
  } catch {
    return false;
  }
}

async function stressFail(id, verdict, failingCase, ctx) {
  ctx.log.push(`✗ Counterexample at iteration ${failingCase.iteration} (seed ${failingCase.seed}) → ${verdict}`);
  return finalize(id, {
    mode: 'stress',
    verdict,
    iterations: ctx.iterations,
    iterationsPassed: ctx.passed,
    maxTimeMs: Math.round(ctx.maxTimeMs),
    failingCase,
    log: ctx.log.slice(-300),
    perIter: ctx.perIter.slice(-300),
  });
}

async function processStress(job) {
  const s = job.data;
  const { id } = s;
  const timeLimitMs = s.timeLimitMs || config.sandbox.runTimeoutMs;
  const iterations = s.iterations;
  const seedStart = s.seedStart ?? 1;
  const seeds = Array.from({ length: iterations }, (_, i) => seedStart + i);

  const log = [];
  const pushLog = async (line, extra = {}) => {
    log.push(line);
    await saveResult(id, { status: 'running', mode: 'stress', iterations, log: log.slice(-300), ...extra });
  };

  const workDir = await createWorkDir();
  try {
    await pushLog('Compiling generator, brute-force, and optimized solutions…', { phase: 'compile' });
    await writeSource(workDir, 'gen.cpp', s.generator.sourceCode);
    await writeSource(workDir, 'brute.cpp', s.brute.sourceCode);
    await writeSource(workDir, 'optimized.cpp', s.optimized.sourceCode);

    for (const [label, src, out, which] of [
      ['generator', 'gen.cpp', 'gen.bin', 'generator'],
      ['brute-force', 'brute.cpp', 'brute.bin', 'brute'],
      ['optimized', 'optimized.cpp', 'optimized.bin', 'optimized'],
    ]) {
      const c = await compileInSandbox(workDir, src, out);
      if (!c.ok) {
        log.push(`✗ The ${label} solution failed to compile`);
        return finalize(id, {
          mode: 'stress',
          verdict: VERDICTS.COMPILE_ERROR,
          which,
          message: c.timedOut ? `${label} compilation timed out` : `The ${label} solution failed to compile`,
          compilerOutput: c.stderr.slice(0, 4000),
          log: log.slice(-300),
        });
      }
    }
    await pushLog('Compiled all three solutions ✓');

    await pushLog(`Generating ${iterations} tests (seeds ${seedStart}‥${seedStart + iterations - 1})…`, { phase: 'generate' });
    const genRuns = await runGeneratorBatch(workDir, 'gen.bin', seeds, { timeoutMs: Math.max(timeLimitMs, 5000) });
    const inputs = genRuns.map((g) => g.stdout || '');

    await pushLog('Running brute-force oracle over all inputs…', { phase: 'brute' });
    const bruteRuns = await runBatchInSandbox(workDir, 'brute.bin', inputs, { timeoutMs: timeLimitMs * 4 });

    await pushLog('Running optimized solution over all inputs…', { phase: 'optimized' });
    const optRuns = await runBatchInSandbox(workDir, 'optimized.bin', inputs, { timeoutMs: timeLimitMs, stopOnFailure: true });

    await pushLog('Diffing outputs…', { phase: 'compare' });

    const ctx = { iterations, passed: 0, maxTimeMs: 0, log, perIter: [] };
    for (let i = 0; i < iterations; i++) {
      const g = genRuns[i];
      const b = bruteRuns[i];
      const o = optRuns[i];
      const seed = seeds[i];

      if (!g || g.status !== 'ok') {
        return stressFail(id, VERDICTS.GENERATOR_ERROR, {
          iteration: i, seed,
          reason: g?.reason || `generator ${g?.status || 'produced no output'}`,
          input: (g?.stdout || '').slice(0, 4000),
        }, ctx);
      }

      ctx.maxTimeMs = Math.max(ctx.maxTimeMs, o?.timeMs || 0);

      if (o.status === 'tle') {
        return stressFail(id, VERDICTS.TIME_LIMIT_EXCEEDED, {
          iteration: i, seed, observedMs: Math.round(o.timeMs), timeLimitMs,
          input: g.stdout.slice(0, 4000),
          expected: b?.status === 'ok' ? normalizeOutput(b.stdout).slice(0, 4000) : undefined,
        }, ctx);
      }
      if (o.status === 're') {
        return stressFail(id, VERDICTS.RUNTIME_ERROR, {
          iteration: i, seed, reason: o.reason,
          input: g.stdout.slice(0, 4000),
        }, ctx);
      }
      if (o.status === 'error') {
        return finalize(id, { mode: 'stress', verdict: VERDICTS.RUNTIME_ERROR, message: `Sandbox error: ${o.message}`, log: log.slice(-300) });
      }

      // Need a healthy oracle output to judge correctness.
      if (!b || b.status !== 'ok') {
        ctx.perIter.push({ i, seed, status: 'skipped', timeMs: Math.round(o.timeMs || 0) });
        continue;
      }

      const expected = normalizeOutput(b.stdout);
      const actual = normalizeOutput(o.stdout);
      if (expected !== actual) {
        return stressFail(id, VERDICTS.MISMATCH, {
          iteration: i, seed,
          input: g.stdout.slice(0, 4000),
          expected: expected.slice(0, 4000),
          actual: actual.slice(0, 4000),
          overflowSuspected: overflowHeuristic(expected, actual),
        }, ctx);
      }

      ctx.passed += 1;
      ctx.perIter.push({ i, seed, status: 'ok', timeMs: Math.round(o.timeMs || 0) });
    }

    log.push(`✓ All ${iterations} iterations matched the brute-force oracle`);
    return finalize(id, {
      mode: 'stress',
      verdict: VERDICTS.ACCEPTED,
      iterations,
      iterationsPassed: ctx.passed,
      maxTimeMs: Math.round(ctx.maxTimeMs),
      seedStart,
      log: log.slice(-300),
      perIter: ctx.perIter.slice(-300),
    });
  } finally {
    await cleanupWorkDir(workDir);
  }
}

/** Route a job to the right pipeline based on its kind. */
function processJob(job) {
  return job.data?.kind === 'stress' ? processStress(job) : processSubmission(job);
}

const worker = new Worker(config.queueName, processJob, {
  connection: createRedisConnection(),
  concurrency: config.workerConcurrency,
});

worker.on('completed', (job) => {
  console.log(`[worker] ${job.id} -> ${job.returnvalue?.verdict}`);
});
worker.on('failed', async (job, err) => {
  console.error(`[worker] ${job?.id} FAILED:`, err.message);
  if (job?.id) {
    await saveResult(job.id, {
      status: 'done',
      verdict: VERDICTS.RUNTIME_ERROR,
      message: `Worker error: ${err.message}`,
    }).catch(() => {});
  }
});

console.log(`[worker] StressForge worker up (concurrency=${config.workerConcurrency}, queue=${config.queueName})`);

async function shutdown() {
  console.log('[worker] shutting down...');
  await worker.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
