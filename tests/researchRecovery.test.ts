import assert from 'node:assert/strict';
import test from 'node:test';
import {recoverInterruptedBacktestForWorker} from '../utils/backtestRunner.ts';

test('startup recovery retires the active backtest owned by the interrupted research worker',()=>{
  const updates:Array<{id:string;fields:Record<string,unknown>}>=[];
  const events:Array<{id:string;step:string;message:string}>=[];
  const result=recoverInterruptedBacktestForWorker(30508,{
    getActiveBacktestRun:()=>({id:'stale-run'}),
    getBacktestRuntime:()=>({id:'stale-run',status:'running',workerPid:30508}),
    updateBacktestRun:(id,fields)=>{updates.push({id,fields})},
    addBacktestEvent:(id,step,message)=>{events.push({id,step,message});return {} as never},
  },new Date('2026-08-05T13:24:50.000Z'));

  assert.deepEqual(result,{id:'stale-run',status:'failed',interruptedWorkerPid:30508});
  assert.deepEqual(updates,[{id:'stale-run',fields:{
    status:'failed',completedAt:'2026-08-05T13:24:50.000Z',progressStage:'interrupted',
    heartbeatAt:'2026-08-05T13:24:50.000Z',workerPid:null,
    error:'Recovered after the interrupted research worker ended before this backtest completed.',
  }}]);
  assert.equal(events[0]?.step,'run_interrupted_recovered');
});

test('startup recovery does not retire an unrelated manual backtest',()=>{
  let changed=false;
  const result=recoverInterruptedBacktestForWorker(30508,{
    getActiveBacktestRun:()=>({id:'manual-run'}),
    getBacktestRuntime:()=>({id:'manual-run',status:'running',workerPid:41000}),
    updateBacktestRun:()=>{changed=true},
    addBacktestEvent:()=>{changed=true;return {} as never},
  });
  assert.equal(result,null);
  assert.equal(changed,false);
});
