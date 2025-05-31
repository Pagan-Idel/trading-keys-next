import { Worker } from 'worker_threads';
const threads = new Map();
const startWorker = (pair) => {
    const worker = new Worker('./strategyWorker.js', {
        workerData: { pair },
    });
    threads.set(pair, worker);
    worker.on('exit', code => {
        console.log(`💀 Worker for ${pair} exited with code ${code}`);
        if (code !== 0) {
            console.log(`🔁 Restarting crashed worker for ${pair}`);
            startWorker(pair); // restart
        }
        else {
            threads.delete(pair); // exited normally (e.g., placed trade and finished)
        }
    });
    worker.on('error', err => {
        console.error(`❌ Worker error for ${pair}:`, err);
    });
};
