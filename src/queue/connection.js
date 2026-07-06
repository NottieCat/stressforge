import IORedis from 'ioredis';
import { config } from '../config.js';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on the connection it uses for
 * blocking commands (workers). We create dedicated connections per consumer so
 * a stalled blocking call on the worker never wedges the API's connection.
 */
export function createRedisConnection(overrides = {}) {
  return new IORedis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...overrides,
  });
}

export default createRedisConnection;
