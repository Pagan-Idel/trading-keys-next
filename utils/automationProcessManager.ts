import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { recordAutomationEvent, validateAutomationDatabaseForRecovery } from './automationStore';
import { getOandaCredentials } from './oandaCredentials';
import { getAutomationCompatibility } from './automationStrategyCompatibility';
import { readAutomationDesiredState, writeAutomationDesiredState } from './automationDesiredState';
import {
  clearRuntimeLease, createRuntimeLease, currentBootId, readRuntimeLease,
  validateAndClearStaleLease, writeRuntimeLease,
} from './automationRuntimeLease';

const DATA_DIRECTORY = path.resolve(process.env.TRADING_KEYS_DATA_DIRECTORY ?? path.join(process.cwd(), 'data'));
const STDOUT_PATH = path.join(DATA_DIRECTORY, 'automation-runtime.log');
const STDERR_PATH = path.join(DATA_DIRECTORY, 'automation-runtime.error.log');
const LOCK_PATH = path.join(DATA_DIRECTORY, 'automation-start.lock');
const READY_PATH = path.join(DATA_DIRECTORY, 'automation-runner.ready');
const LOG_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_RUNTIME_LOG_BYTES = 5 * 1024 * 1024;
const READY_TIMEOUT_MS = Number(process.env.TRADING_KEYS_RUNNER_READY_TIMEOUT_MS ?? 20_000);
const MAX_RECOVERY_RETRIES = 3;
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000];
let operation: Promise<unknown> = Promise.resolve();
let supervisedChild: ChildProcess | null = null;
let recoveryRetries = 0;
let shuttingDown = false;
let recoveryTimer:NodeJS.Timeout|null=null;

const serialize = <T>(work: () => Promise<T>): Promise<T> => {
  const next = operation.then(work, work);
  operation = next.catch(() => undefined);
  return next;
};
const acquireLock = (): number => {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  try {
    const descriptor=fs.openSync(LOCK_PATH, 'wx', 0o600);
    fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,bootId:currentBootId(),createdAt:new Date().toISOString()}));
    return descriptor;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      let active=false;
      try{
        const lock=JSON.parse(fs.readFileSync(LOCK_PATH,'utf8')) as {pid?:number;bootId?:string};
        if(lock.bootId===currentBootId()&&Number.isSafeInteger(lock.pid)){
          try{process.kill(lock.pid!,0);active=true}catch{/* stale lock */}
        }
      }catch{
        try{active=Date.now()-fs.statSync(LOCK_PATH).mtimeMs<5_000}catch{/* removed concurrently */}
      }
      if(active)throw new Error('An automation start or recovery operation is already in progress.');
      fs.rmSync(LOCK_PATH,{force:true});
      return acquireLock();
    }
    throw error;
  }
};
const releaseLock = (descriptor: number): void => {
  fs.closeSync(descriptor);
  fs.rmSync(LOCK_PATH, { force: true });
};
const rotateRuntimeLog = (filePath: string): void => {
  try {
    const stats = fs.statSync(filePath);
    if (Date.now() - stats.mtimeMs > LOG_RETENTION_MS || stats.size > MAX_RUNTIME_LOG_BYTES) fs.rmSync(filePath, { force: true });
  } catch { /* absent */ }
};
const runnerEntry = () => path.resolve(process.env.TRADING_KEYS_AUTOMATION_TEST_RUNNER ??
  process.env.TRADING_KEYS_RUNNER_ENTRY ?? 'runner/startRunner.ts');
export const validateAutomationRecoveryPreflight = (): void => {
  if (!process.env.TRADING_KEYS_AUTOMATION_TEST_RUNNER && process.env.TRADING_KEYS_AUTOMATION_E2E !== 'true') {
    if (process.env.TRADING_KEYS_PI_RUNTIME !== 'true') throw new Error('Pi runtime marker is required for automatic recovery.');
    getOandaCredentials('demo');
  }
  const entry = runnerEntry();
  if (!fs.existsSync(entry)) throw new Error(`Compiled demo runner entry point is unavailable: ${entry}`);
  const worker = process.env.TRADING_KEYS_WORKER_ENTRY;
  if (worker && !fs.existsSync(path.resolve(worker))) throw new Error(`Compiled worker entry point is unavailable: ${worker}`);
  const database = validateAutomationDatabaseForRecovery();
  const strategy = database.strategy;
  const assessment=strategy?getAutomationCompatibility(strategy.config):null;
  const compatible=Boolean(strategy&&(assessment?.compatible||(strategy.sourceRunUid==='built-in'&&
    assessment?.blockers.every(blocker=>blocker.startsWith('Research-only')||
      blocker.startsWith('Research gates')||blocker.startsWith('Research score')))));
  if (!strategy?.id || !strategy.sourceRunUid || !compatible) {
    throw new Error('Exactly one compatible approved intraday strategy is required.');
  }
  if (database.activeStrategies !== 1) throw new Error('Exactly one active approved strategy is required.');
  if(database.incompatibleActiveTrades>0)throw new Error('An incompatible unresolved open trade blocks demo recovery.');
  if (validateAndClearStaleLease()) throw new Error('A valid automation runner is already active.');
};
const waitForReadiness = async (pid: number): Promise<void> => {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(READY_PATH)) {
      const ready = JSON.parse(fs.readFileSync(READY_PATH, 'utf8')) as { pid?: number; mode?: string };
      if (ready.pid === pid && ready.mode === 'demo') return;
    }
    try { process.kill(pid, 0); } catch { throw new Error('Automation runner exited before readiness.'); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Automation runner readiness timed out.');
};
const terminatePid = (pid: number): void => {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { process.kill(pid, 'SIGTERM'); }
  }
};
const waitForPidExit=async(pid:number,timeoutMs=10_000):Promise<boolean>=>{
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    try{process.kill(pid,0)}catch{return true}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  return false;
};
const clearRecoveryTimer=()=>{
  if(recoveryTimer)clearTimeout(recoveryTimer);
  recoveryTimer=null;
};
const safeRecord=(event:Parameters<typeof recordAutomationEvent>[0])=>{
  try{recordAutomationEvent(event)}catch(error){
    console.error(`Automation lifecycle event could not be persisted: ${error instanceof Error?error.message:String(error)}`);
  }
};
const scheduleRecovery = (): void => {
  if (recoveryTimer||shuttingDown || readAutomationDesiredState().desiredState !== 'running' || recoveryRetries >= MAX_RECOVERY_RETRIES) return;
  const delay = RETRY_DELAYS_MS[recoveryRetries++];
  recoveryTimer = setTimeout(() => {
    recoveryTimer=null;
    void recoverDesiredAutomation().catch(error => {
    safeRecord({ source: 'process-manager', step: 'runtime_recovery_failed', level: 'error',
      message: `Bounded automation recovery failed: ${(error as Error).message}`, data: { attempt: recoveryRetries } });
    scheduleRecovery();
  })}, delay);
  recoveryTimer.unref();
};
const spawnRunner = async (source: 'manual' | 'boot-recovery'): Promise<ReturnType<typeof getAutomationRuntime>> => {
  validateAutomationRecoveryPreflight();
  fs.rmSync(READY_PATH, { force: true });
  rotateRuntimeLog(STDOUT_PATH); rotateRuntimeLog(STDERR_PATH);
  const stdout = fs.openSync(STDOUT_PATH, 'a');
  const stderr = fs.openSync(STDERR_PATH, 'a');
  const entry = runnerEntry();
  const testRunner = process.env.TRADING_KEYS_AUTOMATION_TEST_RUNNER;
  const sourceRoot = path.dirname(path.dirname(entry));
  const tsxImport = pathToFileURL(path.join(sourceRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
  const args = testRunner ? [entry] : entry.endsWith('.ts')
    ? ['--import', tsxImport, entry, '--mode=demo'] : [entry, '--mode=demo'];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(), detached: true, shell: false, windowsHide: true,
    stdio: ['ignore', stdout, stderr],
    env: { ...process.env, TRADING_KEYS_TSX_IMPORT: tsxImport, TRADING_KEYS_RUNNER_READY_PATH: READY_PATH },
  });
  fs.closeSync(stdout); fs.closeSync(stderr);
  if (!child.pid) throw new Error('Automation process did not return a PID.');
  supervisedChild = child;
  child.on('exit', () => {
    const wasSupervised=supervisedChild === child;
    if (wasSupervised) supervisedChild = null;
    if(readRuntimeLease()?.pid===child.pid)clearRuntimeLease();
    if (wasSupervised&&!shuttingDown) scheduleRecovery();
  });
  try {
    await waitForReadiness(child.pid);
    writeRuntimeLease(createRuntimeLease(child.pid, entry));
  } catch (error) {
    try { terminatePid(child.pid); } catch { /* already exited */ }
    clearRuntimeLease();
    throw error;
  }
  clearRecoveryTimer();
  recoveryRetries = 0;
  safeRecord({ message: source === 'manual' ? 'Demo automation started from the dashboard' : 'Demo automation recovered after control-server startup',
    source: 'process-manager', step: source === 'manual' ? 'runtime_started' : 'runtime_recovered', data: { pid: child.pid } });
  return getAutomationRuntime();
};

export const getAutomationRuntime = () => {
  const lease = validateAndClearStaleLease();
  return {
    running: Boolean(lease), pid: lease?.pid ?? null, mode: lease?.mode ?? null,
    startedAt: lease?.createdAt ?? null, desiredState: readAutomationDesiredState().desiredState,
  };
};
export const startDemoAutomation = () => serialize(async () => {
  const descriptor = acquireLock();
  try {
    const current = getAutomationRuntime();
    if (current.running) return current;
    const runtime = await spawnRunner('manual');
    try{writeAutomationDesiredState('running', 'authenticated-api-start')}
    catch(error){
      let stopped=true;
      if(runtime.pid){
        try{terminatePid(runtime.pid);stopped=await waitForPidExit(runtime.pid)}catch{stopped=false}
      }
      if(stopped){
        clearRuntimeLease();
        fs.rmSync(READY_PATH,{force:true});
        supervisedChild=null;
      }else{
        safeRecord({source:'process-manager',step:'runtime_cleanup_failed',level:'error',
          message:'Runner remained active after desired-state persistence failed.',data:{pid:runtime.pid}});
      }
      throw error;
    }
    return runtime;
  } finally { releaseLock(descriptor); }
});
export const recoverDesiredAutomation = () => serialize(async () => {
  const descriptor = acquireLock();
  try {
    const current = getAutomationRuntime();
    if (current.running || readAutomationDesiredState().desiredState !== 'running') return current;
    return await spawnRunner('boot-recovery');
  } finally { releaseLock(descriptor); }
});
export const stopAutomation = () => serialize(async () => {
  writeAutomationDesiredState('stopped', 'authenticated-api-stop');
  shuttingDown = true;
  clearRecoveryTimer();
  try{
    const current = getAutomationRuntime();
    if (current.running && current.pid) {
      terminatePid(current.pid);
      if(!await waitForPidExit(current.pid))throw new Error(`Automation runner ${current.pid} did not stop after SIGTERM.`);
    }
    clearRuntimeLease();
    fs.rmSync(READY_PATH, { force: true });
    supervisedChild = null;
    safeRecord({ message: 'Automation stopped from the dashboard', source: 'process-manager', step: 'runtime_stopped' });
    return getAutomationRuntime();
  }finally{
    shuttingDown = false;
  }
});
export const shutdownAutomationChildren = async (): Promise<void> => {
  shuttingDown = true;
  clearRecoveryTimer();
  const current = getAutomationRuntime();
  if (current.running && current.pid) {
    try {
      terminatePid(current.pid);
      await waitForPidExit(current.pid);
    } catch { /* systemd will still terminate the service cgroup */ }
  }
  clearRuntimeLease();
  supervisedChild = null;
};
