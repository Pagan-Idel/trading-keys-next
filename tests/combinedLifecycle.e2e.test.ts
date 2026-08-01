import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn,type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAutomationStrategyArtifact } from '../utils/automationStrategyArtifact.ts';
import { createApprovedStrategyPoller } from '../utils/approvedStrategyPoller.ts';
import { stagedStrategyPath } from '../utils/approvedStrategySync.ts';
import { getHubInterestSnapshot,updateHubInterest } from '../utils/oanda/api/marketDataHub.ts';
import { GOLDILOCKS_BACKTEST_GATE_DEFAULTS,GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS,
  GOLDILOCKS_SCORE_WEIGHTS,GOLDILOCKS_STRATEGY_VERSION } from '../utils/goldilocksConfig.ts';
import { GOLDILOCKS_DEFAULT_MANAGEMENT } from '../utils/goldilocksTradeManagement.ts';
import type { AppliedAutomationStrategy } from '../utils/automationStore.ts';

const waitFor=async(check:()=>Promise<boolean>|boolean,timeoutMs=15_000)=>{
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50))}
  throw new Error('Timed out waiting for combined lifecycle state.');
};
const request=(port:number,route:string,method='GET')=>fetch(`http://127.0.0.1:${port}${route}`,{method}).then(async response=>{
  const body=await response.json();if(!response.ok)throw new Error(body.error??String(response.status));return body;
});
const manifest=(id:string,sourceRunUid:string,approvedAt:string)=>{
  const artifact=createAutomationStrategyArtifact({id,sourceRunUid,appliedAt:approvedAt,previousId:null,
    config:{pairs:['EUR/USD'],lookbackDays:730,minimumScore:14,label:sourceRunUid,
      strategyVersion:GOLDILOCKS_STRATEGY_VERSION,timeframeProfile:'intraday',riskProfile:'default',
      tradeManager:GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,confirmationMode:'close-through',closeTradesBeforeWeekend:true,
      strategyTweaks:{...GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS},gateSettings:{...GOLDILOCKS_BACKTEST_GATE_DEFAULTS},
      scoreWeights:{...GOLDILOCKS_SCORE_WEIGHTS}},} as AppliedAutomationStrategy);
  return {schemaVersion:1,configurationId:artifact.versionId,createdAt:artifact.createdAt,
    activatedAt:artifact.approvedAt,contentHash:artifact.contentHash,artifact};
};
const startServer=(port:number,data:string)=>spawn(process.execPath,['--import','tsx','pi/controlServer.ts'],{
  cwd:process.cwd(),stdio:'ignore',env:{...process.env,PULSE_PORT:String(port),PULSE_HOST:'127.0.0.1',
    TRADING_KEYS_DATA_DIRECTORY:data,TRADING_KEYS_AUTOMATION_E2E:'true',TRADING_KEYS_E2E_PAIRS:'EUR/USD',
    TRADING_KEYS_WORKER_ENTRY:'./tests/fixtures/deterministicLifecycleWorker.ts',
    TRADING_KEYS_COLLECTOR_ENTRY:'./tests/fixtures/deterministicCandleCollector.ts',TRADING_KEYS_PI_RUNTIME:'true',
    TRADING_KEYS_TEST_PROCESS_COMMAND:path.resolve('runner/startRunner.ts'),TRADING_KEYS_TEST_PROCESS_START_TIME:'combined-start',
    TRADING_KEYS_TEST_PROCESS_CGROUP:'combined-cgroup'},
});
const stopServer=async(server:ChildProcess)=>{
  if(server.exitCode!==null||server.signalCode!==null)return;
  server.kill('SIGTERM');
  await waitFor(()=>server.exitCode!==null||server.signalCode!==null,15_000);
};
const processAlive=(pid:number)=>{try{process.kill(pid,0);return true}catch{return false}};

test('approved strategy staging, collectors, leases, shutdown, activation, and boot recovery compose safely',async()=>{
  const port=4700+Math.floor(Math.random()*100),data=fs.mkdtempSync(path.join(os.tmpdir(),'combined-lifecycle-'));
  const workerFile=path.join(data,'combined-workers','EUR_USD.json');
  const collectorFile=path.join(data,'combined-collectors','EUR_USD.json');
  let server=startServer(port,data);
  try{
    await waitFor(()=>fetch(`http://127.0.0.1:${port}/api/status`).then(response=>response.ok).catch(()=>false));
    await request(port,'/api/start','POST');
    await waitFor(()=>fs.existsSync(workerFile)&&fs.existsSync(collectorFile));
    const initialWorker=JSON.parse(fs.readFileSync(workerFile,'utf8'));
    const initialCollector=JSON.parse(fs.readFileSync(collectorFile,'utf8'));
    assert.equal(initialWorker.sourceRunUid,'built-in');assert.equal(initialWorker.orderAttempts,0);
    assert.equal(initialCollector.rowsWritten,6);assert.deepEqual(getHubInterestSnapshot().instruments,[]);

    const winner=manifest('combined-approved-2','GLR-COMBINED-APPROVED','2030-01-01T00:00:00.000Z');
    assert.equal(JSON.parse(fs.readFileSync(workerFile,'utf8')).sourceRunUid,'built-in');
    const poller=createApprovedStrategyPoller({endpoint:'https://config.invalid/approved',token:'fixture-token',intervalMs:30_000,
      dataDirectory:data,getCurrent:()=>({id:'built-in',approvedAt:'2020-01-01T00:00:00.000Z'}),
      fetcher:(async()=>new Response(JSON.stringify(winner),{status:200})) as typeof fetch,onEvent:()=>undefined});
    poller.start();await waitFor(()=>fs.existsSync(stagedStrategyPath(data)));await poller.close();
    assert.equal(JSON.parse(fs.readFileSync(workerFile,'utf8')).sourceRunUid,'built-in');
    assert.equal(JSON.parse(fs.readFileSync(collectorFile,'utf8')).pid,initialCollector.pid);

    updateHubInterest('EUR_USD','zone-fixture',true);assert.deepEqual(getHubInterestSnapshot().instruments,['EUR_USD']);
    updateHubInterest('EUR_USD','zone-fixture',false);assert.deepEqual(getHubInterestSnapshot().instruments,[]);
    await request(port,'/api/stop','POST');
    assert.equal(processAlive(initialWorker.pid),false);assert.equal(processAlive(initialCollector.pid),false);
    await request(port,'/api/start','POST');
    await waitFor(()=>JSON.parse(fs.readFileSync(workerFile,'utf8')).runs===2&&JSON.parse(fs.readFileSync(collectorFile,'utf8')).runs===2);
    assert.equal(JSON.parse(fs.readFileSync(workerFile,'utf8')).sourceRunUid,'GLR-COMBINED-APPROVED');
    assert.equal(JSON.parse(fs.readFileSync(collectorFile,'utf8')).rowsWritten,0);

    const stagedOnly=manifest('combined-approved-3','GLR-STAGED-BOOT-MUST-NOT-ACTIVATE','2031-01-01T00:00:00.000Z');
    const bootPoller=createApprovedStrategyPoller({endpoint:'https://config.invalid/approved',token:'fixture-token',intervalMs:30_000,
      dataDirectory:data,getCurrent:()=>({id:'combined-approved-2',approvedAt:'2030-01-01T00:00:00.000Z'}),
      fetcher:(async()=>new Response(JSON.stringify(stagedOnly),{status:200})) as typeof fetch,onEvent:()=>undefined});
    bootPoller.start();await waitFor(()=>fs.existsSync(stagedStrategyPath(data))&&
      JSON.parse(fs.readFileSync(stagedStrategyPath(data),'utf8')).sourceRunUid===stagedOnly.artifact.sourceRunUid);
    await bootPoller.close();await stopServer(server);server=startServer(port,data);
    await waitFor(()=>fetch(`http://127.0.0.1:${port}/api/status`).then(response=>response.ok).catch(()=>false));
    const recovered=await request(port,'/api/status');
    assert.equal(recovered.runtime.running,true);
    assert.equal(recovered.dashboard.appliedStrategy.sourceRunUid,'GLR-COMBINED-APPROVED');
    assert.equal(recovered.stagedStrategy,'GLR-STAGED-BOOT-MUST-NOT-ACTIVATE');
    assert.equal(JSON.parse(fs.readFileSync(workerFile,'utf8')).runs,2);
    assert.equal(JSON.parse(fs.readFileSync(collectorFile,'utf8')).runs,2);
    assert.equal(JSON.parse(fs.readFileSync(workerFile,'utf8')).sourceRunUid,'GLR-COMBINED-APPROVED');
    assert.equal(JSON.parse(fs.readFileSync(workerFile,'utf8')).orderAttempts,0);
    await request(port,'/api/stop','POST');
  }finally{
    await request(port,'/api/stop','POST').catch(()=>{});
    if(server.exitCode===null&&server.signalCode===null)await stopServer(server).catch(()=>server.kill('SIGKILL'));
    updateHubInterest('EUR_USD','zone-fixture',false);
    if(process.env.TRADING_KEYS_KEEP_FAILED_E2E!=='true')fs.rmSync(data,{recursive:true,force:true});
  }
});
