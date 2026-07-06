import { Queue } from 'bullmq';
import { config } from '../config.js';
import { createRedisConnection } from './connection.js';

/**
 * Producer-side queue handle. The API imports this to enqueue submissions;
 * the worker constructs its own Worker against the same queue name.
 *
 * Decoupling: the API only ever touches Redis. It never blocks on execution,
 * so ingest throughput is bounded by Redis, not by how many containers are
 * currently compiling C++. Workers scale horizontally against the same queue.
 */
export const executionQueue = new Queue(config.queueName, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  },
});

export async function enqueueSubmission(submission) {
  const job = await executionQueue.add('execute', submission, {
    jobId: submission.id,
  });
  return job.id;
}

export default executionQueue;
