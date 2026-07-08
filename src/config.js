import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Minimal .env loader so we don't pull in a dependency just for this.
// Real env vars always win over the file.
function loadDotEnv() {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const num = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  rootDir,
  port: num('PORT', 3000),

  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: num('REDIS_PORT', 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  queueName: process.env.QUEUE_NAME || 'stressforge-executions',
  workerConcurrency: num('WORKER_CONCURRENCY', 4),

  sandbox: {
    image: process.env.SANDBOX_IMAGE || 'stressforge-sandbox:latest',
    runTimeoutMs: num('RUN_TIMEOUT_MS', 2000),
    compileTimeoutMs: num('COMPILE_TIMEOUT_MS', 10000),
    memoryLimit: process.env.MEMORY_LIMIT || '256m',
    cpuLimit: process.env.CPU_LIMIT || '1.0',
    maxOutputBytes: num('MAX_OUTPUT_BYTES', 1024 * 1024),
  },

  testCaseCount: num('TEST_CASE_COUNT', 25),
};

export default config;
