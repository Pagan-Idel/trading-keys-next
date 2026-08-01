import { ContinuousCandleCollector } from '../utils/continuousCandleCollector.ts';
import { GOLDILOCKS_DEMO_TIMEFRAMES,GOLDILOCKS_LIVE_CANDLE_LIMITS } from '../utils/goldilocksConfig.ts';
import { pruneArchivedCandles } from '../utils/candleArchive.ts';
import { logMessage } from '../utils/automationLogger.ts';
import { workerScanJitterMs } from '../utils/workerRuntime.ts';

const pair=process.argv[2]??'',mode: 'live'|'demo'=process.argv.some(value=>value==='--mode=live')?'live':'demo';
const controller=new AbortController();let stopped=false,lastRetentionAt=0;
const timeframes=[...new Set([GOLDILOCKS_DEMO_TIMEFRAMES.trend,GOLDILOCKS_DEMO_TIMEFRAMES.zone,GOLDILOCKS_DEMO_TIMEFRAMES.confirmation])];
const collectors=timeframes.map(timeframe=>new ContinuousCandleCollector({pair,timeframe,mode},{lookbackDays:730,maxCandles:GOLDILOCKS_LIVE_CANDLE_LIMITS[timeframe],incrementalLimit:5_000}));
const stop=()=>{stopped=true;controller.abort(new DOMException('Collector shutting down','AbortError'))};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
const wait=(milliseconds:number)=>new Promise<void>(resolve=>{const timer=setTimeout(resolve,milliseconds);controller.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve()},{once:true})});
const nextCloseDelay=()=>{const interval=5*60_000;return (Math.floor(Date.now()/interval)+1)*interval-Date.now()+350+workerScanJitterMs(pair)};
const run=async()=>{
  if(!pair)throw new Error('No pair was provided to the candle collector.');
  await Promise.all(collectors.map(collector=>collector.bootstrap(controller.signal)));
  while(!stopped){
    try{
      const results=await Promise.all(collectors.map(collector=>collector.synchronize(controller.signal)));
      const gaps=results.filter(result=>result.gapDetected);
      if(gaps.length)logMessage(`CANDLE GAP | ${pair} | ${gaps.map(item=>item.key.timeframe).join(', ')} unresolved.`,{timeframes:gaps.map(item=>item.key.timeframe)},
        {pair,level:'error',fileName:'candleCollector',step:'candle_gap_unresolved'});
      if(Date.now()-lastRetentionAt>=24*60*60*1000){lastRetentionAt=Date.now();const runs=timeframes.map(timeframe=>pruneArchivedCandles({pair,timeframe,mode}));
        logMessage(`CANDLE RETENTION | ${pair} | removed ${runs.reduce((sum,item)=>sum+item.rowsRemoved,0)} expired rows.`,{runs},{pair,fileName:'candleCollector',step:'candle_retention'});}
    }catch(error){if(!stopped)logMessage(`CANDLE SYNC FAILED | ${pair} | ${(error as Error).message}`,undefined,{pair,level:'error',fileName:'candleCollector',step:'candle_sync_failed'})}
    if(!stopped)await wait(nextCloseDelay());
  }
};
run().catch(error=>{console.error(error);process.exitCode=1});
