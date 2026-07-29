import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { pruneOldestSetEntries,shouldPersistWorkerStatus } from '../utils/workerRuntime.ts';

const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'trading-keys-benchmark-'));
process.env.TRADING_KEYS_DATA_DIRECTORY=isolated;
const { upsertArchivedCandles }=await import(`../utils/candleArchive.ts?benchmark=${Date.now()}`);
const key={pair:'EUR/USD',timeframe:'M5',mode:'demo' as const};
const candles=Array.from({length:5_000},(_,index)=>({
  time:new Date(Date.UTC(2026,0,1,0,index*5)).toISOString(),candleIndex:index,
  open:1+index/1e6,high:1.1+index/1e6,low:.9+index/1e6,close:1.05+index/1e6,
}));
const timed=<T>(action:()=>T)=>{const start=performance.now();const value=action();return {value,milliseconds:performance.now()-start}};
const initial=timed(()=>upsertArchivedCandles(key,candles));
const duplicate=timed(()=>upsertArchivedCandles(key,candles));
const previous={state:'waiting',step:'waiting_for_confirmation',message:'Waiting',mode:'demo',pid:42,
  updatedAt:new Date().toISOString()};
const statuses=timed(()=>Array.from({length:100_000},()=>shouldPersistWorkerStatus(previous,
  {state:'waiting',step:'waiting_for_confirmation',message:'Waiting',mode:'demo',pid:42})).filter(Boolean).length);
const confirmations=new Set(Array.from({length:10_000},(_,index)=>String(index)));
const pruning=timed(()=>pruneOldestSetEntries(confirmations,2_000));
console.log(JSON.stringify({
  environment:{platform:process.platform,node:process.version},
  candlePersistence:{rows:candles.length,initialWrites:initial.value,initialMs:initial.milliseconds,
    unchangedWrites:duplicate.value,unchangedMs:duplicate.milliseconds},
  unchangedStatusChecks:{checks:100_000,writes:statuses.value,milliseconds:statuses.milliseconds},
  confirmationPruning:{before:10_000,after:pruning.value,milliseconds:pruning.milliseconds},
  memory:process.memoryUsage(),heapSizeLimitBytes:getHeapStatistics().heap_size_limit,
},null,2));
