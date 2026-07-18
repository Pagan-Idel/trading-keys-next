import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { forexPairs } from './constants.ts';
import { calculateBacktestPerformance } from './backtestAnalytics.ts';
import { BACKTEST_CANDLE_LIMITS, cancelBacktest, executeBacktestInline, normalizeBacktestConfig } from './backtestRunner.ts';
import { getActiveBacktestRun, getBacktestDashboard, getBacktestRuntime, getBacktestTrainingData, type BacktestRunConfig } from './backtestStore.ts';
import { checkpointCandleArchive, getCandleArchiveStorageUsage, getCandleArchiveSummary } from './candleArchive.ts';
import { GOLDILOCKS_RESEARCH_VERSION, GOLDILOCKS_TIMEFRAME_SECONDS, getGoldilocksTimeframeProfile, type GoldilocksTimeframeProfileId } from './goldilocksConfig.ts';
import { buildGoldilocksResearchManifest } from './goldilocksResearchManifest.ts';
import { fetchCandleHistory } from './oanda/api/fetchCandleHistory.ts';
import {
  addAutoResearchEvent, cancelAutoResearchCampaign, claimNextAutoResearchTrial, completeAutoResearchTrial,
  createAutoResearchCampaign, enqueueAutoResearchCycle, failAutoResearchTrial, getAutoResearchCampaignRuntime,getAutoResearchDashboard,
  resetInterruptedAutoResearchTrials, updateAutoResearchCampaign, type AutoResearchCampaignConfig,
} from './autoResearchStore.ts';

export interface StartAutoResearchInput {
  label?:string;
  continuous?:boolean;
  pairs?:string[];
  minimumScores?:number[];
  timeframeProfiles?:GoldilocksTimeframeProfileId[];
}

const archiveDatasetKey=(datasetEndTime?:number)=>{
  const summary=getCandleArchiveSummary();
  const digest=createHash('sha256').update(JSON.stringify(summary)).digest('hex').slice(0,12);
  const latest=datasetEndTime??Math.max(0,...summary.map((row:any)=>Number(row.endTime)||0));
  return `${new Date(latest*1000).toISOString().replace(/[:.]/g,'-')}-${digest}`;
};

export const buildAutoResearchConfigurations=(input:StartAutoResearchInput={}):BacktestRunConfig[]=>{
  const pairs=[...new Set((input.pairs??forexPairs).filter(pair=>forexPairs.includes(pair)))];
  if(!pairs.length)throw new Error('Auto research requires at least one supported pair.');
  const profiles:GoldilocksTimeframeProfileId[]=[...new Set(input.timeframeProfiles??(['intraday','higherTimeframe'] as GoldilocksTimeframeProfileId[]))];
  const scores=[...new Set((input.minimumScores??[10,11,12,13,14,15,16,17,18]).map(value=>Math.min(20,Math.max(0,Math.floor(value)))))].sort((a,b)=>a-b);
  return profiles.flatMap(timeframeProfile=>{
    const profile=getGoldilocksTimeframeProfile(timeframeProfile);
    return scores.map(minimumScore=>normalizeBacktestConfig({
      pairs,timeframeProfile,minimumScore,lookbackDays:profile.defaultLookbackDays,
      backfillPages:0,
      label:`${profile.label} | strategy ${profile.strategyVersion} | score ${minimumScore}`,
      riskProfile:'default',startingBalance:1000,leverage:30,
    }));
  });
};

const summarizeRun=(runId:string)=>{
  const dashboard=getBacktestDashboard(runId) as any;
  const officialTrades=(dashboard.trades??[]).map((trade:any)=>({realizedR:trade.realizedR,confirmationTime:trade.confirmationTime}));
  const official=calculateBacktestPerformance(officialTrades);
  const byPair=Object.entries((dashboard.trades??[]).reduce((map:Record<string,any[]>,trade:any)=>{
    (map[trade.pair]??=[]).push({realizedR:trade.realizedR,confirmationTime:trade.confirmationTime});
    return map;
  },{})).map(([pair,trades])=>({pair,...calculateBacktestPerformance(trades as any[])}));
  const policies=Object.values(getBacktestTrainingData(runId).reduce((map:Record<string,{policyId:string;trades:Array<{realizedR:number|null;confirmationTime:number}>}>,row:any)=>{
    const bucket=map[row.policyId]??={policyId:String(row.policyId),trades:[]};
    bucket.trades.push({realizedR:row.policyRealizedR==null?null:Number(row.policyRealizedR),confirmationTime:Number(row.confirmationTime)});
    map[row.policyId]=bucket;
    return map;
  },{})).map(bucket=>({policyId:bucket.policyId,...calculateBacktestPerformance(bucket.trades)}))
    .sort((left,right)=>Number(right.expectancyR??Number.NEGATIVE_INFINITY)-Number(left.expectancyR??Number.NEGATIVE_INFINITY));
  return {official,byPair,policies,archive:getCandleArchiveStorageUsage()};
};

const delay=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));

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

export const executeAutoResearchCampaign=async(campaignId:string)=>{
  const runtime=getAutoResearchCampaignRuntime(campaignId);
  if(!runtime)throw new Error(`Auto research campaign ${campaignId} was not found.`);
  const campaignConfig=JSON.parse(runtime.configJson) as AutoResearchCampaignConfig;
  resetInterruptedAutoResearchTrials(campaignId);
  updateAutoResearchCampaign(campaignId,{status:'running',startedAt:new Date().toISOString(),workerPid:process.pid,error:null});
  addAutoResearchEvent(campaignId,'campaign_started',`AUTO RESEARCH STARTED · ${campaignConfig.configurations.length} configuration(s) · live trading remains unchanged.`);
  try{
    const existingTrials=getAutoResearchDashboard(campaignId).trials;
    if(!existingTrials.length){
      const datasetEndTime=campaignConfig.datasetEndTime??Math.floor(Date.now()/1000)-300;
      const datasetKey=await acquireSealedDataset(campaignId,campaignConfig.configurations,datasetEndTime);
      campaignConfig.configurations=campaignConfig.configurations.map(config=>({
        ...config,archiveOnly:true,backfillPages:0,datasetEndTime,datasetKey,
        researchManifest:buildGoldilocksResearchManifest(config.timeframeProfile??'intraday',config.minimumScore),
      }));
      const queued=enqueueAutoResearchCycle(campaignId,datasetKey,campaignConfig.configurations);
      updateAutoResearchCampaign(campaignId,{status:'running',currentTrialId:null});
      addAutoResearchEvent(campaignId,'trials_queued',`TRIALS QUEUED · ${queued} configurations will use sealed SQLite dataset ${datasetKey}; no trial can call OANDA.`,undefined,{datasetKey,queued});
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
        updateAutoResearchCampaign(campaignId,{status:'completed',completedAt:new Date().toISOString(),workerPid:null,currentTrialId:null});
        addAutoResearchEvent(campaignId,'campaign_complete','AUTO RESEARCH COMPLETE · every configuration was evaluated on the same sealed local dataset.');
        break;
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

export const startAutoResearch=(input:StartAutoResearchInput={})=>{
  const configurations=buildAutoResearchConfigurations(input);
  const config:AutoResearchCampaignConfig={
    label:String(input.label??`${GOLDILOCKS_RESEARCH_VERSION} | overnight discovery`).slice(0,120),
    continuous:false,
    configurations,
    datasetEndTime:Math.floor(Date.now()/1000)-300,
  };
  const campaign=createAutoResearchCampaign(config,`preparing-${config.datasetEndTime}`,false);
  const child=spawn(process.execPath,['--import','tsx','workers/autoResearchWorker.ts',campaign.id],{
    cwd:process.cwd(),detached:true,stdio:'ignore',windowsHide:true,
  });
  updateAutoResearchCampaign(campaign.id,{workerPid:child.pid??null});
  child.unref();
  return {...campaign,config};
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
