import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { recordAutomationEvent } from './automationStore';

type RuntimeState = {
  pid: number;
  mode: 'demo';
  startedAt: string;
};

const DATA_DIRECTORY = path.resolve(process.cwd(), 'data');
const STATE_PATH = path.join(DATA_DIRECTORY, 'automation-runtime.json');
const STDOUT_PATH = path.join(DATA_DIRECTORY, 'automation-runtime.log');
const STDERR_PATH = path.join(DATA_DIRECTORY, 'automation-runtime.error.log');
const LOG_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_RUNTIME_LOG_BYTES = 5 * 1024 * 1024;

const rotateRuntimeLog = (filePath: string): void => {
  try {
    const stats = fs.statSync(filePath);
    if (Date.now() - stats.mtimeMs > LOG_RETENTION_MS || stats.size > MAX_RUNTIME_LOG_BYTES) {
      fs.rmSync(filePath, { force: true });
    }
  } catch {
    // The log does not exist yet.
  }
};

const readState = (): RuntimeState | null => {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as RuntimeState;
  } catch {
    return null;
  }
};

const isPidRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const getAutomationRuntime = () => {
  const state = readState();
  const running = Boolean(state && isPidRunning(state.pid));
  if (state && !running) {
    fs.rmSync(STATE_PATH, { force: true });
  }
  return {
    running,
    pid: running ? state!.pid : null,
    mode: running ? state!.mode : null,
    startedAt: running ? state!.startedAt : null,
  };
};

export const startDemoAutomation = () => {
  const current = getAutomationRuntime();
  if (current.running) return current;

  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  rotateRuntimeLog(STDOUT_PATH);
  rotateRuntimeLog(STDERR_PATH);
  const stdout = fs.openSync(STDOUT_PATH, 'a');
  const stderr = fs.openSync(STDERR_PATH, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', 'runner/startRunner.ts', '--mode=demo'], {
    cwd: process.cwd(),
    detached: true,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', stdout, stderr],
  });

  child.unref();
  fs.closeSync(stdout);
  fs.closeSync(stderr);

  if (!child.pid) throw new Error('Automation process did not return a PID');
  const state: RuntimeState = { pid: child.pid, mode: 'demo', startedAt: new Date().toISOString() };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  recordAutomationEvent({
    message: 'Demo automation started from the dashboard',
    source: 'process-manager',
    step: 'runtime_started',
    data: { pid: child.pid },
  });
  return getAutomationRuntime();
};

export const stopAutomation = () => {
  const current = getAutomationRuntime();
  if (!current.running || !current.pid) return current;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(current.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-current.pid, 'SIGTERM');
    } catch {
      process.kill(current.pid, 'SIGTERM');
    }
  }

  fs.rmSync(STATE_PATH, { force: true });
  recordAutomationEvent({
    message: 'Automation stopped from the dashboard',
    source: 'process-manager',
    step: 'runtime_stopped',
  });
  return getAutomationRuntime();
};
