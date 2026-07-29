import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  GOLDILOCKS_BACKTEST_GATE_DEFAULTS,GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS,
  GOLDILOCKS_SCORE_WEIGHTS,GOLDILOCKS_STRATEGY_VERSION,
} from '../utils/goldilocksConfig.ts';
import { GOLDILOCKS_DEFAULT_MANAGEMENT } from '../utils/goldilocksTradeManagement.ts';

const invoke=async(handler:any,request:any)=>{
  let statusCode=200,body:any;
  const response={setHeader(){},status(code:number){statusCode=code;return this},json(value:any){body=value;return this}};
  await handler(request,response);
  return {statusCode,body};
};
const waitFor=async(check:()=>boolean,timeoutMs=15_000)=>{
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){if(check())return;await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error('Timed out waiting for Switch to latest integration state.');
};

test('Switch to latest is the authoritative approval gate exported to Pi sync',async()=>{
  const repository=process.cwd(),isolated=fs.mkdtempSync(path.join(os.tmpdir(),'switch-to-latest-'));
  const originalCwd=process.cwd();
  let processManagerRef:typeof import('../utils/automationProcessManager.ts')|undefined;
  process.chdir(isolated);
  process.env.AUTOMATION_CONFIG_READ_TOKEN='scoped-read-token';
  process.env.TRADING_KEYS_DATA_DIRECTORY=path.join(isolated,'authoritative-data');
  process.env.TRADING_KEYS_AUTOMATION_E2E='true';
  process.env.TRADING_KEYS_E2E_PAIRS='EUR/USD,GBP/JPY';
  process.env.TRADING_KEYS_RUNNER_ENTRY=path.join(repository,'runner/startRunner.ts');
  process.env.TRADING_KEYS_WORKER_ENTRY=path.join(repository,'tests/fixtures/deterministicGoldilocksWorker.ts');
  try{
    const [{default:dashboardHandler},{default:approvedHandler},automation,processManager,promotion,sync]=await Promise.all([
      import('../pages/api/automation/dashboard.ts'),
      import('../pages/api/automation/approved-strategy.ts'),
      import('../utils/automationStore.ts').then(automation=>({automation})),
      import('../utils/automationProcessManager.ts').then(processManager=>({processManager})),
      import('../utils/automationStrategyPromotion.ts').then(promotion=>({promotion})),
      import('../utils/approvedStrategySync.ts').then(sync=>({sync})),
    ]).then(([dashboard,approved,{automation},{processManager},{promotion},{sync}])=>
      [dashboard,approved,automation,processManager,promotion,sync] as any);
    processManagerRef=processManager;
    const old=automation.getAppliedAutomationStrategy();
    const config={
      pairs:['EUR/USD','GBP/JPY'],lookbackDays:730,minimumScore:14,label:'sealed approved winner',
      strategyVersion:GOLDILOCKS_STRATEGY_VERSION,timeframeProfile:'intraday',riskProfile:'default',
      tradeManager:GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,confirmationMode:'close-through',
      closeTradesBeforeWeekend:true,strategyTweaks:{...GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS},
      gateSettings:{...GOLDILOCKS_BACKTEST_GATE_DEFAULTS},scoreWeights:{...GOLDILOCKS_SCORE_WEIGHTS},
      datasetEndTime:1_785_283_200,datasetKey:'sealed-switch-transaction',
    };
    promotion.getLatestAutomationRecommendation(); // Initialize both authoritative stores.
    const automationDb=new Database(path.join(isolated,'data','automation.sqlite'));
    automationDb.prepare(`INSERT INTO backtest_leaderboard(
      run_uid,source_run_id,label,config_json,completed_at,net_r,metrics_json,recorded_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run('GLR-SWITCH-WINNER','winner-run-id',config.label,JSON.stringify(config),
      '2030-01-01T00:00:00.000Z',25,JSON.stringify({netR:25}),'2030-01-01T00:00:00.000Z');
    automationDb.close();
    const researchDb=new Database(path.join(isolated,'data','goldilocks-research.sqlite'));
    researchDb.exec(`CREATE TABLE research_campaigns(
      id TEXT PRIMARY KEY,status TEXT NOT NULL,label TEXT NOT NULL,config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,feedback_json TEXT
    )`);
    researchDb.prepare(`INSERT INTO research_campaigns(
      id,status,label,config_json,created_at,updated_at,feedback_json
    ) VALUES(?,?,?,?,?,?,?)`).run('campaign','completed','fixture','{}','2030-01-01T00:00:00.000Z',
      '2030-01-01T00:00:00.000Z',JSON.stringify({decisions:[{promoted:true,backtestRunId:'winner-run-id'}]}));
    researchDb.close();

    const endpointRequest={method:'GET',headers:{authorization:'Bearer scoped-read-token'}};
    const before=await invoke(approvedHandler,endpointRequest);
    assert.equal(before.body.configurationId,old.id,'an unapproved winner must not be exported');

    processManager.startDemoAutomation();
    const resultDirectory=path.join(process.env.TRADING_KEYS_DATA_DIRECTORY,'e2e-results');
    await waitFor(()=>fs.existsSync(resultDirectory)&&fs.readdirSync(resultDirectory).length===2);
    const runningRows=fs.readdirSync(resultDirectory).map(name=>JSON.parse(fs.readFileSync(path.join(resultDirectory,name),'utf8')));
    assert.ok(runningRows.every(row=>row.sourceRunUid===old.sourceRunUid));
    const rejectedWhileRunning=await invoke(dashboardHandler,{method:'POST',query:{},body:{action:'move-to-latest'}});
    assert.equal(rejectedWhileRunning.statusCode,409);
    processManager.stopAutomation();

    const switched=await invoke(dashboardHandler,{method:'POST',query:{},body:{action:'move-to-latest'}});
    assert.equal(switched.statusCode,200);
    assert.equal(switched.body.appliedStrategy.sourceRunUid,'GLR-SWITCH-WINNER');
    const after=await invoke(approvedHandler,endpointRequest);
    assert.equal(after.body.artifact.sourceRunUid,'GLR-SWITCH-WINNER');
    const piData=path.join(isolated,'pi-data');
    const staged=await sync.fetchAndStageApprovedStrategy({
      endpoint:'https://authoritative.example/api/automation/approved-strategy',token:'scoped-read-token',
      currentId:old.id,currentApprovedAt:old.appliedAt,dataDirectory:piData,
      fetcher:(async()=>new Response(JSON.stringify(after.body),{status:200})) as typeof fetch,
    });
    assert.equal(staged.configurationId,after.body.configurationId);
    assert.equal(sync.readStagedApprovedStrategy(piData)?.sourceRunUid,'GLR-SWITCH-WINNER');

    fs.rmSync(resultDirectory,{recursive:true,force:true});
    processManager.startDemoAutomation();
    await waitFor(()=>fs.existsSync(resultDirectory)&&fs.readdirSync(resultDirectory).length===2);
    const restartedRows=fs.readdirSync(resultDirectory).map(name=>JSON.parse(fs.readFileSync(path.join(resultDirectory,name),'utf8')));
    assert.ok(restartedRows.every(row=>row.sourceRunUid==='GLR-SWITCH-WINNER'));
    processManager.stopAutomation();
  }finally{
    try{processManagerRef?.stopAutomation()}catch{}
    process.chdir(originalCwd);
  }
});
