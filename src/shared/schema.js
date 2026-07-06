import { z } from 'zod';

/**
 * A single parameter in a problem schema. Parameters are emitted to the
 * program's stdin in declaration order (see testGenerator for the wire format).
 *
 * Scalar types:  int | long | double | string | char | bool
 * Array types:   <scalar>[]      e.g. int[]      (length then elements)
 * Matrix type:   int[][]                          (rows cols then grid)
 */
const scalarTypes = ['int', 'long', 'double', 'string', 'char', 'bool'];
const arrayTypes = scalarTypes.map((t) => `${t}[]`);
const paramTypes = [...scalarTypes, ...arrayTypes, 'int[][]'];

export const paramSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(paramTypes),
    // Numeric bounds (inclusive) for scalar/element values.
    min: z.number().optional(),
    max: z.number().optional(),
    // Length bounds for array types (and inner-length for strings).
    lenMin: z.number().int().nonnegative().optional(),
    lenMax: z.number().int().nonnegative().optional(),
    // Row/col bounds for matrix types.
    rowsMin: z.number().int().nonnegative().optional(),
    rowsMax: z.number().int().nonnegative().optional(),
    colsMin: z.number().int().nonnegative().optional(),
    colsMax: z.number().int().nonnegative().optional(),
    // For string/char: restrict the alphabet used when sampling.
    alphabet: z.string().optional(),
  })
  .strict();

export const problemSchema = z
  .object({
    params: z.array(paramSchema).min(1),
  })
  .strict();

export const submissionSchema = z
  .object({
    language: z.literal('cpp').default('cpp'),
    // The untrusted candidate solution under test.
    sourceCode: z.string().min(1).max(200_000),
    // Test inputs come from EXACTLY ONE of two sources:
    //   schema — a typed problem spec the worker auto-generates fuzz cases from
    //   tests  — explicit stdin blobs run verbatim (paste/upload mode)
    schema: problemSchema.optional(),
    tests: z.array(z.string().max(200_000)).min(1).max(50).optional(),
    // Optional trusted reference (e.g. a brute-force). When present, its output
    // on each input is the expected answer -> enables WA detection.
    // It is compiled and run in the SAME sandbox as the candidate.
    reference: z
      .object({ sourceCode: z.string().min(1).max(200_000) })
      .strict()
      .optional(),
    timeLimitMs: z.number().int().positive().max(10_000).optional(),
    seed: z.number().int().optional(),
  })
  .strict()
  .refine((d) => !!d.schema !== Array.isArray(d.tests), {
    message: 'Provide exactly one of `schema` (auto-generate) or `tests` (explicit inputs).',
    path: ['schema'],
  });

export const VERDICTS = Object.freeze({
  ACCEPTED: 'Accepted',
  WRONG_ANSWER: 'Wrong Answer',
  TIME_LIMIT_EXCEEDED: 'Time Limit Exceeded',
  RUNTIME_ERROR: 'Runtime Error',
  COMPILE_ERROR: 'Compilation Error',
  // Emitted only when no reference is supplied: the program ran without
  // crashing/timing out, but correctness could not be checked.
  NO_CRASH: 'No Crash (unchecked)',
  // --- stress-test mode (gen.cpp -> brute vs optimized) ---
  MISMATCH: 'Mismatch',
  GENERATOR_ERROR: 'Generator Error',
});

const sourceField = z.object({ sourceCode: z.string().min(1).max(200_000) }).strict();

/**
 * Classic stress-test job: a generator program emits a random test each
 * iteration (seeded via argv), which is piped into BOTH a trusted brute-force
 * and the optimized candidate; their outputs are diffed. The first iteration
 * whose outputs disagree (or where the optimized solution TLEs/crashes) is the
 * reported counterexample.
 */
export const stressSchema = z
  .object({
    generator: sourceField,
    brute: sourceField,
    optimized: sourceField,
    iterations: z.number().int().positive().max(1000).default(100),
    timeLimitMs: z.number().int().positive().max(10_000).optional(),
    seedStart: z.number().int().nonnegative().default(1),
  })
  .strict();

/**
 * Auto-Parser (POST /generate-script): a single problem URL the backend scrapes
 * and hands to an LLM to write gen.cpp. Host allow-listing happens in the
 * scraper; here we only require a syntactically valid URL.
 */
export const generateScriptSchema = z
  .object({
    url: z.string().url().max(2048),
  })
  .strict();

export { scalarTypes, arrayTypes };
