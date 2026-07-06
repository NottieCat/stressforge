# StressForge

A distributed code-execution engine for **algorithmic edge-case detection**. Submit an untrusted C++ solution plus a problem schema; StressForge generates boundary-biased test cases, runs the code inside isolated Docker sandboxes, and returns a verdict (`Accepted` / `Wrong Answer` / `Time Limit Exceeded` / `Runtime Error` / `Compilation Error`).

```
POST /submissions ──► Redis + BullMQ ──► Worker ──► ephemeral Docker sandbox
      (API, non-blocking)   (queue)      (N of them)   (compile once, then run
                                              │          all cases in-container)
                                    schema parser → test generator
                                              │
                              result aggregation → GET /submissions/:id
```

## Why this shape

- **Decoupling / throughput.** The API only ever talks to Redis. It validates, enqueues, and returns `202` immediately — it never blocks on a compile. Workers pull from the same BullMQ queue and scale horizontally; ingest rate is bounded by Redis, not by container spin-up. Concurrency per worker is `WORKER_CONCURRENCY`.
- **Isolation.** Execution happens in an ephemeral container with cgroup CPU/memory caps, no network, a read-only rootfs, all capabilities dropped, `no-new-privileges`, a PID limit, and a non-root user. Each test case still runs as a *fresh process* under its own `timeout` inside that container. See **Security model** for honest caveats.
- **Low latency via batching.** On Docker Desktop a cold `docker run` costs ~1–2s of pure startup. Running one container per test case (50 for a 25-case submission) would make latency dominated by container churn, not by the code under test. Instead all of a binary's cases run inside **one** container via an in-container harness — one start per binary (candidate + reference), a ~25× cut in container churn. The candidate's harness breaks on the first failing case (the worker returns there anyway), so an infinite-loop submission fails fast instead of timing out 25×.
- **Edge-case bias.** The generator front-loads boundary inputs (all-min, all-max, zero, empty/degenerate collections) before random fuzz — that's where solutions actually break. The `smoke.js` demo catches a classic `int`-overflow bug this way (the all-max case sums past 2³¹).

## Prerequisites

- Node.js ≥ 20
- Docker (the daemon must be running; the worker shells out to the `docker` CLI)

## Setup

```bash
npm install
cp .env.example .env
docker compose up -d redis      # start Redis
npm run build:sandbox           # build the g++ sandbox image
```

Run the API and a worker (two terminals, or use `npm run dev`):

```bash
npm run start:api
npm run start:worker
```

Then exercise it end-to-end:

```bash
npm run test:smoke
```

## API

### `POST /submissions`
```jsonc
{
  "sourceCode": "#include <bits/stdc++.h> ... int main(){...}",
  "schema": {
    "params": [
      { "name": "a", "type": "int[]", "lenMin": 0, "lenMax": 1000, "min": -1000, "max": 1000 }
    ]
  },
  "reference": { "sourceCode": "/* trusted brute-force */" },  // optional but needed for Wrong Answer detection
  "timeLimitMs": 2000,                                          // optional
  "seed": 42                                                    // optional; makes the test suite reproducible
}
```
Returns `202 { id, status: "queued", poll }`.

### `GET /submissions/:id`
Returns the current record. When `status: "done"`, includes `verdict`, `testsRun`, `testsPassed`, `maxTimeMs`, and — on failure — a `failingCase` with the exact stdin so you can reproduce.

## Problem schema

Parameters are emitted to the program's **stdin** in declaration order.

| Type | stdin wire format |
|------|-------------------|
| `int` `long` `double` `char` `bool` `string` | a single token / line |
| `int[]` (and other `<scalar>[]`) | a length line, then the elements space-separated |
| `int[][]` | `rows cols` line, then the grid |

Optional bounds: `min`/`max` (values), `lenMin`/`lenMax` (array & string length), `rowsMin`/`rowsMax`/`colsMin`/`colsMax` (matrices), `alphabet` (string/char sampling).

**Correctness checking requires a `reference`** — a trusted solution whose output is treated as ground truth. Without one, StressForge can only report crashes/timeouts (verdict `No Crash (unchecked)`), not `Wrong Answer`.

## Security model — read this before running untrusted code for real

The sandbox applies real, layered controls: `--network none`, cgroup `--memory`/`--cpus`, `--pids-limit`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only` rootfs with a `noexec` tmpfs, `ulimit` CPU/fsize/nproc backstops, non-root user, and Docker's default seccomp profile.

This is strong defense-in-depth, **not a 100% guarantee**. Honest caveats for an MVP:

- Containers share the host kernel. A kernel-level container escape defeats this. For hostile, internet-facing workloads use a stronger boundary (gVisor, Kata Containers, Firecracker microVMs, or per-tenant VMs).
- The worker invokes the `docker` CLI, so it needs Docker socket access — that process is effectively root-equivalent on the host and should itself be isolated.
- On Docker Desktop (macOS/Windows) containers run inside a Linux VM, so `--user <host uid>` and cgroup semantics differ slightly from native Linux; validate limits on your target platform.

Treat submitted C++ as hostile. Don't expose this API publicly without auth, rate limiting, and a hardened runtime.

## Layout

```
src/
  config.js              env + defaults
  api/server.js          Express: submit + poll
  queue/
    connection.js        ioredis factory
    producer.js          BullMQ queue + enqueue
    resultStore.js       result records in Redis (TTL'd)
  shared/schema.js       zod validation + problem-schema types + verdicts
  worker/
    worker.js            BullMQ worker + result aggregation
    testGenerator.js     seeded, boundary-biased test-case generation
    sandbox.js           Docker compile + batched run with cgroup limits
sandbox/Dockerfile       g++ execution image
scripts/smoke.js         end-to-end demo (correct / buggy / slow)
```

## Limitations (MVP)

- One stdin/stdout convention only; no custom checkers/comparators yet (float tolerance, multiple valid answers).
- Compilation happens once per submission; the same binary is reused across cases.
- All cases for a binary share one container. This is the latency win, but it also means the cgroup mem/cpu caps apply to the *container*, not to each case independently — a case that OOMs is killed (`137`) and reported, but a case that leaks without freeing could pressure a later case in the same batch. For adversarial per-case memory accounting you'd go back to one container per case (or one-shot the batch and re-run suspects in isolation).
- No auth/rate-limiting on the API.
- Results are stored in Redis with a 24h TTL, not a durable DB.
- Tuned/verified on Docker Desktop for macOS; cgroup and `--user` semantics differ slightly on native Linux — re-check limits there.
