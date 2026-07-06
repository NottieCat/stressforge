import type {
  GenerateScriptResponse,
  StressRequest,
  StressResult,
  SubmissionRequest,
  SubmissionResult,
} from "./types";

const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:3000"
).replace(/\/$/, "");

/** Error carrying the HTTP status and any structured validation details. */
export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Submit a stress run. Returns the new job id. */
export async function submitStress(
  body: StressRequest,
  signal?: AbortSignal,
): Promise<{ id: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/stress`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    // Network-level failure (backend down, CORS, DNS). Give an actionable hint.
    throw new ApiError(
      `Cannot reach the StressForge API at ${API_BASE}. Is the backend running? (npm run start:api)`,
      0,
      e instanceof Error ? e.message : String(e),
    );
  }

  const data = (await parseJsonSafe(res)) as
    | { id?: string; error?: string; details?: unknown }
    | null;

  if (!res.ok || !data?.id) {
    throw new ApiError(
      data?.error || `Submission failed (HTTP ${res.status})`,
      res.status,
      data?.details,
    );
  }
  return { id: data.id };
}

/** Fetch the current record for a stress run. */
export async function getStress(
  id: string,
  signal?: AbortSignal,
): Promise<StressResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/stress/${id}`, { signal });
  } catch (e) {
    throw new ApiError(
      `Lost connection to the StressForge API at ${API_BASE}.`,
      0,
      e instanceof Error ? e.message : String(e),
    );
  }
  if (res.status === 404) {
    throw new ApiError("Run not found or expired.", 404);
  }
  const data = (await parseJsonSafe(res)) as StressResult | null;
  if (!res.ok || !data) {
    throw new ApiError(`Failed to fetch run (HTTP ${res.status})`, res.status);
  }
  return data;
}

/** Submit an explicit-inputs submission run. Returns the new job id. */
export async function submitSubmission(
  body: SubmissionRequest,
  signal?: AbortSignal,
): Promise<{ id: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw new ApiError(
      `Cannot reach the StressForge API at ${API_BASE}. Is the backend running? (npm run start:api)`,
      0,
      e instanceof Error ? e.message : String(e),
    );
  }

  const data = (await parseJsonSafe(res)) as
    | { id?: string; error?: string; details?: unknown }
    | null;

  if (!res.ok || !data?.id) {
    throw new ApiError(
      data?.error || `Submission failed (HTTP ${res.status})`,
      res.status,
      data?.details,
    );
  }
  return { id: data.id };
}

/** Fetch the current record for a submission run. */
export async function getSubmission(
  id: string,
  signal?: AbortSignal,
): Promise<SubmissionResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/submissions/${id}`, { signal });
  } catch (e) {
    throw new ApiError(
      `Lost connection to the StressForge API at ${API_BASE}.`,
      0,
      e instanceof Error ? e.message : String(e),
    );
  }
  if (res.status === 404) {
    throw new ApiError("Run not found or expired.", 404);
  }
  const data = (await parseJsonSafe(res)) as SubmissionResult | null;
  if (!res.ok || !data) {
    throw new ApiError(`Failed to fetch run (HTTP ${res.status})`, res.status);
  }
  return data;
}

/**
 * Auto-Parser: send a problem URL, get back a generated gen.cpp or a
 * fixed-input flag. Synchronous on the backend (scrape + LLM, no queue).
 */
export async function generateScript(
  url: string,
  signal?: AbortSignal,
): Promise<GenerateScriptResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/generate-script`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
      signal,
    });
  } catch (e) {
    throw new ApiError(
      `Cannot reach the StressForge API at ${API_BASE}. Is the backend running? (npm run start:api)`,
      0,
      e instanceof Error ? e.message : String(e),
    );
  }

  const data = (await parseJsonSafe(res)) as
    | (GenerateScriptResponse & { error?: string; details?: unknown })
    | null;

  if (!res.ok || !data) {
    throw new ApiError(
      data?.error || `Auto-generate failed (HTTP ${res.status})`,
      res.status,
      data?.details,
    );
  }
  return { is_fixed_input: !!data.is_fixed_input, code: data.code ?? null };
}

export { API_BASE };
