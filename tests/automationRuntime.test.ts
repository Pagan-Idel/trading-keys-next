import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pruneOldestSetEntries,shouldPersistWorkerStatus,workerScanJitterMs,
} from '../utils/workerRuntime.ts';
import { assertResearchAllowed } from '../utils/piRuntimeGuard.ts';
import {
  automationStrategyContentHash,createAutomationStrategyArtifact,
  validateAutomationStrategyArtifact,
} from '../utils/automationStrategyArtifact.ts';
import type { AppliedAutomationStrategy } from '../utils/automationStore.ts';
import { fetchAndStageApprovedStrategy,validateApprovedStrategyManifest } from '../utils/approvedStrategySync.ts';
import { createApprovedStrategyPoller } from '../utils/approvedStrategyPoller.ts';
import { GOLDILOCKS_BACKTEST_GATE_DEFAULTS,GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS,
  GOLDILOCKS_SCORE_WEIGHTS,GOLDILOCKS_STRATEGY_VERSION } from '../utils/goldilocksConfig.ts';
import { GOLDILOCKS_DEFAULT_MANAGEMENT } from '../utils/goldilocksTradeManagement.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('confirmation cache pruning retains only the newest bounded entries',()=>{
  const values=new Set(['one','two','three','four']);
  assert.equal(pruneOldestSetEntries(values,2),2);
  assert.deepEqual([...values],['three','four']);
});

test('worker scan jitter is deterministic, bounded, and pair-specific',()=>{
  assert.equal(workerScanJitterMs('EUR/USD'),workerScanJitterMs('EUR/USD'));
  assert.ok(workerScanJitterMs('EUR/USD')>=0&&workerScanJitterMs('EUR/USD')<=1_500);
  assert.notEqual(workerScanJitterMs('EUR/USD'),workerScanJitterMs('GBP/JPY'));
});

test('unchanged worker status is suppressed until its controlled heartbeat',()=>{
  const now=Date.parse('2026-07-28T12:00:00.000Z');
  const previous={state:'waiting',step:'waiting_for_confirmation',message:'Waiting',mode:'demo',pid:42,
    updatedAt:'2026-07-28T11:59:00.000Z'};
  const next={state:'waiting',step:'waiting_for_confirmation',message:'Waiting',mode:'demo',pid:42};
  assert.equal(shouldPersistWorkerStatus(previous,next,now),false);
  assert.equal(shouldPersistWorkerStatus(previous,next,now+5*60*1000),true);
  assert.equal(shouldPersistWorkerStatus(previous,{...next,message:'Changed'},now),true);
});

test('research is blocked only inside the explicit Pi runtime',()=>{
  const original=process.env.TRADING_KEYS_PI_RUNTIME;
  try{
    delete process.env.TRADING_KEYS_PI_RUNTIME;
    assert.doesNotThrow(assertResearchAllowed);
    process.env.TRADING_KEYS_PI_RUNTIME='true';
    assert.throws(assertResearchAllowed,/disabled in the Raspberry Pi/);
  }finally{
    if(original===undefined)delete process.env.TRADING_KEYS_PI_RUNTIME;
    else process.env.TRADING_KEYS_PI_RUNTIME=original;
  }
});

test('approved strategy artifacts are immutable and hash-validated',()=>{
  const strategy={
    id:'version-1',sourceRunUid:'GLR-APPROVED',appliedAt:'2026-07-28T12:00:00.000Z',previousId:null,
    config:{pairs:['EUR/USD'],lookbackDays:730,minimumScore:14,label:'approved'},
  } as AppliedAutomationStrategy;
  const artifact=createAutomationStrategyArtifact(strategy);
  assert.equal(artifact.contentHash,automationStrategyContentHash(strategy.config));
  assert.deepEqual(validateAutomationStrategyArtifact(artifact),artifact);
  assert.throws(()=>validateAutomationStrategyArtifact({...artifact,config:{...artifact.config,minimumScore:15}}),/hash is invalid/);
});

const compatibleStrategy=(id='version-2',approvedAt='2026-07-29T12:00:00.000Z')=>{
  const strategy={
    id,sourceRunUid:`GLR-${id}`,appliedAt:approvedAt,previousId:null,
    config:{pairs:['EUR/USD'],lookbackDays:730,minimumScore:14,label:'approved',
      strategyVersion:GOLDILOCKS_STRATEGY_VERSION,timeframeProfile:'intraday' as const,
      riskProfile:'default' as const,tradeManager:GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,
      confirmationMode:'close-through' as const,closeTradesBeforeWeekend:true,
      strategyTweaks:{...GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS},
      gateSettings:{...GOLDILOCKS_BACKTEST_GATE_DEFAULTS},scoreWeights:{...GOLDILOCKS_SCORE_WEIGHTS}},
  } as AppliedAutomationStrategy;
  const artifact=createAutomationStrategyArtifact(strategy);
  return {schemaVersion:1,configurationId:artifact.versionId,createdAt:artifact.createdAt,
    activatedAt:artifact.approvedAt,contentHash:artifact.contentHash,artifact};
};

test('approved configuration sync stages only a newer authenticated artifact',async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'strategy-sync-'));
  const manifest=compatibleStrategy();
  const fetcher=async(_input:URL|RequestInfo,_init?:RequestInit)=>
    new Response(JSON.stringify(manifest),{status:200,headers:{'Content-Type':'application/json'}});
  const staged=await fetchAndStageApprovedStrategy({endpoint:'https://config.example/approved',token:'read-only',
    currentId:'version-1',currentApprovedAt:'2026-07-28T12:00:00.000Z',dataDirectory:data,fetcher:fetcher as typeof fetch});
  assert.equal(staged.status,'staged');
  assert.ok(fs.existsSync(String(staged.stagedPath)));
  const current=await fetchAndStageApprovedStrategy({endpoint:'https://config.example/approved',token:'read-only',
    currentId:'version-2',currentApprovedAt:'2026-07-29T12:00:00.000Z',dataDirectory:data,fetcher:fetcher as typeof fetch});
  assert.equal(current.status,'current');
  const older=compatibleStrategy('version-between','2026-07-28T18:00:00.000Z');
  await assert.rejects(fetchAndStageApprovedStrategy({endpoint:'https://config.example/approved',token:'read-only',
    currentId:'version-1',currentApprovedAt:'2026-07-28T12:00:00.000Z',dataDirectory:data,
    fetcher:(async()=>new Response(JSON.stringify(older),{status:200})) as typeof fetch}),/downgrade/);
});

test('approved configuration sync rejects malformed, incompatible, downgrade, auth, and network failures',async()=>{
  const valid=compatibleStrategy();
  assert.throws(()=>validateApprovedStrategyManifest({...valid,schemaVersion:99}),/malformed/);
  assert.throws(()=>validateApprovedStrategyManifest({...valid,artifact:{...valid.artifact,
    config:{...valid.artifact.config,timeframeProfile:'higherTimeframe'}}}),/hash is invalid/);
  const response=(status:number,body:unknown)=>async()=>new Response(JSON.stringify(body),{status});
  await assert.rejects(fetchAndStageApprovedStrategy({endpoint:'https://config.example/approved',token:'bad',
    currentId:'old',currentApprovedAt:'2026-07-28T12:00:00.000Z',fetcher:response(401,{}) as typeof fetch}),/HTTP 401/);
  await assert.rejects(fetchAndStageApprovedStrategy({endpoint:'https://config.example/approved',token:'token',
    currentId:'new',currentApprovedAt:'2026-07-30T12:00:00.000Z',fetcher:response(200,valid) as typeof fetch}),/downgrade/);
  await assert.rejects(fetchAndStageApprovedStrategy({endpoint:'https://config.example/approved',token:'token',
    currentId:'old',currentApprovedAt:'2026-07-28T12:00:00.000Z',
    fetcher:(async()=>{throw new Error('offline')}) as typeof fetch}),/offline/);
});

test('approved strategy poller never overlaps, backs off, and cancels its timer',async()=>{
  const callbacks:Array<()=>void>=[],delays:number[]=[];
  let release!:()=>void,calls=0;
  const pending=new Promise<void>(resolve=>{release=resolve});
  const events:string[]=[];
  const poller=createApprovedStrategyPoller({
    endpoint:'https://config.example/approved',token:'secret-that-must-not-be-logged',
    intervalMs:300_000,getCurrent:()=>({id:'version-1',approvedAt:'2026-07-28T12:00:00.000Z'}),
    fetcher:(async()=>{calls++;await pending;throw new Error('offline secret-that-must-not-be-logged')}) as typeof fetch,
    onEvent:(event,data)=>events.push(`${event}:${JSON.stringify(data??{})}`),
    setTimer:(callback,delay)=>{callbacks.push(callback);delays.push(delay);return {unref(){}} as NodeJS.Timeout},
    clearTimer:()=>undefined,
  });
  poller.start();
  assert.equal(delays[0],0);
  callbacks.shift()!();
  await Promise.resolve();
  assert.equal(poller.running,true);
  assert.deepEqual(await poller.check(),{status:'unavailable'});
  assert.equal(calls,1);
  release();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(delays.at(-1),600_000);
  assert.ok(events.some(event=>event.startsWith('rejected:')));
  assert.ok(events.every(event=>!event.includes('secret-that-must-not-be-logged')));
  poller.stop();
});

test('approved strategy poller resets backoff after success and aborts an active request on shutdown',async()=>{
  const callbacks:Array<()=>void>=[],delays:number[]=[];
  let attempt=0;
  const poller=createApprovedStrategyPoller({
    endpoint:'https://config.example/approved',token:'read-only',intervalMs:30_000,
    getCurrent:()=>({id:'version-1',approvedAt:'2026-07-28T12:00:00.000Z'}),
    fetcher:(async()=>attempt++===0
      ?Promise.reject(new Error('offline'))
      :new Response(JSON.stringify(compatibleStrategy('version-1','2026-07-28T12:00:00.000Z')),{status:200})) as typeof fetch,
    onEvent:()=>undefined,
    setTimer:(callback,delay)=>{callbacks.push(callback);delays.push(delay);return {unref(){}} as NodeJS.Timeout},
    clearTimer:()=>undefined,
  });
  poller.start();
  callbacks.shift()!();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(delays.at(-1),60_000);
  callbacks.pop()!();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(delays.at(-1),30_000);
  poller.stop();

  let aborted=false;
  const active=createApprovedStrategyPoller({
    endpoint:'https://config.example/approved',token:'read-only',intervalMs:Number.NaN,
    getCurrent:()=>({id:'version-1',approvedAt:'2026-07-28T12:00:00.000Z'}),
    fetcher:((_input,_init)=>new Promise((_resolve,reject)=>{
      _init?.signal?.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'))});
    })) as typeof fetch,
    onEvent:()=>undefined,
    setTimer:(callback)=>{callbacks.push(callback);return {unref(){}} as NodeJS.Timeout},
    clearTimer:()=>undefined,
  });
  active.start();
  callbacks.pop()!();
  await Promise.resolve();
  await active.close();
  assert.equal(aborted,true);
  assert.equal(active.running,false);
});
