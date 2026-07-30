import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { desiredStatePath, readAutomationDesiredState, writeAutomationDesiredState } from '../utils/automationDesiredState.ts';
import {
  clearRuntimeLease, createRuntimeLease, currentBootId, runtimeLeasePath,
  validateAndClearStaleLease, validateRuntimeLease, writeRuntimeLease,
} from '../utils/automationRuntimeLease.ts';
import { getEligibleWorkerPairs } from '../runner/strategyRunner.ts';
import { isTradeSessionOpen } from '../utils/sessionUtils.ts';

const withData = (run: (directory: string) => void) => {
  const previous = process.env.TRADING_KEYS_DATA_DIRECTORY;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-boot-state-'));
  process.env.TRADING_KEYS_DATA_DIRECTORY = directory;
  try { run(directory); } finally {
    clearRuntimeLease();
    if (previous === undefined) delete process.env.TRADING_KEYS_DATA_DIRECTORY;
    else process.env.TRADING_KEYS_DATA_DIRECTORY = previous;
  }
};

test('missing and corrupt desired state fail closed to stopped', () => withData(() => {
  assert.equal(readAutomationDesiredState().desiredState, 'stopped');
  fs.writeFileSync(desiredStatePath(), '{"desiredState":"running"');
  assert.equal(readAutomationDesiredState().desiredState, 'stopped');
}));

test('desired state is atomic, revisioned, and preserves manual intent', () => withData(() => {
  const running = writeAutomationDesiredState('running', 'authenticated-api-start');
  const stopped = writeAutomationDesiredState('stopped', 'authenticated-api-stop');
  assert.equal(running.revision, 1);
  assert.equal(stopped.revision, 2);
  assert.equal(readAutomationDesiredState().desiredState, 'stopped');
}));

test('an active desired-state writer cannot be silently overwritten',()=>withData(directory=>{
  const lock=path.join(directory,'automation-desired-state.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({
    pid:process.pid,bootId:currentBootId(),
  }));
  assert.throws(()=>writeAutomationDesiredState('running','concurrent-writer'),/already in progress/);
  assert.equal(readAutomationDesiredState().desiredState,'stopped');
  fs.rmSync(lock,{recursive:true,force:true});
}));

test('previous-boot and malformed runtime leases are rejected and removed', () => withData(() => {
  const entry = path.resolve('tests/fixtures/fakeAutomationRunner.mjs');
  process.env.TRADING_KEYS_TEST_PROCESS_COMMAND = `${process.execPath} ${entry}`;
  process.env.TRADING_KEYS_TEST_PROCESS_START_TIME = 'identity-one';
  process.env.TRADING_KEYS_TEST_PROCESS_CGROUP = 'test-cgroup';
  process.env.TRADING_KEYS_TEST_BOOT_ID = 'boot-one';
  const lease = createRuntimeLease(process.pid, entry);
  writeRuntimeLease({ ...lease, bootId: 'previous-boot' });
  assert.equal(validateAndClearStaleLease(), null);
  assert.equal(fs.existsSync(runtimeLeasePath()), false);
  fs.writeFileSync(runtimeLeasePath(), '{"pid":"wrong"}');
  assert.equal(validateAndClearStaleLease(), null);
  assert.equal(fs.existsSync(runtimeLeasePath()), false);
  delete process.env.TRADING_KEYS_TEST_BOOT_ID;
}));

test('PID reuse with a different process identity is rejected', () => withData(() => {
  const entry = path.resolve('tests/fixtures/fakeAutomationRunner.mjs');
  process.env.TRADING_KEYS_TEST_PROCESS_COMMAND = `${process.execPath} ${entry}`;
  process.env.TRADING_KEYS_TEST_PROCESS_START_TIME = 'original-start';
  process.env.TRADING_KEYS_TEST_PROCESS_CGROUP = 'test-cgroup';
  const lease = createRuntimeLease(process.pid, entry);
  process.env.TRADING_KEYS_TEST_PROCESS_START_TIME = 'reused-pid-start';
  assert.equal(validateRuntimeLease(lease), false);
}));

test('valid lease requires boot, command, start time, cgroup, release, and demo mode', () => withData(() => {
  const entry = path.resolve('tests/fixtures/fakeAutomationRunner.mjs');
  process.env.TRADING_KEYS_TEST_PROCESS_COMMAND = `${process.execPath} ${entry}`;
  process.env.TRADING_KEYS_TEST_PROCESS_START_TIME = 'same-start';
  process.env.TRADING_KEYS_TEST_PROCESS_CGROUP = 'same-cgroup';
  const lease = createRuntimeLease(process.pid, entry);
  assert.equal(lease.bootId, currentBootId());
  assert.equal(validateRuntimeLease(lease), true);
  assert.equal(validateRuntimeLease({ ...lease, expectedEntryPoint: path.resolve('unrelated.mjs') }), false);
  assert.equal(validateRuntimeLease({...lease,cgroup:'unrelated-cgroup'}),false);
  process.env.TRADING_KEYS_RELEASE_COMMIT='different-release';
  assert.equal(validateRuntimeLease(lease),false);
  delete process.env.TRADING_KEYS_RELEASE_COMMIT;
}));

test('initial worker eligibility uses the same session filter and fails closed for news', async () => {
  const now = new Date('2026-07-29T14:00:00.000Z');
  const pairs = ['EUR/USD', 'EUR/JPY', 'NZD/USD'];
  const sessionEligible = pairs.filter(pair => isTradeSessionOpen(pair, now));
  const newsBlockedPair = sessionEligible[0];
  const eligible = await getEligibleWorkerPairs(pairs, now, async pair => pair === newsBlockedPair);
  assert.deepEqual(eligible, sessionEligible.filter(pair => pair !== newsBlockedPair));
  assert.equal(new Set(eligible).size, eligible.length);
});
