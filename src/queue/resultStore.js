import { createRedisConnection } from './connection.js';

/**
 * Submission results live in Redis under a namespaced key with a TTL.
 * Both the API (reader) and worker (writer) share this small abstraction so
 * neither owns the storage format directly.
 */
const redis = createRedisConnection();
const KEY_PREFIX = 'stressforge:result:';
const RESULT_TTL_SECONDS = 24 * 3600;

const keyFor = (id) => `${KEY_PREFIX}${id}`;

export async function initResult(id) {
  const record = {
    id,
    status: 'queued',
    verdict: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await redis.set(keyFor(id), JSON.stringify(record), 'EX', RESULT_TTL_SECONDS);
  return record;
}

export async function saveResult(id, patch) {
  const existing = await getResult(id);
  const record = {
    ...(existing || { id, createdAt: new Date().toISOString() }),
    ...patch,
    id,
    updatedAt: new Date().toISOString(),
  };
  await redis.set(keyFor(id), JSON.stringify(record), 'EX', RESULT_TTL_SECONDS);
  return record;
}

export async function getResult(id) {
  const raw = await redis.get(keyFor(id));
  return raw ? JSON.parse(raw) : null;
}

export default { initResult, saveResult, getResult };
