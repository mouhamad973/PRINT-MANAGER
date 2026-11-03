import {
  SYSTEM_QUEUE,
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_HEARTBEAT_JOB,
} from '@arksen/shared-types';
import { parseEnv, workersEnvSchema } from '@arksen/validation';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { publishHeartbeat } from './heartbeat.js';

const env = parseEnv(workersEnvSchema, process.env);

// BullMQ exige `maxRetriesPerRequest: null` pour ses connexions bloquantes.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (error: Error) => console.warn(`Connexion Redis : ${error.message}`));

const queue = new Queue(SYSTEM_QUEUE, { connection });
await queue.upsertJobScheduler(
  WORKER_HEARTBEAT_JOB,
  { every: WORKER_HEARTBEAT_INTERVAL_MS },
  { name: WORKER_HEARTBEAT_JOB, opts: { removeOnComplete: 10, removeOnFail: 50 } },
);

const worker = new Worker(
  SYSTEM_QUEUE,
  async (job) => {
    if (job.name === WORKER_HEARTBEAT_JOB) {
      await publishHeartbeat(connection);
      return;
    }
    throw new Error(`Tâche inconnue : ${job.name}`);
  },
  { connection },
);
worker.on('failed', (job, error) =>
  console.error(`Tâche ${job?.name} en échec : ${error.message}`),
);
console.log(`Workers démarrés, file « ${SYSTEM_QUEUE} »`);

async function shutdown(signal: string): Promise<void> {
  console.log(`Signal ${signal} reçu, arrêt des workers`);
  await worker.close();
  await queue.close();
  connection.disconnect();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
