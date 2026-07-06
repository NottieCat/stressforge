import OpenAI from 'openai';
import { config } from '../config.js';

/**
 * Turn scraped problem text into a StressForge `generator.cpp` via an
 * OpenAI-compatible LLM. The contract is deliberately narrow: the model either
 * returns a compiling generator that follows StressForge's conventions, or it
 * flags the problem as fixed-input (predefined cases, nothing to randomize).
 */

/** Thrown when the caller should surface a specific HTTP status. */
export class LlmError extends Error {
  constructor(message, { status = 500 } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

/** True when a usable API key is configured. Lets the route 503 gracefully. */
export function isLlmConfigured() {
  return Boolean(config.llm.apiKey);
}

// StressForge's generator convention is strict — the worker runs the generator
// once per iteration with the seed as argv[1] and pipes its stdout into the
// solutions. The prompt below pins every rule that matters for that to work.
const SYSTEM_PROMPT = `You are an expert competitive-programming test-data generator. \
You write a single C++17 program ("gen.cpp") for the StressForge stress-testing engine.

STRESSFORGE GENERATOR CONTRACT (follow exactly):
- Output ONE random, VALID test case per program run.
- The random seed is passed as argv[1]. Seed a std::mt19937 with it:
      unsigned seed = argc > 1 ? (unsigned)strtoul(argv[1], nullptr, 10) : 0;
      std::mt19937 rng(seed);
  Never read from stdin. Never use time(0)/random_device — output must be deterministic in the seed.
- Print the test case to stdout in EXACTLY the input format the problem specifies.
- Respect every constraint (value ranges, sizes, sum-of-N limits, character sets, graph validity, etc.).
- Use #include <bits/stdc++.h> and a normal int main(int argc, char** argv).

CRITICAL — MULTI-TEST PROBLEMS (hardcode T = 1):
- Many problems start with an integer T = number of test cases, then T blocks.
- You MUST NOT loop over T or emit multiple blocks. Do NOT write while(t--) or a for loop over test cases.
- Instead, print the literal number 1 as the very first line, then emit the randomized variables for a
  SINGLE isolated test case. This keeps the user's "cin >> t" loop intact while stressing one case at a time.

SAMPLES ARE NOT CONSTRAINTS (read this carefully):
- A "Sample 1" / "Sample Input" / "Example" block is ONLY an illustration to help a human understand the
  I/O format. It is NEVER the set of allowed inputs. Its specific numbers are meaningless to you beyond
  showing the layout.
- Samples are only for understanding. You must ALWAYS generate a fully randomized, dynamic C++ generator
  based on the global constraints and variable limits. If there are unique constraints like
  \`sum of N^2 <= 2000^2\`, mathematically distribute the random variables inside the test case loop to stay
  strictly within those boundaries.
  (Under the T = 1 contract above there is a single case, so such "sum over all test cases" limits apply to
  that one case: pick each variable from its own range and cap it against the global bound — e.g. draw
  N <= 2000 and ensure N*N stays within the sum limit — never emit a fixed sample value.)
- The presence of a sample, an example, or concrete example numbers is NEVER, under any circumstance, a
  reason to classify a problem as fixed-input.

FIXED-INPUT DETECTION (rare — the default is ALWAYS to write a generator):
- Set is_fixed_input = true ONLY when the problem genuinely has no variable input to randomize. Concretely,
  ALL of these must hold: there are no numeric/array/string parameters with ranges, no "1 <= N <= ..." style
  bounds anywhere, and the task is one of: takes literally no input, is interactive, or asks for a single
  fixed/constant answer.
- If the statement contains ANY variable with a bound (N, M, values, array lengths, string sizes, T, etc.),
  it is NOT fixed-input — write the randomized generator. When in doubt, WRITE THE GENERATOR.

FIXED-INPUT DETECTION:
- If the problem has no randomizable numeric/array constraints — i.e. it expects specific predefined/static
  input (an exact given grid, a fixed sequence, "no input", interactive, or answer-only) — do NOT write a generator.
  Return is_fixed_input = true and code = null.

OUTPUT FORMAT:
- Respond with a JSON object ONLY, matching: {"is_fixed_input": boolean, "code": string|null}.
- When is_fixed_input is false, "code" is the full gen.cpp source as a string (no markdown fences).
- When is_fixed_input is true, "code" must be null.`;

function buildUserPrompt({ url, problemText }) {
  return `Problem URL: ${url}

Scraped problem statement / input constraints:
"""
${problemText}
"""

Write the StressForge gen.cpp for this problem, or flag it as fixed-input, per the rules.`;
}

/** Strip accidental ```json / ``` fences the model may wrap around content. */
function stripFences(s) {
  return s
    .trim()
    .replace(/^```(?:json|cpp|c\+\+)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * Parse the model's reply into { is_fixed_input, code }. Tolerates a bare code
 * block or fenced JSON in case the model ignores response_format.
 */
function parseResult(content) {
  const raw = stripFences(content || '');
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    // Some models return the C++ directly; treat that as a code payload.
    if (raw.includes('int main')) return { is_fixed_input: false, code: raw };
    throw new LlmError('LLM returned an unparseable response.', { status: 502 });
  }

  const isFixed = obj.is_fixed_input === true;
  if (isFixed) return { is_fixed_input: true, code: null };

  const code = typeof obj.code === 'string' ? stripFences(obj.code) : '';
  if (!code || !code.includes('int main')) {
    throw new LlmError('LLM did not produce a valid generator program.', { status: 502 });
  }
  return { is_fixed_input: false, code };
}

/**
 * Generate a gen.cpp from scraped problem text.
 * @param {{ url: string, problemText: string }} problem
 * @returns {Promise<{ is_fixed_input: boolean, code: string|null }>}
 */
export async function generateGenerator(problem) {
  if (!isLlmConfigured()) {
    throw new LlmError(
      'Auto-Parser is not configured. Set OPENAI_API_KEY (and optionally OPENAI_BASE_URL) to enable it.',
      { status: 503 },
    );
  }

  const client = new OpenAI({
    apiKey: config.llm.apiKey,
    baseURL: config.llm.baseUrl, // undefined -> api.openai.com
  });

  let completion;
  try {
    completion = await client.chat.completions.create({
      model: config.llm.model,
      temperature: 0.2,
      // Ask for JSON; harmless if an OpenAI-compatible provider ignores it,
      // since parseResult also tolerates fenced/bare output.
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(problem) },
      ],
    });
  } catch (err) {
    // Normalize provider/auth/rate errors into something the route can relay.
    const status = err?.status === 401 || err?.status === 403 ? 503 : 502;
    throw new LlmError(`LLM request failed: ${err?.message || 'unknown error'}`, { status });
  }

  const content = completion?.choices?.[0]?.message?.content;
  if (!content) throw new LlmError('LLM returned an empty response.', { status: 502 });

  return parseResult(content);
}

export default generateGenerator;
