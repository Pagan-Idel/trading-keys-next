import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { forexPairs } from '../utils/constants.ts';
import { logMessage } from '../utils/automationLogger.ts';
import { getActiveNewsEvent, isInHighImpactNewsWindow } from '../utils/newsGuard.ts';
import { MARKET_DATA_HUB_URL } from '../utils/oanda/api/marketDataHub.ts';
import { isTradeSessionOpen } from '../utils/sessionUtils.ts';

const processes = new Map<string, ReturnType<typeof spawn>>();
const starting = new Set<string>();
const restartHistory = new Map<string, number[]>();
const intentionallyStopped = new Set<string>();
const RESTART_LIMIT = 10;
const RESTART_WINDOW_MS = 60_000;
const STREAM_START_SPACING_MS = 600;
const WORKER_START_GRACE_MS = 250;
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const configuredPairs = process.env.TRADING_KEYS_E2E_PAIRS
  ? process.env.TRADING_KEYS_E2E_PAIRS.split(',').map(value => value.trim()).filter(Boolean)
  : forexPairs;
const workerEntry = process.env.TRADING_KEYS_WORKER_ENTRY ?? './workers/goldilocksWorker.ts';
const TSX_IMPORT = process.env.TRADING_KEYS_TSX_IMPORT ??
  pathToFileURL(path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;

export const startWorker = async (pair: string, mode: 'live' | 'demo'):Promise<boolean> => {
  if (processes.has(pair)||starting.has(pair)) return processes.has(pair);
  starting.add(pair);
  intentionallyStopped.delete(pair);
  const now = Date.now();
  const recentRestarts = (restartHistory.get(pair) ?? []).filter(timestamp => now - timestamp < RESTART_WINDOW_MS);
  recentRestarts.push(now);
  restartHistory.set(pair, recentRestarts);
  if (recentRestarts.length > RESTART_LIMIT) {
    logMessage(`Worker for ${pair} exceeded ${RESTART_LIMIT} restarts in one minute and remains stopped.`);
    starting.delete(pair);
    return false;
  }
  const workerArguments = workerEntry.endsWith('.mjs')
    ? [workerEntry, pair, `--mode=${mode}`]
    : ['--import', TSX_IMPORT, workerEntry, pair, `--mode=${mode}`];
  const subprocess = spawn(process.execPath, workerArguments, {
    stdio: 'inherit', shell: false, windowsHide: true,
    env: { ...process.env, OANDA_MARKET_DATA_HUB_URL: MARKET_DATA_HUB_URL },
  });
  const spawned=await new Promise<boolean>(resolve=>{
    subprocess.once('spawn',()=>resolve(true));
    subprocess.once('error',()=>resolve(false));
  });
  starting.delete(pair);
  if(!spawned){
    logMessage(`Worker for ${pair} failed to spawn and is not running.`);
    return false;
  }
  processes.set(pair, subprocess);
  let established=false;
  subprocess.on('exit', code => {
    if (processes.get(pair) === subprocess) processes.delete(pair);
    if (established&&!intentionallyStopped.has(pair) && typeof code === 'number' && code !== 0) void startWorker(pair, mode);
  });
  subprocess.on('error', error => logMessage(`Worker error for ${pair}: ${error.message}`));
  await pause(WORKER_START_GRACE_MS);
  if(processes.get(pair)!==subprocess)return false;
  established=true;
  return true;
};

export const stopWorker = (pair: string, reason?: string) => {
  const child = processes.get(pair);
  if (!child) return;
  intentionallyStopped.add(pair);
  logMessage(`Stopping worker for ${pair}${reason ? `: ${reason}` : ''}`);
  if (process.platform === 'win32') {
    if (child.pid !== undefined) spawn('taskkill', ['/PID', String(child.pid), '/F', '/T'], { windowsHide: true });
  } else if (child.pid !== undefined) process.kill(child.pid, 'SIGTERM');
  processes.delete(pair);
};

export const getEligibleWorkerPairs = async (
  pairs: string[] = configuredPairs,
  now = new Date(),
  newsBlocked: (pair: string) => Promise<boolean> = isInHighImpactNewsWindow,
): Promise<string[]> => {
  const eligible: string[] = [];
  for (const pair of pairs) {
    if (isTradeSessionOpen(pair, now) && !await newsBlocked(pair)) eligible.push(pair);
  }
  return eligible;
};

export const refreshWorkers = async (eligiblePairs: string[], mode: 'live' | 'demo') => {
  const expected = new Set(eligiblePairs);
  const failed:string[]=[];
  for (const pair of [...processes.keys()]) {
    if (!expected.has(pair)) {
      const event = getActiveNewsEvent(pair);
      stopWorker(pair, event ? `High Impact News: ${event.title}` : 'Outside active trading session');
    }
  }
  for (const pair of eligiblePairs) {
    if (!processes.has(pair)) {
      if(!await startWorker(pair, mode))failed.push(pair);
      await pause(STREAM_START_SPACING_MS);
    }
  }
  return {running:[...processes.keys()],failed};
};

export const startAllWorkers = async (mode: 'live' | 'demo', eligiblePairs?: string[]) => {
  const pairs = eligiblePairs ?? await getEligibleWorkerPairs();
  const result=await refreshWorkers(pairs, mode);
  logMessage(`Eligible workers launched: ${pairs.join(', ') || 'none'}.`);
  return result;
};
export const stopAllWorkers = async () => {
  for (const pair of [...processes.keys()]) stopWorker(pair, 'Global shutdown');
};
export const runningWorkerPairs = (): string[] => [...processes.keys()];
