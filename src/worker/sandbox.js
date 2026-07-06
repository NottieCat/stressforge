import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';

/**
 * Docker sandbox runner for untrusted C++.
 *
 * Isolation posture applied to every ephemeral container:
 *   --network none            no egress/DNS at all
 *   --memory / --cpus         cgroup memory + CPU quotas (hard caps)
 *   --pids-limit              fork-bomb containment
 *   --cap-drop ALL            no Linux capabilities
 *   --security-opt no-new-privileges  block setuid escalation
 *   --read-only rootfs + tmpfs /tmp   nothing persisted, no rootfs writes
 *   --user <uid:gid>          runs unprivileged (mapped to host user)
 *   ulimit cpu / fsize / nproc secondary kernel-enforced ceilings
 *   default seccomp profile   syscall filtering (Docker's built-in)
 *
 * NOTE: this is strong, defense-in-depth isolation — not a formal guarantee.
 * See README "Security model" for the honest threat-model caveats.
 */

const uid = typeof process.getuid === 'function' ? process.getuid() : null;
const gid = typeof process.getgid === 'function' ? process.getgid() : null;

function randomName() {
  return `sf-${randomBytes(6).toString('hex')}`;
}

/**
 * Run a docker CLI invocation, streaming `input` to stdin and capping captured
 * output. Enforces a wall-clock timeout by `docker kill`-ing the named
 * container (the CLI child alone lingering would not stop the container).
 */
function runDocker(args, { input = '', timeoutMs, containerName, maxOutputBytes = config.sandbox.maxOutputBytes } = {}) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let out = Buffer.alloc(0);
    let err = Buffer.alloc(0);
    let outTruncated = false;
    let timedOut = false;
    let killed = false;

    const capture = (bufName, chunk) => {
      if (bufName === 'out') {
        if (out.length >= maxOutputBytes) { outTruncated = true; return; }
        out = Buffer.concat([out, chunk]).subarray(0, maxOutputBytes);
      } else {
        if (err.length < maxOutputBytes) err = Buffer.concat([err, chunk]).subarray(0, maxOutputBytes);
      }
    };

    child.stdout.on('data', (c) => capture('out', c));
    child.stderr.on('data', (c) => capture('err', c));

    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killed = true;
          if (containerName) {
            // Detached best-effort kill; --rm cleans the container up.
            spawn('docker', ['kill', containerName], { stdio: 'ignore' });
          }
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;

    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ spawnError: e.message, timedOut, exitCode: null, stdout: '', stderr: e.message, timeMs: 0, outTruncated });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const timeMs = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({
        exitCode: code,
        timedOut,
        killed,
        stdout: out.toString('utf8'),
        stderr: err.toString('utf8'),
        timeMs,
        outTruncated,
      });
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

/** Create an isolated per-submission work directory on the host. */
export async function createWorkDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stressforge-'));
  return dir;
}

export async function cleanupWorkDir(dir) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

const baseSandboxArgs = (workDir, { readOnlyWork }) => {
  const args = [
    'run', '--rm',
    // -i attaches stdin so piped test-case input reaches the program. Without
    // it the container's stdin is closed, the program reads EOF immediately,
    // and (for well-guarded code) exits with no output — which silently makes
    // every candidate "match" an equally-empty reference. Critical.
    '-i',
    '--network', 'none',
    '--memory', config.sandbox.memoryLimit,
    '--memory-swap', config.sandbox.memoryLimit, // disallow swap => real mem cap
    '--cpus', String(config.sandbox.cpuLimit),
    '--pids-limit', '128',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    '--tmpfs', '/tmp:rw,size=64m,noexec',
    '--ulimit', 'fsize=67108864', // 64 MiB max file size
    '--ulimit', 'nproc=256',
  ];
  if (uid !== null && gid !== null) args.push('--user', `${uid}:${gid}`);
  // Work dir mounted read-only for the run step; writable only to compile.
  args.push('-v', `${workDir}:/work${readOnlyWork ? ':ro' : ''}`);
  return args;
};

/**
 * Compile a C++ source file (already written into `workDir`) to a binary,
 * inside the sandbox. Returns { ok, stderr }.
 */
export async function compileInSandbox(workDir, srcFile, outName) {
  const name = randomName();
  // CPU ulimit as a secondary guard on runaway compiles.
  const cpuSecs = Math.ceil(config.sandbox.compileTimeoutMs / 1000) + 1;
  const args = [
    ...baseSandboxArgs(workDir, { readOnlyWork: false }),
    '--ulimit', `cpu=${cpuSecs}`,
    '--name', name,
    config.sandbox.image,
    'g++', '-O2', '-std=c++17', '-static', '-s',
    '-o', `/work/${outName}`, `/work/${srcFile}`,
  ];
  const res = await runDocker(args, {
    timeoutMs: config.sandbox.compileTimeoutMs,
    containerName: name,
  });
  const ok = !res.spawnError && !res.timedOut && res.exitCode === 0;
  return { ok, stderr: res.stderr || res.spawnError || '', timedOut: res.timedOut };
}

/**
 * Execute a compiled binary in a fresh ephemeral container against one stdin
 * blob. Returns a normalized result the worker maps to a verdict.
 */
export async function runInSandbox(workDir, binName, stdin, { timeoutMs } = {}) {
  const name = randomName();
  const wall = timeoutMs || config.sandbox.runTimeoutMs;
  const cpuSecs = Math.ceil(wall / 1000) + 1; // kernel CPU-time backstop
  // We must NOT time the whole `docker run`: container startup adds hundreds of
  // ms (seconds under a concurrent container storm, esp. on Docker Desktop),
  // which would falsely flag fast programs as TLE. Instead a tiny shell wrapper
  // times the program *inside* the container and prints elapsed ms on stderr
  // behind a sentinel. The host-side timeout stays only as a hard-kill backstop
  // for genuine infinite loops.
  const inner =
    `s=$(date +%s%N); /work/${binName}; rc=$?; ` +
    `e=$(date +%s%N); echo "__SF_MS__$(( (e - s)/1000000 ))" 1>&2; exit $rc`;
  const args = [
    ...baseSandboxArgs(workDir, { readOnlyWork: true }),
    '--ulimit', `cpu=${cpuSecs}`,
    '--name', name,
    config.sandbox.image,
    'sh', '-c', inner,
  ];
  // Backstop timeout = program limit + generous startup headroom.
  const backstopMs = wall + 8000;
  const res = await runDocker(args, {
    input: stdin,
    timeoutMs: backstopMs,
    containerName: name,
  });

  if (res.spawnError) {
    return { status: 'error', message: res.spawnError, timeMs: res.timeMs };
  }

  // Extract the in-container elapsed time and strip the sentinel from stderr.
  let innerMs = null;
  let stderr = res.stderr;
  const m = stderr.match(/__SF_MS__(\d+)/);
  if (m) {
    innerMs = Number(m[1]);
    stderr = stderr.replace(/__SF_MS__\d+\s*/g, '');
  }
  // Prefer the in-container measurement; fall back to wall time if the wrapper
  // never got to print (e.g. it was hard-killed).
  const timeMs = innerMs ?? res.timeMs;

  if (res.timedOut || timeMs > wall) {
    return { status: 'tle', timeMs, stdout: res.stdout, stderr };
  }
  if (res.exitCode !== 0) {
    // 137 == 128+SIGKILL: usually the cgroup OOM-killer (memory limit).
    const reason = res.exitCode === 137 ? 'killed (memory limit / OOM)' : `exit ${res.exitCode}`;
    return { status: 're', exitCode: res.exitCode, reason, timeMs, stdout: res.stdout, stderr };
  }
  return {
    status: 'ok',
    timeMs,
    stdout: res.stdout,
    stderr,
    outTruncated: res.outTruncated,
  };
}

export async function writeSource(workDir, filename, source) {
  await fs.writeFile(path.join(workDir, filename), source, 'utf8');
}

/**
 * Parse the harness's per-iteration lines
 *   __SFCASE__|<index>|<rc>|<ms>|<base64 stdout>
 * into normalized run results, filling gaps (batch hard-killed partway) with a
 * TLE placeholder. Shared by both the stdin batch and the generator batch.
 */
function parseBatchOutput(stdout, count, wall) {
  const byIndex = new Map();
  for (const line of stdout.split('\n')) {
    const m = line.match(/^__SFCASE__\|(\d+)\|(\d+)\|(\d+)\|(.*)$/);
    if (!m) continue;
    const index = Number(m[1]);
    const rc = Number(m[2]);
    const timeMs = Number(m[3]);
    const out = Buffer.from(m[4], 'base64').toString('utf8');

    let entry;
    if (rc === 124 || timeMs >= wall) {
      entry = { index, status: 'tle', timeMs, stdout: out };
    } else if (rc !== 0) {
      const reason = rc === 137 ? 'killed (memory limit / OOM)' : `exit/signal ${rc}`;
      entry = { index, status: 're', exitCode: rc, reason, timeMs, stdout: out };
    } else {
      entry = { index, status: 'ok', timeMs, stdout: out };
    }
    byIndex.set(index, entry);
  }
  return Array.from({ length: count }, (_, index) =>
    byIndex.get(index) || { index, status: 'tle', timeMs: wall, stdout: '', reason: 'batch aborted before case ran' }
  );
}

/**
 * Run a compiled binary against MANY test-case stdins inside ONE container.
 *
 * Why batch: on Docker Desktop a cold `docker run` costs ~1-2s of pure startup.
 * One container per case (50 for a 25-case submission) makes latency dominated
 * by container churn, not by the code under test. Looping inside a single
 * container amortizes that to one start per binary while preserving per-case
 * isolation: each case still runs as a fresh process under its own `timeout`,
 * and the cgroup mem/cpu/pids caps bound the whole container.
 *
 * base64 framing avoids any collision between program output and our sentinel;
 * per-case output is truncated to maxOutputBytes before encoding.
 *
 * @returns {Array<{index,status,timeMs,stdout,exitCode?,reason?}>}
 */
export async function runBatchInSandbox(workDir, binName, stdinList, { timeoutMs, stopOnFailure = false } = {}) {
  const wall = timeoutMs || config.sandbox.runTimeoutMs;
  const tSecs = (wall / 1000).toFixed(3);
  const maxB = config.sandbox.maxOutputBytes;
  const n = stdinList.length;

  // Inputs are written host-side into a subdir that is bind-mounted read-only.
  const inputsDir = path.join(workDir, 'inputs');
  await fs.mkdir(inputsDir, { recursive: true });
  await Promise.all(stdinList.map((s, i) => fs.writeFile(path.join(inputsDir, `${i}.in`), s, 'utf8')));

  // -k 2: after TERM at `tSecs`, send KILL 2s later if still alive.
  // `timeout` returns 124 on a triggered timeout, the program's own code otherwise.
  // When stopOnFailure is set (candidate runs), break on the first non-zero rc:
  // the worker returns on the first failing case anyway, so running the rest
  // would just burn wall-clock (e.g. an infinite loop timing out 25×).
  const harness = [
    `n=${n}; i=0`,
    'while [ $i -lt $n ]; do',
    '  s=$(date +%s%N)',
    `  timeout -k 2 -s TERM ${tSecs}s /work/${binName} < /work/inputs/$i.in > /tmp/o 2>/dev/null`,
    '  rc=$?',
    '  e=$(date +%s%N)',
    `  head -c ${maxB} /tmp/o > /tmp/oc`,
    '  printf "__SFCASE__|%d|%d|%d|" $i $rc $(( (e - s) / 1000000 ))',
    '  base64 -w0 /tmp/oc',
    '  printf "\\n"',
    stopOnFailure ? '  [ $rc -ne 0 ] && break' : '  :',
    '  i=$((i+1))',
    'done',
  ].join('\n');

  const name = randomName();
  const args = [
    ...baseSandboxArgs(workDir, { readOnlyWork: true }),
    '--name', name,
    config.sandbox.image,
    'sh', '-c', harness,
  ];
  // Backstop = worst case every one of n cases runs to the full limit + kill
  // grace, plus container startup headroom. Purely a safety net.
  const backstopMs = n * (wall + 2500) + 15000;
  const res = await runDocker(args, {
    timeoutMs: backstopMs,
    containerName: name,
    maxOutputBytes: maxB * n + 1024 * n, // combined base64 exceeds a single cap
  });

  if (res.spawnError) {
    return stdinList.map((_, index) => ({ index, status: 'error', message: res.spawnError, timeMs: 0 }));
  }
  return parseBatchOutput(res.stdout, n, wall);
}

/**
 * Run a generator binary N times inside ONE container, once per seed, passing
 * the seed as argv[1]. Each run's stdout IS the generated test input, returned
 * as `stdout` on the corresponding result entry. Same batching rationale as
 * runBatchInSandbox; no stdin is attached.
 *
 * Seeds are integers (validated upstream), so inlining them into the shell
 * `for` list is injection-safe.
 *
 * @returns {Array<{index,status,timeMs,stdout,exitCode?,reason?}>}
 */
export async function runGeneratorBatch(workDir, binName, seeds, { timeoutMs } = {}) {
  const wall = timeoutMs || config.sandbox.runTimeoutMs;
  const tSecs = (wall / 1000).toFixed(3);
  const maxB = config.sandbox.maxOutputBytes;
  const n = seeds.length;
  const seedList = seeds.map((s) => String(Math.trunc(s))).join(' ');

  const harness = [
    'i=0',
    `for seed in ${seedList}; do`,
    '  s=$(date +%s%N)',
    `  timeout -k 2 -s TERM ${tSecs}s /work/${binName} "$seed" > /tmp/o 2>/dev/null`,
    '  rc=$?',
    '  e=$(date +%s%N)',
    `  head -c ${maxB} /tmp/o > /tmp/oc`,
    '  printf "__SFCASE__|%d|%d|%d|" $i $rc $(( (e - s) / 1000000 ))',
    '  base64 -w0 /tmp/oc',
    '  printf "\\n"',
    '  [ $rc -ne 0 ] && break',
    '  i=$((i+1))',
    'done',
  ].join('\n');

  const name = randomName();
  const args = [
    ...baseSandboxArgs(workDir, { readOnlyWork: true }),
    '--name', name,
    config.sandbox.image,
    'sh', '-c', harness,
  ];
  const backstopMs = n * (wall + 2500) + 15000;
  const res = await runDocker(args, {
    timeoutMs: backstopMs,
    containerName: name,
    maxOutputBytes: maxB * n + 1024 * n,
  });

  if (res.spawnError) {
    return seeds.map((_, index) => ({ index, status: 'error', message: res.spawnError, timeMs: 0 }));
  }
  return parseBatchOutput(res.stdout, n, wall);
}
