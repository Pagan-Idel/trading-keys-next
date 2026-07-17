import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { forexPairs } from './constants.ts';
import { fetchCandleHistory } from './oanda/api/fetchCandleHistory.ts';
import { simulateGoldilocksPair } from './goldilocksBacktest.ts';
import { addBacktestEvent, createBacktestRun, getActiveBacktestRun, getBacktestRuntime, replaceBacktestTrades, updateBacktestRun, type BacktestRunConfig, type BacktestTradeInput } from './backtestStore.ts';
import { isRiskProfile } from './dynamicRisk.ts';

const limits:Record<string,number>={M1:250_000,M5:150_000,M15:60_000};

export const executeBacktestRun=async(id:string,config:BacktestRunConfig)=>{
  const all:BacktestTradeInput[]=[];
  try{
    updateBacktestRun(id,{status:'running',startedAt:new Date().toISOString(),progressDone:0,progressStage:'starting',progressPercent:0,heartbeatAt:new Date().toISOString(),workerPid:process.pid});
    addBacktestEvent(id,'run_started',`BACKTEST STARTED · ${config.label} · ${config.pairs.length} pair(s) · ${config.lookbackDays} days · minimum ${config.minimumScore}/20.`);
    const backfillPages=config.pairs.length===1?50:10;
    for(let index=0;index<config.pairs.length;index+=1){
      const pair=config.pairs[index];
      updateBacktestRun(id,{progressPair:pair,progressDone:index,progressStage:'loading history',progressPercent:index/config.pairs.length*100,heartbeatAt:new Date().toISOString()});
      addBacktestEvent(id,'pair_loading',`LOADING HISTORY · collecting M15/M5/M1 candles for ${pair}.`,pair);
      const [trendCandles,zoneCandles,confirmationCandles]=await Promise.all([
        fetchCandleHistory(pair,'M15',{lookbackDays:config.lookbackDays,mode:'demo',backfillPages,maxCandles:limits.M15}),
        fetchCandleHistory(pair,'M5',{lookbackDays:config.lookbackDays,mode:'demo',backfillPages,maxCandles:limits.M5}),
        fetchCandleHistory(pair,'M1',{lookbackDays:config.lookbackDays,mode:'demo',backfillPages,maxCandles:limits.M1}),
      ]);
      addBacktestEvent(id,'pair_scanning',`SCANNING ${pair} · M15 ${trendCandles.length.toLocaleString()} · M5 ${zoneCandles.length.toLocaleString()} · M1 ${confirmationCandles.length.toLocaleString()} candles.`,pair);
      let lastProgressWrite=0;
      let lastProgressBucket=-1;
      const trades=simulateGoldilocksPair({
        runId:id,pair,minimumScore:config.minimumScore,trendCandles,zoneCandles,confirmationCandles,
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

export const startBacktest=(input:Partial<BacktestRunConfig>)=>{
  const active=getActiveBacktestRun();
  if(active)throw new Error(`Backtest ${active.id} is already running.`);
  const pairs=(input.pairs??forexPairs).filter(pair=>forexPairs.includes(pair));
  if(!pairs.length)throw new Error('Select at least one supported pair.');
  const config:BacktestRunConfig={
    pairs:[...new Set(pairs)],
    lookbackDays:Math.min(730,Math.max(30,Math.floor(input.lookbackDays??730))),
    minimumScore:Math.min(20,Math.max(0,Math.floor(input.minimumScore??14))),
    label:String(input.label??`20pt-${new Date().toISOString().slice(0,16)}`).slice(0,80),
    startingBalance:Math.min(100_000_000,Math.max(1,Number(input.startingBalance??1000))),
    leverage:[10,20,30,50].includes(Number(input.leverage))?Number(input.leverage):30,
    riskProfile:isRiskProfile(input.riskProfile)?input.riskProfile:'default',
  };
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
