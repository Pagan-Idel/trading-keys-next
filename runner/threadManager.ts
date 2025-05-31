// src/workers/threadManager.ts
import { forexPairs } from '../utils/constants.js';
import { Worker } from 'worker_threads';

const threads = new Map<string, Worker>();

export const startWorker = (pair: string) => {
  if (threads.has(pair)) return;

  const worker = new Worker('./dist/workers/strategyWorker.js', {
    workerData: { pair },
  });

  threads.set(pair, worker);

  worker.on('exit', code => {
    console.log(`💀 Worker for ${pair} exited with code ${code}`);
    if (code !== 0) {
      console.log(`🔁 Restarting crashed worker for ${pair}`);
      startWorker(pair); // restart on crash
    } else {
      threads.delete(pair); // clean up if finished normally
    }
  });

  worker.on('error', err => {
    console.error(`❌ Worker error for ${pair}:`, err);
  });
};

export const startAllWorkers = () => {
  for (const pair of forexPairs) {
    startWorker(pair);
  }
};
