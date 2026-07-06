import * as cheerio from 'cheerio';
import { config } from '../config.js';

/**
 * Fetch a competitive-programming problem page and pull out the parts an LLM
 * needs to write a generator: the statement plus, crucially, the input-format
 * and constraints text. We keep this best-effort — different judges lay pages
 * out differently and markup shifts over time — and always fall back to the
 * whole cleaned page text rather than failing when a selector misses.
 */

// Only judges we know how to read. Also acts as a small SSRF guard: the URL is
// user-supplied and gets fetched server-side, so we don't want arbitrary hosts.
const ALLOWED_HOSTS = [
  'codeforces.com',
  'www.codeforces.com',
  'm1.codeforces.com',
  'm2.codeforces.com',
  'm3.codeforces.com',
  'codechef.com',
  'www.codechef.com',
];

/** Thrown for anything the caller should surface as a 4xx/5xx scrape failure. */
export class ScrapeError extends Error {
  constructor(message, { status = 502 } = {}) {
    super(message);
    this.name = 'ScrapeError';
    this.status = status;
  }
}

function assertAllowedHost(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ScrapeError('Not a valid URL.', { status: 400 });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ScrapeError('Only http(s) URLs are supported.', { status: 400 });
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.includes(host)) {
    throw new ScrapeError(
      `Unsupported host "${host}". Only Codeforces and CodeChef problem URLs are supported.`,
      { status: 400 },
    );
  }
  return parsed;
}

/** Collapse runs of whitespace so the LLM prompt stays compact. */
function tidy(text) {
  return (text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Codeforces renders the statement in `.problem-statement`, with input format
 * in `.input-specification`. CodeChef server-rendered pages carry the body in
 * `#problem-statement` (or a `.problem-statement` container). We grab whatever
 * is present and lean on the constraints text specifically.
 */
function extractSections($) {
  const pick = (sel) => tidy($(sel).first().text());

  const inputSpec =
    pick('.input-specification') || pick('.input') || '';
  const statement =
    pick('.problem-statement') ||
    pick('#problem-statement') ||
    pick('[class*="problemStatement"]') ||
    '';

  // CodeChef (and some mirrors) put constraints under a heading rather than a
  // dedicated class. Fall back to scanning headings for a "Constraints" block.
  let constraints = '';
  if (!inputSpec) {
    $('h1, h2, h3, h4, strong, b').each((_, el) => {
      const label = $(el).text().trim().toLowerCase();
      if (label === 'constraints' || label === 'input' || label.startsWith('input format')) {
        // Text of the heading's parent tends to include the following prose.
        const chunk = tidy($(el).parent().text());
        if (chunk.length > constraints.length) constraints = chunk;
      }
    });
  }

  return { inputSpec, statement, constraints };
}

const BROWSER_HEADERS = {
  // A realistic UA — some judges 403 the default fetch agent.
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/json',
  'accept-language': 'en-US,en;q=0.9',
};

/** fetch() with the configured timeout, normalizing abort/network into ScrapeError. */
async function fetchWithTimeout(url, { accept } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llm.scrapeTimeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: accept ? { ...BROWSER_HEADERS, accept } : BROWSER_HEADERS,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new ScrapeError('Timed out fetching the problem page.', { status: 504 });
    }
    throw new ScrapeError(`Could not fetch the problem page: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * CodeChef's public HTML is a client-rendered SPA with no statement text, but
 * it exposes a clean JSON API that returns the full body. Map a problem URL
 * (…/problems/CODE or …/CONTEST/problems/CODE) onto that API and pull the body.
 */
async function scrapeCodeChef(parsed, url) {
  const segments = parsed.pathname.split('/').filter(Boolean);
  const pIdx = segments.lastIndexOf('problems');
  const code = pIdx !== -1 ? segments[pIdx + 1] : segments[segments.length - 1];
  if (!code) {
    throw new ScrapeError('Could not find a problem code in the CodeChef URL.', { status: 400 });
  }
  // A contest code may precede /problems/; default to PRACTICE for problemset links.
  const contest = pIdx >= 1 ? segments[pIdx - 1] : 'PRACTICE';

  const apiUrl = `https://www.codechef.com/api/contests/${encodeURIComponent(
    contest,
  )}/problems/${encodeURIComponent(code)}`;

  const res = await fetchWithTimeout(apiUrl, { accept: 'application/json' });
  if (!res.ok) {
    throw new ScrapeError(
      `CodeChef API returned HTTP ${res.status} for "${code}". The problem may be private or the code wrong.`,
    );
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new ScrapeError('CodeChef API returned an unexpected (non-JSON) response.');
  }
  if (data?.status !== 'success' || !data?.body) {
    throw new ScrapeError('CodeChef API did not return a problem statement.');
  }

  // The body is HTML; strip tags to plain text for the prompt.
  const $ = cheerio.load(String(data.body));
  $('script, style').remove();
  let problemText = tidy($.root().text());
  const heading = data.problem_name ? `${data.problem_name} (${code})\n\n` : '';
  problemText = tidy(heading + problemText);

  if (!problemText) {
    throw new ScrapeError('Could not extract any problem text from CodeChef.');
  }
  const MAX_CHARS = 12000;
  if (problemText.length > MAX_CHARS) problemText = problemText.slice(0, MAX_CHARS);

  return { url, problemText, hadInputSection: /constraint/i.test(problemText) };
}

/** Generic HTML scrape path (Codeforces and any future judge). */
async function scrapeHtml(url) {
  const res = await fetchWithTimeout(url, { accept: 'text/html,application/xhtml+xml' });
  if (!res.ok) {
    throw new ScrapeError(
      `Problem page returned HTTP ${res.status}. It may be private, moved, or behind a bot wall.`,
    );
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  // Drop noise that would otherwise bloat the fallback text.
  $('script, style, noscript, nav, header, footer').remove();

  const { inputSpec, statement, constraints } = extractSections($);

  // Prefer the targeted sections; fall back to the whole cleaned body so the
  // LLM still has something to work with when selectors miss.
  const bodyText = tidy($('body').text());
  const parts = [];
  if (statement) parts.push(statement);
  if (inputSpec) parts.push(`INPUT / CONSTRAINTS:\n${inputSpec}`);
  if (constraints) parts.push(`CONSTRAINTS:\n${constraints}`);
  let problemText = tidy(parts.join('\n\n')) || bodyText;

  if (!problemText) {
    throw new ScrapeError('Could not extract any problem text from the page.');
  }

  // Keep the prompt bounded — statements with editorial/comments can be huge.
  const MAX_CHARS = 12000;
  if (problemText.length > MAX_CHARS) problemText = problemText.slice(0, MAX_CHARS);

  return {
    url,
    problemText,
    hadInputSection: Boolean(inputSpec || constraints),
  };
}

/**
 * Fetch `url` and return a compact text blob describing the problem's input
 * format/constraints for the LLM. Throws ScrapeError on unsupported host,
 * network failure, timeout, or empty page.
 */
export async function scrapeProblem(url) {
  const parsed = assertAllowedHost(url);
  const host = parsed.hostname.toLowerCase();

  // CodeChef's page is a JS SPA — use its JSON API instead of the empty HTML.
  if (host.endsWith('codechef.com')) {
    return scrapeCodeChef(parsed, url);
  }
  return scrapeHtml(url);
}

export default scrapeProblem;
