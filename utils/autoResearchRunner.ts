import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { assertResearchAllowed } from './piRuntimeGuard.ts';
import { forexPairs } from './constants.ts';
import { calculateBacktestPerformance } from './backtestAnalytics.ts';
import { simulateBacktestPortfolio } from './backtestPortfolio.ts';
import { BACKTEST_CANDLE_LIMITS, cancelBacktest, executeBacktestInline, normalizeBacktestConfig } from './backtestRunner.ts';
import { getActiveBacktestRun, getBacktestDashboard, getBacktestRuntime, getBacktestTrainingData, type BacktestRunConfig } from './backtestStore.ts';
import { checkpointCandleArchive, getCandleArchiveStorageUsage, getCandleArchiveSummary } from './candleArchive.ts';
import {
  GOLDILOCKS_RESEARCH_VERSION,
  GOLDILOCKS_TIMEFRAME_SECONDS,
  expandGoldilocksScoreCategoryWeights,
  getGoldilocksTimeframeProfile,
  normalizeGoldilocksBacktestGates,
  normalizeGoldilocksBacktestTweaks,
  type GoldilocksScoreCategoryWeights,
  type GoldilocksTimeframeProfileId,
} from './goldilocksConfig.ts';
import { buildGoldilocksResearchManifest } from './goldilocksResearchManifest.ts';
import { GOLDILOCKS_DEFAULT_MANAGEMENT } from './goldilocksTradeManagement.ts';
import { fetchCandleHistory } from './oanda/api/fetchCandleHistory.ts';
import {
  addAutoResearchEvent, cancelAutoResearchCampaign, claimNextAutoResearchTrial, completeAutoResearchTrial,
  createAutoResearchCampaign, enqueueAutoResearchCycle, failAutoResearchTrial, getAutoResearchCampaignRuntime,getAutoResearchDashboard,
  getBestAutoResearchConfiguration, resetInterruptedAutoResearchTrials, updateAutoResearchCampaign, type AutoResearchCampaignConfig,
} from './autoResearchStore.ts';

export interface StartAutoResearchInput {
  label?:string;
  continuous?:boolean;
  pairs?:string[];
  minimumScores?:number[];
  timeframeProfiles?:GoldilocksTimeframeProfileId[];
  baselineConfig?:BacktestRunConfig;
  explorationSeed?:number;
}

const isProcessAlive=(pid:unknown)=>{
  const processId=Number(pid);
  if(!Number.isInteger(processId)||processId<=0)return false;
  try{process.kill(processId,0);return true}catch{return false}
};

const launchResearchWorker=(campaignId:string)=>{
  const child=spawn(process.execPath,['--import','tsx','workers/autoResearchWorker.ts',campaignId],{
    cwd:process.cwd(),detached:true,stdio:'ignore',windowsHide:true,
  });
  updateAutoResearchCampaign(campaignId,{workerPid:child.pid??null});
  child.unref();
  return child.pid??null;
};

const archiveDatasetKey=(datasetEndTime?:number)=>{
  const summary=getCandleArchiveSummary();
  const digest=createHash('sha256').update(JSON.stringify(summary)).digest('hex').slice(0,12);
  const latest=datasetEndTime??Math.max(0,...summary.map((row:any)=>Number(row.endTime)||0));
  return `${new Date(latest*1000).toISOString().replace(/[:.]/g,'-')}-${digest}`;
};

interface AutoResearchStrategyFamily {
  id:string;
  label:string;
  scoreCategories:GoldilocksScoreCategoryWeights;
  disabledGate?:'pairSession'|'entryProximity';
}

export const AUTO_RESEARCH_STRATEGY_FAMILIES:AutoResearchStrategyFamily[]=[
  {id:'baseline',label:'Baseline',scoreCategories:{trend:3,departure:4,approachWarnings:5,purity:4,zoneInsideZone:4}},
  {id:'freshness',label:'Freshness first',scoreCategories:{trend:2,departure:3,approachWarnings:4,purity:7,zoneInsideZone:4}},
  {id:'structure',label:'Structure first',scoreCategories:{trend:4,departure:5,approachWarnings:5,purity:2,zoneInsideZone:4}},
  {id:'confluence-runway',label:'Confluence and approach',scoreCategories:{trend:2,departure:2,approachWarnings:6,purity:3,zoneInsideZone:7}},
  {id:'balanced-context',label:'Balanced context',scoreCategories:{trend:4,departure:4,approachWarnings:6,purity:3,zoneInsideZone:3}},
  {id:'session-ablation',label:'Research: session gate off',scoreCategories:{trend:3,departure:4,approachWarnings:5,purity:4,zoneInsideZone:4},disabledGate:'pairSession'},
  {id:'proximity-ablation',label:'Research: proximity gate off',scoreCategories:{trend:3,departure:4,approachWarnings:5,purity:4,zoneInsideZone:4},disabledGate:'entryProximity'},
];

export const buildAutoResearchConfigurations=(input:StartAutoResearchInput={}):BacktestRunConfig[]=>{
  const pairs=[...new Set((input.pairs??forexPairs).filter(pair=>forexPairs.includes(pair)))];
  if(!pairs.length)throw new Error('Auto research requires at least one supported pair.');
  const fallbackFamily=AUTO_RESEARCH_STRATEGY_FAMILIES[0];
  const fallback=normalizeBacktestConfig({pairs,timeframeProfile:input.timeframeProfiles?.[0]??'lowerTimeframe',minimumScore:input.minimumScores?.[0]??11,
    lookbackDays:365,backfillPages:0,label:'Leader control',riskProfile:'default',startingBalance:1000,leverage:30,
    tradeManager:'set-and-forget-2r-v1',setAndForgetTargetMode:'opposing-base',setAndForgetTargetR:2,
    scoreWeights:expandGoldilocksScoreCategoryWeights(fallbackFamily.scoreCategories),gateSettings:normalizeGoldilocksBacktestGates(undefined)});
  const leader=normalizeBacktestConfig({...fallback,...input.baselineConfig,pairs,lookbackDays:365,backfillPages:0});
  const score=Math.min(20,Math.max(0,leader.minimumScore));
  const touches=Math.min(3,Math.max(0,Number(leader.strategyTweaks?.maximumPriorTouches??3)));
  const seed=Math.abs(Math.floor(input.explorationSeed??Date.now()));
  const exploratoryManagers=['secure-half-atr-runner-v3','legacy-score-tiered-2r-4r-v1','bank-half-untouched-stop-runner-v1','adaptive-attack-scale-out-runner-v1'] as const;
  const wildcardKind=seed%6;
  const wildcard:BacktestRunConfig={...leader,label:'Wildcard test'};
  if(wildcardKind===0){
    wildcard.tradeManager=exploratoryManagers[Math.floor(seed/6)%exploratoryManagers.length];
    wildcard.setAndForgetTargetMode=undefined;wildcard.setAndForgetTargetR=undefined;wildcard.label='Wildcard · manager';
  }else if(wildcardKind===1){
    wildcard.confirmationMode=leader.confirmationMode==='touch-entry'?'close-through':'touch-entry';wildcard.label='Wildcard · confirmation';
  }else if(wildcardKind===2){
    const distances=[0.3,0.7,1];wildcard.strategyTweaks={...normalizeGoldilocksBacktestTweaks(leader.strategyTweaks),maxEntryDistanceZoneFraction:distances[Math.floor(seed/6)%distances.length]};wildcard.label='Wildcard · entry distance';
  }else if(wildcardKind===3){
    const family=AUTO_RESEARCH_STRATEGY_FAMILIES[1+Math.floor(seed/6)%4];wildcard.scoreWeights=expandGoldilocksScoreCategoryWeights(family.scoreCategories);wildcard.label=`Wildcard · ${family.label}`;
  }else if(wildcardKind===4){
    const targets=[1.5,2.5,4,5];wildcard.tradeManager='set-and-forget-2r-v1';wildcard.setAndForgetTargetMode='fixed-r';wildcard.setAndForgetTargetR=targets[Math.floor(seed/6)%targets.length];wildcard.label=`Wildcard · ${wildcard.setAndForgetTargetR}R target`;
  }else{
    wildcard.strategyTweaks={...normalizeGoldilocksBacktestTweaks(leader.strategyTweaks),maximumPriorTouches:Math.floor(seed/6)%4};wildcard.label='Wildcard · touch limit';
  }
  const variants:BacktestRunConfig[]=[
    {...leader,label:'Leader control'},
    {...leader,minimumScore:Math.min(20,score+1),label:'Leader +1 score'},
    {...leader,strategyTweaks:{...normalizeGoldilocksBacktestTweaks(leader.strategyTweaks),maximumPriorTouches:Math.max(0,touches-1)},label:'Leader tighter touches'},
    {...leader,tradeManager:'set-and-forget-2r-v1',setAndForgetTargetMode:'fixed-r',setAndForgetTargetR:3,label:'Leader fixed 3R target'},
    wildcard,
  ];
  return variants.map(config=>normalizeBacktestConfig({...config,pairs,lookbackDays:365,backfillPages:0}));
};

const summarizeRun=(runId:string)=>{
  const dashboard=getBacktestDashboard(runId) as any;
  const run=dashboard.runs?.find((candidate:any)=>candidate.id===runId);
  const portfolio=simulateBacktestPortfolio(
    (dashboard.trades??[]).map((trade:any)=>({
      id:String(trade.id),tradeId:String(trade.tradeId),pair:String(trade.pair),
      confirmationTime:Number(trade.confirmationTime),outcomeTime:Number(trade.outcomeTime),
      score:Number(trade.score),entry:Number(trade.entry),stopLoss:Number(trade.stopLoss),
      outcome:trade.outcome,realizedR:trade.realizedR==null?null:Number(trade.realizedR),
    })),
    {
      startingBalance:Number(run?.config?.startingBalance??1000),
      leverage:Number(run?.config?.leverage??30),
      riskProfile:run?.config?.riskProfile??'default',
      minimumScore:Number(run?.config?.minimumScore??14),
    },
  );
  const officialTrades=portfolio.trades.map(({trade,realizedR})=>({
    tradeId:trade.tradeId,pair:trade.pair,realizedR,
    confirmationTime:trade.confirmationTime,
  }));
  const official=calculateBacktestPerformance(officialTrades);
  const byPair=Object.entries(officialTrades.reduce((map:Record<string,any[]>,trade:any)=>{
    (map[trade.pair]??=[]).push({realizedR:trade.realizedR,confirmationTime:trade.confirmationTime});
    return map;
  },{})).map(([pair,trades])=>({pair,...calculateBacktestPerformance(trades as any[])}));
  const acceptedTradeIds=new Set(officialTrades.map(trade=>trade.tradeId));
  const policies=Object.values(getBacktestTrainingData(runId).filter((row:any)=>
    acceptedTradeIds.has(String(row.tradeId)),
  ).reduce((map:Record<string,{policyId:string;trades:Array<{realizedR:number|null;confirmationTime:number}>}>,row:any)=>{
    const bucket=map[row.policyId]??={policyId:String(row.policyId),trades:[]};
    bucket.trades.push({realizedR:row.policyRealizedR==null?null:Number(row.policyRealizedR),confirmationTime:Number(row.confirmationTime)});
    map[row.policyId]=bucket;
    return map;
  },{})).map(bucket=>({policyId:bucket.policyId,...calculateBacktestPerformance(bucket.trades)}))
    .sort((left,right)=>Number(right.expectancyR??Number.NEGATIVE_INFINITY)-Number(left.expectancyR??Number.NEGATIVE_INFINITY));
  return {official,byPair,policies,archive:getCandleArchiveStorageUsage()};
};

const delay=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const SEALED_SNAPSHOT_INTERVAL_SECONDS=5*60;

export const getAutoResearchDatasetEndTime=(now=Date.now())=>
  Math.floor((Math.floor(now/1000)-SEALED_SNAPSHOT_INTERVAL_SECONDS)/SEALED_SNAPSHOT_INTERVAL_SECONDS)*SEALED_SNAPSHOT_INTERVAL_SECONDS;

interface DatasetTask {pair:string;timeframe:string;lookbackDays:number;maxCandles:number;backfillPages:number}

const buildDatasetTasks=(configurations:BacktestRunConfig[]):DatasetTask[]=>{
  const tasks=new Map<string,DatasetTask>();
  for(const config of configurations){
    const profile=getGoldilocksTimeframeProfile(config.timeframeProfile);
    for(const pair of config.pairs){
      for(const timeframe of new Set([profile.trend,profile.zone,profile.confirmation,profile.execution])){
        const key=`${pair}|${timeframe}`;
        const lookbackDays=Math.max(config.lookbackDays,tasks.get(key)?.lookbackDays??0);
        const maxCandles=BACKTEST_CANDLE_LIMITS[timeframe];
        const seconds=GOLDILOCKS_TIMEFRAME_SECONDS[timeframe];
        const backfillPages=Math.min(maxCandles,Math.ceil(lookbackDays*86400/seconds))/1000;
        tasks.set(key,{pair,timeframe,lookbackDays,maxCandles,backfillPages:Math.ceil(backfillPages)+2});
      }
    }
  }
  const order:Record<string,number>={D:0,H4:1,H1:2,M15:3,M5:4,M1:5};
  return [...tasks.values()].sort((left,right)=>(order[left.timeframe]??99)-(order[right.timeframe]??99)||left.pair.localeCompare(right.pair));
};

const retry=async<T>(operation:()=>Promise<T>,onRetry:(attempt:number,error:Error)=>void,attempts=6):Promise<T>=>{
  let lastError=new Error('Research dataset acquisition failed.');
  for(let attempt=1;attempt<=attempts;attempt+=1){
    try{return await operation()}catch(error){
      lastError=error instanceof Error?error:new Error(String(error));
      if(attempt>=attempts)break;
      onRetry(attempt,lastError);
      await delay(Math.min(30_000,2_000*2**(attempt-1)));
    }
  }
  throw lastError;
};

const acquireSealedDataset=async(campaignId:string,configurations:BacktestRunConfig[],datasetEndTime:number)=>{
  const tasks=buildDatasetTasks(configurations);
  updateAutoResearchCampaign(campaignId,{status:'preparing',preparationStage:'Starting sealed candle acquisition',preparationDone:0,preparationTotal:tasks.length});
  addAutoResearchEvent(campaignId,'dataset_preparing',`DATASET PREPARING · ${tasks.length} pair/timeframe archives will be acquired once from OANDA, then every trial will be SQLite-only.`,undefined,{datasetEndTime,tasks:tasks.length});
  for(let index=0;index<tasks.length;index+=1){
    const task=tasks[index];
    const state=getAutoResearchCampaignRuntime(campaignId);
    if(!state||state.status==='cancelled')throw new Error('Research cancelled during dataset acquisition.');
    const stage=`Acquiring ${task.pair} ${task.timeframe} (${index+1}/${tasks.length})`;
    updateAutoResearchCampaign(campaignId,{status:'preparing',preparationStage:stage,preparationDone:index,preparationTotal:tasks.length});
    addAutoResearchEvent(campaignId,'dataset_task_started',`DATASET · ${stage}.`,undefined,task);
    const candles=await retry(
      ()=>fetchCandleHistory(task.pair,task.timeframe,{lookbackDays:task.lookbackDays,mode:'demo',maxCandles:task.maxCandles,backfillPages:task.backfillPages,endTime:datasetEndTime,acquireFullRange:true}),
      (attempt,error)=>addAutoResearchEvent(campaignId,'dataset_fetch_retry',`DATASET RETRY · ${task.pair} ${task.timeframe} · attempt ${attempt+1}/6 after ${error.message}.`,undefined,{...task,attempt,error:error.message}),
    );
    updateAutoResearchCampaign(campaignId,{preparationStage:stage,preparationDone:index+1,preparationTotal:tasks.length});
    addAutoResearchEvent(campaignId,'dataset_task_complete',`DATASET READY · ${task.pair} ${task.timeframe} · ${candles.length.toLocaleString()} candles stored locally.`,undefined,{...task,candles:candles.length});
  }
  checkpointCandleArchive();
  const datasetKey=archiveDatasetKey(datasetEndTime);
  updateAutoResearchCampaign(campaignId,{datasetKey,preparationStage:'Sealed SQLite dataset ready',preparationDone:tasks.length,preparationTotal:tasks.length});
  addAutoResearchEvent(campaignId,'dataset_sealed',`DATASET SEALED · ${datasetKey} · OANDA access is disabled for all queued trials.`,undefined,{datasetKey,datasetEndTime,archive:getCandleArchiveStorageUsage()});
  return datasetKey;
};
  assertResearchAllowed();

export const executeAutoResearchCampaign=async(campaignId:string)=>{
  const runtime=getAutoResearchCampaignRuntime(campaignId);
  if(!runtime)throw new Error(`Auto research campaign ${campaignId} was not found.`);
  const campaignConfig=JSON.parse(runtime.configJson) as AutoResearchCampaignConfig;
  resetInterruptedAutoResearchTrials(campaignId);
  updateAutoResearchCampaign(campaignId,{status:'running',startedAt:new Date().toISOString(),workerPid:process.pid,error:null});
  addAutoResearchEvent(campaignId,'campaign_started',`AUTO RESEARCH STARTED · ${campaignConfig.configurations.length} configuration(s) · live trading remains unchanged.`);
  try{
    const prepareCycle=async(datasetEndTime:number)=>{
      const datasetKey=await acquireSealedDataset(campaignId,campaignConfig.configurations,datasetEndTime);
      const configurations=campaignConfig.configurations.map(config=>({
        ...config,archiveOnly:true,backfillPages:0,datasetEndTime,datasetKey,
        researchManifest:buildGoldilocksResearchManifest(config.timeframeProfile??'intraday',config.minimumScore),
      }));
      const queued=enqueueAutoResearchCycle(campaignId,datasetKey,configurations);
      updateAutoResearchCampaign(campaignId,{status:'running',currentTrialId:null});
      addAutoResearchEvent(campaignId,'trials_queued',`TRIALS QUEUED · ${queued} configurations will use sealed SQLite dataset ${datasetKey}; no trial can call OANDA.`,undefined,{datasetKey,queued,datasetEndTime});
      return {datasetKey,queued};
    };
    const existingTrials=getAutoResearchDashboard(campaignId).trials;
    if(!existingTrials.length){
      await prepareCycle(campaignConfig.datasetEndTime??getAutoResearchDatasetEndTime());
    }
    while(true){
      const state=getAutoResearchCampaignRuntime(campaignId);
      if(!state||state.status==='cancelled'||state.status==='completed'||state.status==='failed')break;
      if(state.status==='paused'){await delay(2_000);continue}
      if(getActiveBacktestRun()){
        updateAutoResearchCampaign(campaignId,{status:'waiting',currentTrialId:null});
        await delay(10_000);
        continue;
      }
      const trial=claimNextAutoResearchTrial(campaignId);
      if(!trial){
        if(!campaignConfig.continuous){
          updateAutoResearchCampaign(campaignId,{status:'completed',completedAt:new Date().toISOString(),workerPid:null,currentTrialId:null});
          addAutoResearchEvent(campaignId,'campaign_complete','AUTO RESEARCH COMPLETE · every configuration was evaluated on the same sealed local dataset.');
          break;
        }
        const previousEndTime=Math.max(0,...getAutoResearchDashboard(campaignId).trials.map(item=>Number((item.config as BacktestRunConfig).datasetEndTime)||0));
        let nextEndTime=getAutoResearchDatasetEndTime();
        if(nextEndTime<=previousEndTime){
          updateAutoResearchCampaign(campaignId,{status:'waiting',currentTrialId:null,preparationStage:'Waiting for the next sealed snapshot boundary'});
          await delay(30_000);
          continue;
        }
        addAutoResearchEvent(campaignId,'continuous_cycle_started',`CONTINUOUS RESEARCH · comparison queue exhausted; sealing the next historical snapshot ending ${new Date(nextEndTime*1000).toISOString()}.`,undefined,{previousEndTime,datasetEndTime:nextEndTime});
        campaignConfig.configurations=buildAutoResearchConfigurations({baselineConfig:getBestAutoResearchConfiguration(),explorationSeed:nextEndTime});
        const cycle=await prepareCycle(nextEndTime);
        if(!cycle.queued){
          updateAutoResearchCampaign(campaignId,{status:'waiting',currentTrialId:null,preparationStage:'Waiting for a distinct sealed snapshot'});
          await delay(30_000);
        }
        continue;
      }
      addAutoResearchEvent(campaignId,'trial_started',`TRIAL STARTED · ${trial.config.label}.`,trial.id,{datasetKey:trial.datasetKey,config:trial.config});
      let backtestRunId:string|undefined;
      try{
        const result=await executeBacktestInline(trial.config);
        backtestRunId=result.id;
        if(result.status!=='completed')throw new Error(`Backtest ${result.id} ended with status ${result.status}.`);
        const metrics=summarizeRun(result.id);
        completeAutoResearchTrial(trial.id,result.id,metrics);
        addAutoResearchEvent(campaignId,'trial_complete',`TRIAL COMPLETE · ${trial.config.label} · ${metrics.official.sampleTrades} trades · expectancy ${metrics.official.expectancyR?.toFixed(3)??'n/a'}R · drawdown ${metrics.official.maxDrawdownR.toFixed(2)}R.`,trial.id,metrics);
      }catch(error){
        const message=error instanceof Error?error.message:String(error);
        failAutoResearchTrial(trial.id,message,backtestRunId);
        addAutoResearchEvent(campaignId,'trial_failed',`TRIAL FAILED · ${trial.config.label} · ${message}`,trial.id,{backtestRunId});
      }
      const afterTrial=getAutoResearchCampaignRuntime(campaignId);
      if(!afterTrial||afterTrial.status==='cancelled')break;
      updateAutoResearchCampaign(campaignId,{status:'running',currentTrialId:null});
    }
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(getAutoResearchCampaignRuntime(campaignId)?.status==='cancelled')return;
    updateAutoResearchCampaign(campaignId,{status:'failed',completedAt:new Date().toISOString(),workerPid:null,currentTrialId:null,error:message});
    addAutoResearchEvent(campaignId,'campaign_failed',`AUTO RESEARCH FAILED · ${message}`);
  }
};
  assertResearchAllowed();

export const startAutoResearch=(input:StartAutoResearchInput={})=>{
  const configurations=buildAutoResearchConfigurations({...input,baselineConfig:input.baselineConfig??getBestAutoResearchConfiguration()});
  const config:AutoResearchCampaignConfig={
    label:String(input.label??`${GOLDILOCKS_RESEARCH_VERSION} | overnight discovery`).slice(0,120),
    continuous:input.continuous??true,
    configurations,
    datasetEndTime:getAutoResearchDatasetEndTime(),
  };
  const campaign=createAutoResearchCampaign(config,`preparing-${config.datasetEndTime}`,false);
  launchResearchWorker(campaign.id);
  return {...campaign,config};
};

export const recoverOrStartAutoResearch=(input:StartAutoResearchInput={})=>{
  const active=getAutoResearchDashboard().campaigns.find(item=>['queued','preparing','running','waiting','paused'].includes(String(item.status)));
  if(!active)return startAutoResearch(input);
  if(active.status==='paused')return {id:active.id,status:'paused' as const,recovered:false};
  if(isProcessAlive(active.workerPid))return {id:active.id,status:active.status,recovered:false,workerPid:active.workerPid};
  const reset=resetInterruptedAutoResearchTrials(String(active.id));
  updateAutoResearchCampaign(String(active.id),{status:'queued',workerPid:null,currentTrialId:null,error:null});
  addAutoResearchEvent(String(active.id),'campaign_recovered',`AUTO RESEARCH RECOVERED · stale worker cleared · ${reset} interrupted trial(s) returned to the queue.`);
  const workerPid=launchResearchWorker(String(active.id));
  return {id:active.id,status:'queued' as const,recovered:true,workerPid};
};

export const pauseAutoResearch=(id:string)=>{
  const runtime=getAutoResearchCampaignRuntime(id);
  if(!runtime)throw new Error('Auto research campaign not found.');
  if(!['preparing','running','waiting','queued'].includes(runtime.status))throw new Error(`Campaign is already ${runtime.status}.`);
  updateAutoResearchCampaign(id,{status:'paused'});
  addAutoResearchEvent(id,'campaign_paused','AUTO RESEARCH PAUSED · the current deterministic backtest may finish before the pause takes effect.');
  return {id,status:'paused' as const};
};

export const resumeAutoResearch=(id:string)=>{
  const runtime=getAutoResearchCampaignRuntime(id);
  if(!runtime)throw new Error('Auto research campaign not found.');
  if(runtime.status!=='paused')throw new Error(`Campaign is ${runtime.status}, not paused.`);
  updateAutoResearchCampaign(id,{status:'running'});
  if(!isProcessAlive(runtime.workerPid))launchResearchWorker(id);
  addAutoResearchEvent(id,'campaign_resumed','AUTO RESEARCH RESUMED.');
  return {id,status:'running' as const};
};

export const stopAutoResearch=(id:string)=>{
  const dashboard=getAutoResearchDashboard(id);
  const campaign=dashboard.campaigns.find(item=>item.id===id);
  const trial=dashboard.trials.find((item:any)=>item.id===campaign?.currentTrialId) as any;
  const active=getActiveBacktestRun();
  const activeRuntime=active?getBacktestRuntime(active.id):undefined;
  const result=cancelAutoResearchCampaign(id);
  if(active&&(trial?.backtestRunId===active.id||activeRuntime?.workerPid===result.workerPid)){
    try{cancelBacktest(active.id)}catch{/* Campaign cancellation remains authoritative. */}
  }else if(result.workerPid&&result.workerPid!==process.pid){
    try{process.kill(result.workerPid,'SIGTERM')}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error}
  }
  return result;
};
