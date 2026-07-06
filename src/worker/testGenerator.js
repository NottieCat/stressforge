/**
 * Deterministic PRNG (mulberry32). Seeded so a submission's generated test
 * suite is fully reproducible from (seed) — essential for reproducing a
 * failing edge case reported back to the user.
 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

const DEFAULT_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

// Sensible fallbacks when the schema omits bounds.
function scalarBounds(param) {
  const min = param.min ?? (param.type.startsWith('double') ? -1e6 : -1000);
  const max = param.max ?? (param.type.startsWith('double') ? 1e6 : 1000);
  return { min, max };
}

function lenBounds(param) {
  return { lenMin: param.lenMin ?? 0, lenMax: param.lenMax ?? 100 };
}

/**
 * Sample one scalar value. `bias` nudges toward boundaries so we probe the
 * classic off-by-one / overflow / empty-input edges rather than only the
 * fat middle of the distribution.
 */
function sampleScalar(rng, param, bias) {
  const base = param.type.replace('[]', '');
  switch (base) {
    case 'int':
    case 'long': {
      const { min, max } = scalarBounds(param);
      if (bias === 'min') return min;
      if (bias === 'max') return max;
      if (bias === 'zero') return Math.max(min, Math.min(max, 0));
      return randInt(rng, min, max);
    }
    case 'double': {
      const { min, max } = scalarBounds(param);
      if (bias === 'min') return min;
      if (bias === 'max') return max;
      if (bias === 'zero') return 0;
      return min + rng() * (max - min);
    }
    case 'bool':
      return bias === 'min' ? 0 : bias === 'max' ? 1 : randInt(rng, 0, 1);
    case 'char': {
      const alpha = param.alphabet || DEFAULT_ALPHABET;
      return bias === 'min' ? alpha[0] : bias === 'max' ? alpha[alpha.length - 1] : pick(rng, alpha.split(''));
    }
    case 'string': {
      const alpha = param.alphabet || DEFAULT_ALPHABET;
      const { lenMin, lenMax } = lenBounds(param);
      const len = bias === 'min' ? lenMin : bias === 'max' ? lenMax : randInt(rng, lenMin, lenMax);
      let s = '';
      for (let i = 0; i < len; i++) s += pick(rng, alpha.split(''));
      return s.length ? s : '_'; // avoid an empty stdin token
    }
    default:
      throw new Error(`Unsupported scalar type: ${base}`);
  }
}

function serializeScalar(value) {
  return String(value);
}

/** Render one parameter's value(s) as newline-delimited stdin tokens. */
function sampleParam(rng, param, bias) {
  const t = param.type;
  if (t === 'int[][]') {
    const rows = bias === 'min' ? (param.rowsMin ?? 0) : bias === 'max' ? (param.rowsMax ?? 20) : randInt(rng, param.rowsMin ?? 0, param.rowsMax ?? 20);
    const cols = bias === 'min' ? (param.colsMin ?? 0) : bias === 'max' ? (param.colsMax ?? 20) : randInt(rng, param.colsMin ?? 0, param.colsMax ?? 20);
    const lines = [`${rows} ${cols}`];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push(sampleScalar(rng, { ...param, type: 'int' }, bias === 'boundary' ? pick(rng, ['min', 'max', 'zero']) : null));
      lines.push(row.join(' '));
    }
    return lines.join('\n');
  }

  if (t.endsWith('[]')) {
    const { lenMin, lenMax } = lenBounds(param);
    const len = bias === 'min' ? lenMin : bias === 'max' ? lenMax : randInt(rng, lenMin, lenMax);
    const elems = [];
    for (let i = 0; i < len; i++) {
      const elemBias = bias === 'boundary' ? pick(rng, ['min', 'max', 'zero', null]) : bias;
      elems.push(serializeScalar(sampleScalar(rng, param, elemBias)));
    }
    // Length line, then the elements (empty line if len === 0).
    return `${len}\n${elems.join(' ')}`;
  }

  return serializeScalar(sampleScalar(rng, param, bias));
}

/**
 * Build the stdin blob for one test case across all params, in order.
 */
function buildInput(rng, params, bias) {
  return params.map((p) => sampleParam(rng, p, bias)).join('\n') + '\n';
}

/**
 * Parse a validated problem schema and generate `count` test-case inputs.
 *
 * The first several cases are deliberately biased toward boundaries
 * (all-min, all-max, all-zero, empty/degenerate collections) because those
 * are where algorithmic solutions actually break; the remainder are random
 * fuzz over the declared domain.
 *
 * @returns {{ index:number, stdin:string, kind:string }[]}
 */
export function generateTestCases(problem, count, seed = 12345) {
  const rng = makeRng(seed);
  const params = problem.params;
  const cases = [];

  const boundaryPlan = ['min', 'max', 'zero', 'min', 'max', 'boundary'];
  for (let i = 0; i < count; i++) {
    const bias = i < boundaryPlan.length ? boundaryPlan[i] : 'boundary';
    // After the fixed boundary plan, most cases are pure random fuzz; sprinkle
    // in occasional boundary-biased cases to keep probing edges.
    const kind = i < boundaryPlan.length ? bias : (rng() < 0.2 ? 'boundary' : 'random');
    cases.push({
      index: i,
      kind,
      stdin: buildInput(rng, params, kind === 'random' ? null : kind),
    });
  }
  return cases;
}

export default { generateTestCases, makeRng };
