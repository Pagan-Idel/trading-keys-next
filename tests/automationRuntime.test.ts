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
