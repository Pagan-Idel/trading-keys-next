import { ContinuousCandleCollector } from '../utils/continuousCandleCollector.ts';
import { getGoldilocksTimeframeProfile,GOLDILOCKS_LIVE_CANDLE_LIMITS } from '../utils/goldilocksConfig.ts';
import { getAppliedAutomationStrategy } from '../utils/automationStore.ts';
import { pruneArchivedCandles } from '../utils/candleArchive.ts';
import { logMessage } from '../utils/automationLogger.ts';
import { candleCollectorJitterMs, runSequentially } from '../utils/workerRuntime.ts';
import { isExpectedCollectorShutdown } from '../utils/candleCollectorRuntime.ts';

const pair=process.argv[2]??'',mode: 'live'|'demo'=process.argv.some(value=>value==='--mode=live')?'live':'demo';
const controller=new AbortController();let stopped=false,lastRetentionAt=0;
const strategy=getAppliedAutomationStrategy();
const profile=getGoldilocksTimeframeProfile(strategy.config.timeframeProfile);
const timeframes=[...new Set([profile.trend,profile.zone,profile.confirmation])];
const collectors=timeframes.map(timeframe=>new ContinuousCandleCollector({pair,timeframe,mode},{lookbackDays:strategy.config.lookbackDays,maxCandles:GOLDILOCKS_LIVE_CANDLE_LIMITS[timeframe],incrementalLimit:5_000}));
const stop=()=>{stopped=true;controller.abort(new DOMException('Collector shutting down','AbortError'))};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
const wait=(milliseconds:number)=>new Promise<void>(resolve=>{const timer=setTimeout(resolve,milliseconds);controller.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve()},{once:true})});
const synchronizeCollectors=(method:'bootstrap'|'synchronize')=>runSequentially(collectors,collector=>collector[method](controller.signal));
const nextCloseDelay=()=>{const interval=5*60_000;return (Math.floor(Date.now()/interval)+1)*interval-Date.now()+350+candleCollectorJitterMs(pair)};
const run=async()=>{
  if(!pair)throw new Error('No pair was provided to the candle collector.');
  await wait(candleCollectorJitterMs(pair));
  if(stopped)return;
  await synchronizeCollectors('bootstrap');
  while(!stopped){
    try{
      const results=await synchronizeCollectors('synchronize');
      const gaps=results.filter(result=>result.gapDetected);
      for(const result of results)if(result.noPrintRecorded)logMessage(`CANDLE NO-PRINT | ${pair} | ${result.key.timeframe} | broker-confirmed interval retained without synthetic OHLC.`,result.noPrintRecorded,
        {pair,level:'warn',fileName:'candleCollector',step:'candle_no_print_recorded'});
      if(gaps.length)logMessage(`CANDLE GAP | ${pair} | ${gaps.map(item=>item.key.timeframe).join(', ')} unresolved.`,{timeframes:gaps.map(item=>item.key.timeframe)},
        {pair,level:'error',fileName:'candleCollector',step:'candle_gap_unresolved'});
      if(Date.now()-lastRetentionAt>=24*60*60*1000){lastRetentionAt=Date.now();const runs=timeframes.map(timeframe=>pruneArchivedCandles({pair,timeframe,mode}));
        logMessage(`CANDLE RETENTION | ${pair} | removed ${runs.reduce((sum,item)=>sum+item.rowsRemoved,0)} expired rows.`,{runs},{pair,fileName:'candleCollector',step:'candle_retention'});}
    }catch(error){if(!stopped)logMessage(`CANDLE SYNC FAILED | ${pair} | ${(error as Error).message}`,undefined,{pair,level:'error',fileName:'candleCollector',step:'candle_sync_failed'})}
    if(!stopped)await wait(nextCloseDelay());
  }
};
run().catch(error=>{
  if(isExpectedCollectorShutdown(error,stopped,controller.signal))return;
  console.error(error);process.exitCode=1;
});
