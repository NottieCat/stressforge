import express from 'express';
import cors from 'cors';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import { submissionSchema, stressSchema, generateScriptSchema } from '../shared/schema.js';
import { enqueueSubmission } from '../queue/producer.js';
import { initResult, getResult } from '../queue/resultStore.js';
import { scrapeProblem, ScrapeError } from '../generator/scrape.js';
import { generateGenerator, LlmError } from '../generator/llmGenerator.js';

export function createApp() {
  const app = express();

  // CORS: the Next.js frontend runs on a different origin (default :3001) from
  // this API (:3000), so the browser needs an explicit allow. CORS_ORIGIN can
  // pin a single origin in prod; defaults to reflecting any origin for local
  // dev. No credentials are used (token/cookie-free), so this is safe.
  const corsOrigin = process.env.CORS_ORIGIN || true;
  app.use(cors({ origin: corsOrigin, methods: ['GET', 'POST'] }));

  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  /**
   * Accept an untrusted C++ payload + problem schema. We validate, persist a
   * "queued" record, enqueue, and return 202 immediately. Execution happens
   * out-of-band on a worker — the request never blocks on Docker.
   */
  app.post('/submissions', async (req, res) => {
    const parsed = submissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid submission',
        details: parsed.error.flatten(),
      });
    }

    const id = nanoid(16);
    const submission = { id, ...parsed.data };

    try {
      await initResult(id);
      await enqueueSubmission(submission);
    } catch (err) {
      return res.status(503).json({
        error: 'Failed to enqueue submission',
        message: err.message,
      });
    }

    return res.status(202).json({
      id,
      status: 'queued',
      poll: `/submissions/${id}`,
    });
  });

  app.get('/submissions/:id', async (req, res) => {
    const record = await getResult(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    return res.json(record);
  });

  /**
   * Classic stress-test: generator + brute-force + optimized. Same non-blocking
   * enqueue-and-poll contract as /submissions; the worker branches on kind.
   */
  app.post('/stress', async (req, res) => {
    const parsed = stressSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid stress request',
        details: parsed.error.flatten(),
      });
    }

    const id = nanoid(16);
    const submission = { id, kind: 'stress', ...parsed.data };

    try {
      await initResult(id);
      await enqueueSubmission(submission);
    } catch (err) {
      return res.status(503).json({
        error: 'Failed to enqueue stress run',
        message: err.message,
      });
    }

    return res.status(202).json({ id, status: 'queued', poll: `/stress/${id}` });
  });

  // Stress results share the same result store; a distinct path for clarity.
  app.get('/stress/:id', async (req, res) => {
    const record = await getResult(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    return res.json(record);
  });

  /**
   * Auto-Parser. Scrape a Codeforces/CodeChef problem URL, hand its input
   * constraints to an LLM, and synchronously return a StressForge gen.cpp.
   * Unlike /submissions and /stress this does no Docker work, so it responds
   * inline rather than enqueue-and-poll.
   *
   *   200 { is_fixed_input: false, code }  -> populate the generator editor
   *   200 { is_fixed_input: true }         -> predefined cases; use Submission Mode
   */
  app.post('/generate-script', async (req, res) => {
    const parsed = generateScriptSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.flatten(),
      });
    }

    try {
      const problem = await scrapeProblem(parsed.data.url);
      const result = await generateGenerator(problem);

      if (result.is_fixed_input) {
        return res.status(200).json({ is_fixed_input: true });
      }
      return res.status(200).json({ is_fixed_input: false, code: result.code });
    } catch (err) {
      // Scrape/LLM errors carry their own intended HTTP status; anything else
      // is an unexpected 500. Never let this crash the server.
      if (err instanceof ScrapeError || err instanceof LlmError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error('[api] /generate-script failed:', err);
      return res.status(500).json({ error: 'Failed to generate script.' });
    }
  });

  return app;
}

// Start only when run directly (not when imported by tests).
const isMain = process.argv[1] && process.argv[1].endsWith('server.js');
if (isMain) {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[api] StressForge API listening on :${config.port}`);
  });
}

export default createApp;
