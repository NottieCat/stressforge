// Shape of the stress-run record returned by the StressForge backend.
// Mirrors what the worker writes via saveResult() for kind === "stress".

export type Verdict =
  | "Accepted"
  | "Mismatch"
  | "Time Limit Exceeded"
  | "Runtime Error"
  | "Compilation Error"
  | "Generator Error"
  | "Wrong Answer"
  | "No Crash (unchecked)";

export type RunStatus = "queued" | "running" | "done";

export interface FailingCase {
  iteration: number;
  seed: number;
  input?: string;
  expected?: string;
  actual?: string;
  observedMs?: number;
  timeLimitMs?: number;
  reason?: string;
  overflowSuspected?: boolean;
}

export interface PerIter {
  i: number;
  seed: number;
  status: "ok" | "skipped";
  timeMs: number;
}

export interface StressResult {
  id: string;
  status: RunStatus;
  mode?: "stress";
  verdict?: Verdict | null;
  which?: "generator" | "brute" | "optimized";
  message?: string;
  compilerOutput?: string;
  iterations?: number;
  iterationsPassed?: number;
  maxTimeMs?: number;
  seedStart?: number;
  phase?: string;
  log?: string[];
  perIter?: PerIter[];
  failingCase?: FailingCase;
  createdAt?: string;
  updatedAt?: string;
}

export interface StressRequest {
  generator: { sourceCode: string };
  brute: { sourceCode: string };
  optimized: { sourceCode: string };
  iterations: number;
  timeLimitMs?: number;
  seedStart?: number;
}

// The four editor slots. `schema` isn't used in gen mode but kept for clarity.
export type EditorKey = "generator" | "brute" | "optimized";

/* ------------------------------------------------------------------ *
 * Submission mode: run the optimized solution over explicit stdin
 * inputs (paste/upload), optionally diffed against a reference oracle.
 * ------------------------------------------------------------------ */

export type CaseStatus = "ok" | "wa" | "tle" | "re" | "unchecked";

export interface SubmissionCase {
  index: number;
  status: CaseStatus;
  input: string;
  output?: string;
  expected?: string;
  timeMs: number;
  observedMs?: number;
  timeLimitMs?: number;
  reason?: string;
  overflowSuspected?: boolean;
}

export interface SubmissionResult {
  id: string;
  status: RunStatus;
  mode?: "submission";
  verdict?: Verdict | null;
  which?: "optimized" | "reference";
  message?: string;
  compilerOutput?: string;
  hasReference?: boolean;
  testsRun?: number;
  testsPassed?: number;
  maxTimeMs?: number;
  cases?: SubmissionCase[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SubmissionRequest {
  sourceCode: string;
  tests: string[];
  reference?: { sourceCode: string };
  timeLimitMs?: number;
}
