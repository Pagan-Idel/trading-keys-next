import { spawn } from 'child_process';
import { forexPairs } from '../utils/constants.ts';
import { logMessage } from '../utils/automationLogger.ts';
import { isInHighImpactNewsWindow, getActiveNewsEvent } from '../utils/newsGuard.ts';
import { MARKET_DATA_HUB_URL } from '../utils/oanda/api/marketDataHub.ts';

const processes = new Map<string, ReturnType<typeof spawn>>();
const restartHistory = new Map<string, number[]>();
const RESTART_LIMIT = 10;
const RESTART_WINDOW_MS = 60_000;
// Stagger worker initialization to avoid simultaneous REST history bursts.
const STREAM_START_SPACING_MS = 600;
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export const startWorker = (pair: string, mode: 'live' | 'demo') => {
  if (processes.has(pair)) return;

  const now = Date.now();
  const history = restartHistory.get(pair) || [];
  const recentRestarts = history.filter(ts => now - ts < RESTART_WINDOW_MS);
  recentRestarts.push(now);
  restartHistory.set(pair, recentRestarts);

  if (recentRestarts.length > RESTART_LIMIT) {
    logMessage(`ðŸ›‘ Worker for ${pair} exceeded ${RESTART_LIMIT} restarts in 1 minute. Will not restart.`);
    return;
  }

  logMessage(`Starting Goldilocks worker for ${pair}`);
  const subprocess = spawn(process.execPath, ['--import', 'tsx', './workers/goldilocksWorker.ts', pair, `--mode=${mode}`], {
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: { ...process.env, OANDA_MARKET_DATA_HUB_URL: MARKET_DATA_HUB_URL },
  });

  processes.set(pair, subprocess);

  subprocess.on('exit', (code) => {
    logMessage(`ðŸ’€ Worker for ${pair} exited with code ${code}`);
    processes.delete(pair);

    if (typeof code === 'number' && code !== 0) {
      logMessage(`ðŸ” Restarting crashed worker for ${pair}`);
      startWorker(pair, mode);
    } else {
      logMessage(`ðŸ›‘ Worker for ${pair} exited cleanly or was terminated intentionally.`);
    }
  });

  subprocess.on('error', (err) => {
    logMessage(`âŒ Worker error for ${pair}: ${err.message}`);
  });
};

export const stopWorker = (pair: string, reason?: string) => {
  const proc = processes.get(pair);
  if (proc) {
    const pid = proc.pid;
    logMessage(`âœ‹ Killing worker for ${pair} (PID ${pid})${reason ? ` â€” Reason: ${reason}` : ''}`);

    if (process.platform === 'win32') {
      // Windows uses taskkill
      if (pid !== undefined) spawn('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true });
    } else {
      // macOS/Linux/Unix
      if (pid !== undefined) process.kill(pid, 'SIGKILL');
    }

    processes.delete(pair);
  }
};


export const refreshWorkers = async (activePairs: string[], mode: 'live' | 'demo') => {
  const currentlyRunning = new Set(processes.keys());
  const activeSet = new Set(activePairs);

  for (const pair of currentlyRunning) {
    const inNews = await isInHighImpactNewsWindow(pair);
    if (!activeSet.has(pair) || inNews) {
      if (inNews) {
        const event = getActiveNewsEvent(pair);
        const reason = `High Impact News: ${event?.title} (${event?.currency}) at ${event?.time}`;
        logMessage(`ðŸ“° Stopping ${pair} â€” ${reason}`);
        stopWorker(pair, reason);
      } else {
        stopWorker(pair, 'Not in active trading session (market closed or session filter)');
      }
    }
  }

  for (const pair of activePairs) {
    const alreadyRunning = currentlyRunning.has(pair);
    const inNews = await isInHighImpactNewsWindow(pair);
    if (!alreadyRunning && !inNews) {
      startWorker(pair, mode);
      await pause(STREAM_START_SPACING_MS);
    } else if (inNews) {
      const event = getActiveNewsEvent(pair);
      logMessage(`ðŸ“° Not starting ${pair} â€” News: ${event?.title} (${event?.currency}) at ${event?.time}`);
    }
  }
};

export const startAllWorkers = async (mode: 'live' | 'demo') => {
  for (const pair of forexPairs) {
    const inNews = await isInHighImpactNewsWindow(pair);
    if (!inNews) {
      logMessage(`âœ… Price ready for ${pair}, starting worker...`);
      startWorker(pair, mode);
      await pause(STREAM_START_SPACING_MS);
    } else {
      const event = getActiveNewsEvent(pair);
      logMessage(`ðŸ“° Skipping ${pair} at startup â€” News: ${event?.title} (${event?.currency}) at ${event?.time}`);
    }
  }
  logMessage(`ðŸš€ All eligible workers launched.`);
};

export const stopAllWorkers = async () => {
  logMessage(`ðŸ›‘ Stopping all workers...`);
  for (const [pair, proc] of processes.entries()) {
    logMessage(`âœ‹ Killing worker for ${pair} â€” Reason: Global shutdown`);
    proc.kill('SIGKILL');
  }
  processes.clear();
};
