import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

test('a failed worker spawn is not represented as running',async()=>{
  process.env.TRADING_KEYS_WORKER_ENTRY=path.resolve('tests/fixtures/failingWorker.mjs');
  const {refreshWorkers,runningWorkerPairs,shouldRestartWorker}=await import('../runner/strategyRunner.ts');
  const waitForFailure=async(child:ChildProcess)=>{
    if(child.exitCode===null)await once(child,'exit');
  };
  const result=await refreshWorkers(['EUR/USD'],'demo',waitForFailure);
  assert.deepEqual(result.failed,['EUR/USD']);
  assert.deepEqual(result.running,[]);
  assert.deepEqual(runningWorkerPairs(),[]);
  assert.equal(shouldRestartWorker(false,false,1),false);
  assert.equal(shouldRestartWorker(true,false,0),false);
  assert.equal(shouldRestartWorker(true,true,1),false);
  assert.equal(shouldRestartWorker(true,false,1),true);
});
