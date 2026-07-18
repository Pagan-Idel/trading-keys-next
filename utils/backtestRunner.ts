import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { forexPairs } from './constants.ts';
import { fetchCandleHistory } from './oanda/api/fetchCandleHistory.ts';
import { simulateGoldilocksPair } from './goldilocksBacktest.ts';
import { addBacktestEvent, createBacktestRun, getActiveBacktestRun, getBacktestRuntime, replaceBacktestTrades, updateBacktestRun, type BacktestRunConfig, type BacktestTradeInput } from './backtestStore.ts';
import { isRiskProfile } from './dynamicRisk.ts';
import { ensureHistoricalNewsCoverage, getHistoricalNewsGate, getHistoricalNewsGateForRange } from './historicalNewsStore.ts';
import { GOLDILOCKS_DEFAULT_BACKTEST_LABEL, getGoldilocksTimeframeProfile, isGoldilocksTimeframeProfileId } from './goldilocksConfig.ts';

export const BACKTEST_CANDLE_LIMITS:Record<string,number>={M1:800_000,M5:800_000,M15:250_000,H1:80_000,H4:25_000,D:5_000};

export const executeBacktestRun=async(id:string,config:BacktestRunConfig)=>{
  const all:BacktestTradeInput[]=[];
  try{
    const profile=getGoldilocksTimeframeProfile(config.timeframeProfile);
    updateBacktestRun(id,{status:'running',startedAt:new Date().toISOString(),progressDone:0,progressStage:'starting',progressPercent:0,heartbeatAt:new Date().toISOString(),workerPid:process.pid});
    addBacktestEvent(id,'run_started',`BACKTEST STARTED · ${config.label} · ${config.pairs.length} pair(s) · ${config.lookbackDays} days · minimum ${config.minimumScore}/20.`);
    const backfillPages=Math.max(0,Math.floor(config.backfillPages??(config.pairs.length===1?50:10)));
    for(let index=0;index<config.pairs.length;index+=1){
      const pair=config.pairs[index];
      updateBacktestRun(id,{progressPair:pair,progressDone:index,progressStage:'loading history',progressPercent:index/config.pairs.length*100,heartbeatAt:new Date().toISOString()});
      addBacktestEvent(id,'pair_loading',`LOADING HISTORY · collecting H1/M15/M5 signals and M1 execution candles for ${pair}.`,pair);
      const [trendCandles,zoneCandles,confirmationCandles,outcomeCandles]=await Promise.all([
        fetchCandleHistory(pair,profile.trend,{lookbackDays:config.lookbackDays,mode:'demo',backfillPages,maxCandles:BACKTEST_CANDLE_LIMITS[profile.trend],archiveOnly:config.archiveOnly,endTime:config.datasetEndTime}),
        fetchCandleHistory(pair,profile.zone,{lookbackDays:config.lookbackDays,mode:'demo',backfillPages,maxCandles:BACKTEST_CANDLE_LIMITS[profile.zone],archiveOnly:config.archiveOnly,endTime:config.datasetEndTime}),
        fetchCandleHistory(pair,profile.confirmation,{lookbackDays:config.lookbackDays,mode:'demo',backfillPages,maxCandles:BACKTEST_CANDLE_LIMITS[profile.confirmation],archiveOnly:config.archiveOnly,endTime:config.datasetEndTime}),
        fetchCandleHistory(pair,profile.execution,{lookbackDays:config.lookbackDays,mode:'demo',backfillPages,maxCandles:BACKTEST_CANDLE_LIMITS[profile.execution],archiveOnly:config.archiveOnly,endTime:config.datasetEndTime}),
      ]);
      if(confirmationCandles.length){
        addBacktestEvent(id,'news_loading',`LOADING NEWS · verifying stored high-impact calendar coverage for ${pair}.`,pair);
        const firstTime=Math.floor(new Date(confirmationCandles[0].time).getTime()/1000);
        const lastTime=Math.floor(new Date(confirmationCandles[confirmationCandles.length-1].time).getTime()/1000);
        const coverage=await ensureHistoricalNewsCoverage(firstTime,lastTime,(completed,total,weekStart)=>{
          const newsPercent=total?Math.round(completed/total*100):100;
          updateBacktestRun(id,{progressStage:`historical news ${newsPercent}%`,heartbeatAt:new Date().toISOString()});
          if(completed===total||completed%10===0)addBacktestEvent(id,'news_progress',`NEWS HISTORY · ${completed}/${total} missing calendar weeks fetched · latest ${weekStart}.`,pair);
        });
        addBacktestEvent(id,'news_ready',`NEWS READY · historical high-impact windows are stored and available for ${pair}.`,pair,coverage);
      }
      addBacktestEvent(id,'pair_scanning',`SCANNING ${pair} · H1 ${trendCandles.length.toLocaleString()} · M15 ${zoneCandles.length.toLocaleString()} · M5 ${confirmationCandles.length.toLocaleString()} signals · M1 ${outcomeCandles.length.toLocaleString()} execution candles.`,pair);
      let lastProgressWrite=0;
      let lastProgressBucket=-1;
      let newsRejected=0;
      let proximityRejected=0;
      let marketHoursRejected=0;
      let holidayRejected=0;
      let sessionRejected=0;
      let departureQualityRejected=0;
      let executionCoverageRejected=0;
      const trades=simulateGoldilocksPair({
        runId:id,pair,minimumScore:config.minimumScore,timeframes:profile,trendCandles,zoneCandles,confirmationCandles,outcomeCandles,
        historicalNewsGate:(pair,time,startTime)=>startTime===undefined?getHistoricalNewsGate(pair,time):getHistoricalNewsGateForRange(pair,startTime,time),
        onNewsRejected:()=>{newsRejected+=1},
        onProximityRejected:()=>{proximityRejected+=1},
        onMarketHoursRejected:()=>{marketHoursRejected+=1},
        onHolidayRejected:()=>{holidayRejected+=1},
        onSessionRejected:()=>{sessionRejected+=1},
        onDepartureQualityRejected:()=>{departureQualityRejected+=1},
        onExecutionCoverageRejected:()=>{executionCoverageRejected+=1},
        onProgress:progress=>{
          const now=Date.now();
          const bucket=Math.floor(progress.percent/10);
          if(now-lastProgressWrite<500&&progress.percent<100&&bucket===lastProgressBucket)return;
          const overall=((index+progress.percent/100)/config.pairs.length)*100;
          updateBacktestRun(id,{progressStage:progress.stage,progressPercent:Number(overall.toFixed(1)),heartbeatAt:new Date(now).toISOString()});
          if(bucket!==lastProgressBucket){
            addBacktestEvent(id,'pair_progress',`${pair} · ${progress.stage} · ${progress.percent}%`,pair,{...progress,overallPercent:overall});
            lastProgressBucket=bucket;
          }
          lastProgressWrite=now;
        },
      });
      if(newsRejected)addBacktestEvent(id,'news_rejected',`NEWS BLOCKER · rejected ${newsRejected} confirmed ${pair} setup(s) inside high-impact ±1 hour windows.`,pair,{rejectedSetups:newsRejected});
      if(proximityRejected)addBacktestEvent(id,'entry_proximity_rejected',`ENTRY PROXIMITY · rejected ${proximityRejected} ${pair} setup(s) whose first M5 touch, close-through, or entry exceeded the 50% M15-zone-width limit.`,pair,{rejectedSetups:proximityRejected,maxZoneWidthFraction:0.5});
      if(marketHoursRejected)addBacktestEvent(id,'weekly_market_hours_rejected',`WEEKLY MARKET HOURS · rejected ${marketHoursRejected} ${pair} setup(s) between Friday 16:00 and Sunday 18:00 America/New_York.`,pair,{rejectedSetups:marketHoursRejected,timeZone:'America/New_York'});
      if(holidayRejected)addBacktestEvent(id,'historical_holiday_rejected',`HISTORICAL HOLIDAY - rejected ${holidayRejected} ${pair} setup(s) on configured U.S. no-trade holidays evaluated in America/New_York.`,pair,{rejectedSetups:holidayRejected,timeZone:'America/New_York'});
      if(sessionRejected)addBacktestEvent(id,'historical_session_rejected',`HISTORICAL SESSION - rejected ${sessionRejected} ${pair} setup(s) because neither currency was inside its DST-aware local session.`,pair,{rejectedSetups:sessionRejected});
      if(departureQualityRejected)addBacktestEvent(id,'departure_quality_rejected',`DEPARTURE QUALITY - rejected ${departureQualityRejected} ${pair} setup(s) formed by an M15 shock/rejection candle.`,pair,{rejectedSetups:departureQualityRejected});
      if(executionCoverageRejected)addBacktestEvent(id,'execution_coverage_rejected',`EXECUTION COVERAGE - rejected ${executionCoverageRejected} ${pair} setup(s) because M1 data did not begin at entry time.`,pair,{rejectedSetups:executionCoverageRejected,timeframe:'M1',maximumEntryDelaySeconds:60});
      all.push(...trades);
      replaceBacktestTrades(id,all);
      const wins=all.filter(trade=>trade.outcome==='WIN').length;
      updateBacktestRun(id,{progressDone:index+1,progressStage:'pair complete',progressPercent:(index+1)/config.pairs.length*100,heartbeatAt:new Date().toISOString(),totalTrades:all.length,wins,losses:all.length-wins});
      addBacktestEvent(id,'pair_complete',`PAIR COMPLETE · ${pair} · ${trades.length} trades · ${trades.filter(trade=>trade.outcome==='WIN').length} protected wins.`,pair,{trades:trades.length});
    }
    const wins=all.filter(trade=>trade.outcome==='WIN').length;
    updateBacktestRun(id,{status:'completed',completedAt:new Date().toISOString(),progressPair:null,progressDone:config.pairs.length,progressStage:'complete',progressPercent:100,heartbeatAt:new Date().toISOString(),workerPid:null,totalTrades:all.length,wins,losses:all.length-wins});
    addBacktestEvent(id,'run_complete',`BACKTEST COMPLETE · ${all.length} trades · ${wins} wins · ${(all.length?wins/all.length*100:0).toFixed(1)}% win rate.`);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    updateBacktestRun(id,{status:'failed',completedAt:new Date().toISOString(),progressStage:'failed',heartbeatAt:new Date().toISOString(),workerPid:null,error:message});
    addBacktestEvent(id,'run_failed',`BACKTEST FAILED · ${message}`);
  }
};

export const normalizeBacktestConfig=(input:Partial<BacktestRunConfig>):BacktestRunConfig=>{
  const pairs=(input.pairs??forexPairs).filter(pair=>forexPairs.includes(pair));
  if(!pairs.length)throw new Error('Select at least one supported pair.');
  const requestedLabel=String(input.label??'').trim();
  const timeframeProfile=isGoldilocksTimeframeProfileId(input.timeframeProfile)?input.timeframeProfile:'intraday';
  const profile=getGoldilocksTimeframeProfile(timeframeProfile);
  const config:BacktestRunConfig={
    pairs:[...new Set(pairs)],
    lookbackDays:Math.min(profile.maximumLookbackDays,Math.max(30,Math.floor(input.lookbackDays??profile.defaultLookbackDays))),
    minimumScore:Math.min(20,Math.max(0,Math.floor(input.minimumScore??14))),
    label:(requestedLabel||(timeframeProfile==='intraday'?GOLDILOCKS_DEFAULT_BACKTEST_LABEL:`${profile.strategyVersion} | auto research`)).slice(0,80),
    strategyVersion:profile.strategyVersion,
    timeframeProfile,
    backfillPages:Math.min(500,Math.max(0,Math.floor(input.backfillPages??(timeframeProfile==='higherTimeframe'?25:10)))),
    startingBalance:Math.min(100_000_000,Math.max(1,Number(input.startingBalance??1000))),
    leverage:[10,20,30,50].includes(Number(input.leverage))?Number(input.leverage):30,
    riskProfile:isRiskProfile(input.riskProfile)?input.riskProfile:'default',
    archiveOnly:Boolean(input.archiveOnly),
    datasetEndTime:Number.isFinite(input.datasetEndTime)?Math.floor(Number(input.datasetEndTime)):undefined,
    datasetKey:input.datasetKey?String(input.datasetKey):undefined,
    researchManifest:input.researchManifest,
  };
  return config;
};

export const executeBacktestInline=async(input:Partial<BacktestRunConfig>)=>{
  const active=getActiveBacktestRun();
  if(active)throw new Error(`Backtest ${active.id} is already running.`);
  const config=normalizeBacktestConfig(input);
  const id=randomUUID();
  createBacktestRun(id,config);
  await executeBacktestRun(id,config);
  return {id,status:getBacktestRuntime(id)?.status??'failed',config};
};

export const startBacktest=(input:Partial<BacktestRunConfig>)=>{
  const active=getActiveBacktestRun();
  if(active)throw new Error(`Backtest ${active.id} is already running.`);
  const config=normalizeBacktestConfig(input);
  const id=randomUUID();
  createBacktestRun(id,config);
  const encoded=Buffer.from(JSON.stringify(config)).toString('base64url');
  const child=spawn(process.execPath,['--import','tsx','workers/backtestWorker.ts',id,encoded],{
    cwd:process.cwd(),detached:true,stdio:'ignore',windowsHide:true,
  });
  updateBacktestRun(id,{workerPid:child.pid??null,heartbeatAt:new Date().toISOString(),progressStage:'queued'});
  child.unref();
  return {id,status:'queued' as const,config};
};

export const cancelBacktest=(id:string)=>{
  const run=getBacktestRuntime(id);
  if(!run)throw new Error('Backtest run was not found.');
  if(run.status!=='queued'&&run.status!=='running')throw new Error(`Backtest is already ${run.status}.`);
  if(run.workerPid&&run.workerPid!==process.pid){
    try{process.kill(run.workerPid,'SIGTERM')}catch(error){
      const code=(error as NodeJS.ErrnoException).code;
      if(code!=='ESRCH')throw error;
    }
  }
  const completedAt=new Date().toISOString();
  updateBacktestRun(id,{status:'cancelled',completedAt,progressStage:'cancelled',heartbeatAt:completedAt,workerPid:null,error:'Cancelled by user.'});
  addBacktestEvent(id,'run_cancelled','BACKTEST CANCELLED · stopped by user.');
  return {id,status:'cancelled' as const};
};
