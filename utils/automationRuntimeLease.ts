import fs from 'node:fs';
import path from 'node:path';

export type AutomationRuntimeLease = {
  pid: number;
  processStartTime: string;
  bootId: string;
  expectedEntryPoint: string;
  releaseCommit: string;
  mode: 'demo';
  cgroup: string;
  createdAt: string;
};

const dataDirectory = () => path.resolve(process.env.TRADING_KEYS_DATA_DIRECTORY ?? path.join(process.cwd(), 'data'));
export const runtimeLeasePath = () => path.join(dataDirectory(), 'automation-runtime.json');
const bootIdPath = process.env.TRADING_KEYS_BOOT_ID_PATH ?? '/proc/sys/kernel/random/boot_id';

export const currentBootId = (): string => {
  if (process.env.TRADING_KEYS_TEST_BOOT_ID) return process.env.TRADING_KEYS_TEST_BOOT_ID;
  try { return fs.readFileSync(bootIdPath, 'utf8').trim(); } catch { return `platform:${process.platform}`; }
};
const releaseCommit = (): string => {
  if (process.env.TRADING_KEYS_RELEASE_COMMIT) return process.env.TRADING_KEYS_RELEASE_COMMIT;
  try { return fs.readFileSync(path.join(process.cwd(), 'DEPLOYED_COMMIT'), 'utf8').trim(); } catch { return 'source-worktree'; }
};
const linuxIdentity = (pid: number) => {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const end = stat.lastIndexOf(')');
  const fields = stat.slice(end + 2).split(' ');
  return {
    processStartTime: fields[19],
    commandArguments: fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean),
    cgroup: fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim(),
  };
};
const identity = (pid: number) => {
  if (process.platform === 'linux') return linuxIdentity(pid);
  process.kill(pid, 0);
  return {
    processStartTime: process.env.TRADING_KEYS_TEST_PROCESS_START_TIME ?? 'unsupported-platform',
    commandArguments: (process.env.TRADING_KEYS_TEST_PROCESS_COMMAND ?? process.argv.join(' ')).split(' '),
    cgroup: process.env.TRADING_KEYS_TEST_PROCESS_CGROUP ?? `platform:${process.platform}`,
  };
};

export const createRuntimeLease = (pid: number, expectedEntryPoint: string): AutomationRuntimeLease => {
  const found = identity(pid);
  return {
    pid, processStartTime: found.processStartTime, bootId: currentBootId(),
    expectedEntryPoint: path.resolve(expectedEntryPoint), releaseCommit: releaseCommit(),
    mode: 'demo', cgroup: found.cgroup, createdAt: new Date().toISOString(),
  };
};
export const writeRuntimeLease = (lease: AutomationRuntimeLease): void => {
  const target = runtimeLeasePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(lease, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, target);
};
export const readRuntimeLease = (): AutomationRuntimeLease | null => {
  try {
    const lease = JSON.parse(fs.readFileSync(runtimeLeasePath(), 'utf8')) as AutomationRuntimeLease;
    if (!lease || !Number.isSafeInteger(lease.pid) || lease.pid <= 0 || lease.mode !== 'demo' ||
      !lease.processStartTime || !lease.bootId || !lease.expectedEntryPoint || !lease.releaseCommit ||
      !lease.createdAt || !Number.isFinite(Date.parse(lease.createdAt))) return null;
    return lease;
  } catch { return null; }
};
export const validateRuntimeLease = (lease: AutomationRuntimeLease): boolean => {
  try {
    if (lease.bootId !== currentBootId() || lease.releaseCommit !== releaseCommit()) return false;
    const found = identity(lease.pid);
    return found.processStartTime === lease.processStartTime &&
      found.cgroup === lease.cgroup &&
      found.commandArguments.includes(lease.expectedEntryPoint);
  } catch { return false; }
};
export const clearRuntimeLease = (): void => {
  fs.rmSync(runtimeLeasePath(), { force: true });
};
export const validateAndClearStaleLease = (): AutomationRuntimeLease | null => {
  const lease = readRuntimeLease();
  if (lease && validateRuntimeLease(lease)) return lease;
  if (fs.existsSync(runtimeLeasePath())) clearRuntimeLease();
  return null;
};
