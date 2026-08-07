import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAutomationStrategyArtifact } from '../utils/automationStrategyArtifact.ts';
import { stagedStrategyPath } from '../utils/approvedStrategySync.ts';
import { GOLDILOCKS_BACKTEST_GATE_DEFAULTS,GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS,
  GOLDILOCKS_SCORE_WEIGHTS,GOLDILOCKS_STRATEGY_VERSION } from '../utils/goldilocksConfig.ts';
import { GOLDILOCKS_DEFAULT_MANAGEMENT } from '../utils/goldilocksTradeManagement.ts';
import type { AppliedAutomationStrategy } from '../utils/automationStore.ts';
import Database from 'better-sqlite3';

const waitFor=async(check:()=>Promise<boolean>|boolean,timeoutMs=15_000)=>{
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error('Timed out waiting for deterministic automation E2E state.');
};
const request=(port:number,route:string,method='GET')=>
  fetch(`http://127.0.0.1:${port}${route}`,{method}).then(async response=>{
    const body=await response.json();if(!response.ok)throw new Error(body.error??String(response.status));return body;
  });

test('multi-worker automation adopts approved configuration only across a stopped lifecycle boundary',async()=>{
  const port=4510+Math.floor(Math.random()*100),data=fs.mkdtempSync(path.join(os.tmpdir(),'trading-keys-e2e-'));
  const pairs=['EUR/USD','GBP/JPY'];
  const server=spawn(process.execPath,['--import','tsx','pi/controlServer.ts'],{
    cwd:process.cwd(),stdio:'ignore',env:{...process.env,PULSE_PORT:String(port),PULSE_HOST:'127.0.0.1',
      TRADING_KEYS_DATA_DIRECTORY:data,TRADING_KEYS_AUTOMATION_E2E:'true',
      TRADING_KEYS_E2E_PAIRS:pairs.join(','),TRADING_KEYS_WORKER_ENTRY:'./tests/fixtures/deterministicGoldilocksWorker.ts',
      TRADING_KEYS_PI_RUNTIME:'true',
      TRADING_KEYS_TEST_PROCESS_COMMAND:path.resolve('runner/startRunner.ts'),
      TRADING_KEYS_TEST_PROCESS_START_TIME:'fixture-runner-start',
      TRADING_KEYS_TEST_PROCESS_CGROUP:'fixture-cgroup'},
  });
  const resultsDirectory=path.join(data,'e2e-results');
  try{
    await waitFor(()=>fetch(`http://127.0.0.1:${port}/api/status`).then(r=>r.ok).catch(()=>false));
    await request(port,'/api/start','POST');
    await waitFor(()=>fs.existsSync(resultsDirectory)&&fs.readdirSync(resultsDirectory).length===pairs.length);
    const first=pairs.map(pair=>JSON.parse(fs.readFileSync(path.join(resultsDirectory,`${pair.replace('/','_')}.json`),'utf8')));
    assert.deepEqual(first.map(row=>row.pair).sort(),[...pairs].sort());
    assert.ok(first.every(row=>row.sourceRunUid==='built-in'&&row.archiveRows===17&&row.confirmations===1));
    assert.equal(new Set(first.map(row=>row.order.id)).size,pairs.length);
    assert.ok(first.every(row=>row.order.mode==='demo'&&row.order.transport==='fixture'));

    // Merely constructing a newer winner does not affect already-running workers.
    const approved=createAutomationStrategyArtifact({
      id:'approved-configuration-2',sourceRunUid:'GLR-APPROVED-E2E',
      appliedAt:'2030-01-01T00:00:00.000Z',previousId:null,
      config:{pairs,lookbackDays:730,minimumScore:14,label:'approved E2E',
        strategyVersion:GOLDILOCKS_STRATEGY_VERSION,timeframeProfile:'intraday',riskProfile:'default',
        tradeManager:GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,confirmationMode:'close-through',
        closeTradesBeforeWeekend:true,strategyTweaks:{...GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS},
        gateSettings:{...GOLDILOCKS_BACKTEST_GATE_DEFAULTS},scoreWeights:{...GOLDILOCKS_SCORE_WEIGHTS}},
    } as AppliedAutomationStrategy);
    assert.ok(first.every(row=>row.sourceRunUid!=='GLR-APPROVED-E2E'));

    const staged=stagedStrategyPath(data);
    fs.mkdirSync(path.dirname(staged),{recursive:true});
    fs.writeFileSync(staged,JSON.stringify(approved,null,2));
    await assert.rejects(request(port,'/api/start','POST'),/stopped automation lifecycle/);
    await request(port,'/api/stop','POST');
    const db=new Database(path.join(data,'automation.sqlite'));
    db.prepare(`INSERT INTO active_trades(pair,trade_id,direction,entry,stop_loss,take_profit,mode,opened_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run('EUR/USD','fixture-open','BUY',1,0.9,1.2,'demo',
        '2026-07-29T00:00:00.000Z','2026-07-29T00:00:00.000Z');
    db.close();
    await assert.rejects(request(port,'/api/start','POST'),/open trade/);
    const cleanup=new Database(path.join(data,'automation.sqlite'));
    cleanup.prepare('DELETE FROM active_trades WHERE trade_id=?').run('fixture-open');
    cleanup.close();
    fs.rmSync(resultsDirectory,{recursive:true,force:true});
    await request(port,'/api/start','POST');
    await waitFor(()=>fs.existsSync(resultsDirectory)&&fs.readdirSync(resultsDirectory).length===pairs.length);
    const second=pairs.map(pair=>JSON.parse(fs.readFileSync(path.join(resultsDirectory,`${pair.replace('/','_')}.json`),'utf8')));
    assert.ok(second.every(row=>row.sourceRunUid==='GLR-APPROVED-E2E'));
    assert.equal(new Set(second.map(row=>row.order.id)).size,pairs.length);
    await request(port,'/api/stop','POST');
    const stopped=await request(port,'/api/status');
    assert.equal(stopped.runtime.running,false);
  }finally{
    await request(port,'/api/stop','POST').catch(()=>{});
    server.kill('SIGTERM');
    await waitFor(()=>server.exitCode!==null||server.killed,5_000).catch(()=>{});
  }
});
