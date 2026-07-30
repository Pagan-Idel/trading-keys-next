import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

test('a failed worker spawn is not represented as running',async()=>{
  process.env.TRADING_KEYS_WORKER_ENTRY=path.resolve('tests/fixtures/failingWorker.mjs');
  const {refreshWorkers,runningWorkerPairs}=await import('../runner/strategyRunner.ts');
  const result=await refreshWorkers(['EUR/USD'],'demo');
  assert.deepEqual(result.failed,['EUR/USD']);
  assert.deepEqual(result.running,[]);
  assert.deepEqual(runningWorkerPairs(),[]);
});
