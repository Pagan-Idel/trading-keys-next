import fs from 'fs';
import path from 'path';
import { gunzipSync } from 'zlib';
import type { Candle } from '../../swingLabeler.ts';
import { normalizePairKeyUnderscore, tfToSeconds } from '../../shared.ts';
import { fetchCandles } from './fetchCandles.ts';
import { legacyCandleCacheNeedsImport, markLegacyCandleCacheImported, readArchivedCandles, recordArchivedCoverage, upsertArchivedCandles } from '../../candleArchive.ts';

interface CandleHistoryCache {
  coverageStart: number;
  candles: Candle[];
}

export interface CandleHistoryOptions {
  lookbackDays: number;
  mode: 'live' | 'demo';
  maxCandles?: number;
  backfillPages?: number;
  archiveOnly?:boolean;
  endTime?:number;
  acquireFullRange?:boolean;
}

const CACHE_DIRECTORY = path.resolve(process.cwd(), 'data', 'candle-history');
const HISTORY_PAGE_SIZE = 1_000;
const cachePath = (pair: string, timeframe: string, mode: string) => path.join(
  CACHE_DIRECTORY,
  `${mode}-${normalizePairKeyUnderscore(pair)}-${timeframe.toUpperCase()}.json.gz`,
);

const readCache = (filePath: string): CandleHistoryCache | null => {
  try {
    return JSON.parse(gunzipSync(fs.readFileSync(filePath)).toString('utf8')) as CandleHistoryCache;
  } catch {
    return null;
  }
};

const candleTime = (candle: Candle) => new Date(candle.time).getTime();
const maximum = (values: Iterable<number>, fallback: number) => {
  let result = fallback;
  for (const value of values) if (value > result) result = value;
  return result;
};
const minimum = (values: Iterable<number>, fallback: number) => {
  let result = fallback;
  for (const value of values) if (value < result) result = value;
  return result;
};

export const fetchCandleHistory = async (
  pair: string,
  timeframe: string,
  options: CandleHistoryOptions,
): Promise<Candle[]> => {
  const now = options.endTime&&Number.isFinite(options.endTime)?Math.floor(options.endTime*1000):Date.now()-10_000;
  const intervalMs = tfToSeconds(timeframe) * 1000;
  const requestedStart = now - options.lookbackDays * 24 * 60 * 60 * 1000;
  const filePath = cachePath(pair, timeframe, options.mode);
  const archiveKey={pair,timeframe,mode:options.mode};
  if(!options.archiveOnly&&legacyCandleCacheNeedsImport(filePath)){
    const legacy=readCache(filePath);
    if(legacy?.candles.length){
      upsertArchivedCandles(archiveKey,legacy.candles,'LEGACY_GZIP_OANDA_MID');
      const legacyStart=Math.floor(candleTime(legacy.candles[0])/1000);
      const legacyEnd=Math.floor(candleTime(legacy.candles[legacy.candles.length-1])/1000)+Math.floor(intervalMs/1000);
      recordArchivedCoverage(archiveKey,legacyStart,legacyEnd,Math.floor(intervalMs/1000));
      markLegacyCandleCacheImported(filePath,legacy.candles.length);
    }
  }
  const existing=readArchivedCandles(archiveKey,Math.floor((requestedStart-intervalMs)/1000),Math.floor(now/1000));
  const byTime = new Map<number, Candle>();
  for (const candle of existing) {
    const time = candleTime(candle);
    if (Number.isFinite(time) && time >= requestedStart - intervalMs) byTime.set(time, candle);
  }

  if(options.archiveOnly){
    if(!byTime.size)throw new Error(`SEALED DATASET MISSING · ${pair} ${timeframe} has no archived candles.`);
    let archived=[...byTime.entries()]
      .filter(([time])=>time>=requestedStart&&time<=now)
      .sort(([left],[right])=>left-right)
      .map(([,candle],index)=>({...candle,candleIndex:index}));
    const firstTime=archived.length?candleTime(archived[0]):Number.POSITIVE_INFINITY;
    const lastTime=archived.length?candleTime(archived[archived.length-1]):Number.NEGATIVE_INFINITY;
    const boundaryTolerance=Math.max(7*24*60*60*1000,intervalMs*10);
    if(firstTime>requestedStart+boundaryTolerance||lastTime<now-boundaryTolerance){
      throw new Error(`SEALED DATASET INCOMPLETE · ${pair} ${timeframe} covers ${archived[0]?.time??'none'} through ${archived.at(-1)?.time??'none'}; required ${new Date(requestedStart).toISOString()} through ${new Date(now).toISOString()}.`);
    }
    if(options.maxCandles&&archived.length>options.maxCandles)archived=archived.slice(-options.maxCandles).map((candle,index)=>({...candle,candleIndex:index}));
    return archived;
  }

  // Research acquisition uses one bounded from/to pass. fetchCandles splits the
  // range below OANDA's limit and skips every range already marked as covered.
  // Trials never enter this branch because their archiveOnly flag is mandatory.
  if(options.acquireFullRange){
    await fetchCandles(
      pair,timeframe,Math.min(4_000,options.maxCandles??4_000),
      new Date(requestedStart).toISOString(),new Date(now).toISOString(),options.mode,
    );
    let archived=readArchivedCandles(archiveKey,Math.floor(requestedStart/1000),Math.floor(now/1000))
      .map((candle,index)=>({...candle,candleIndex:index}));
    if(options.maxCandles&&archived.length>options.maxCandles)archived=archived.slice(-options.maxCandles).map((candle,index)=>({...candle,candleIndex:index}));
    if(!archived.length)throw new Error(`DATASET ACQUISITION EMPTY · ${pair} ${timeframe} returned no completed candles.`);
    return archived;
  }

  if (!byTime.size) {
    const recent = await fetchCandles(pair, timeframe, HISTORY_PAGE_SIZE, undefined, undefined, options.mode);
    for (const candle of recent) byTime.set(candleTime(candle), candle);
  }

  const latestCached = maximum(byTime.keys(), requestedStart);
  if (latestCached < now - intervalMs * 2) {
    const recent = await fetchCandles(pair, timeframe, HISTORY_PAGE_SIZE, new Date(latestCached + intervalMs).toISOString(), undefined, options.mode);
    for (const candle of recent) byTime.set(candleTime(candle), candle);
  }

  const backfillPages = Math.max(0, Math.floor(options.backfillPages ?? 1));
  for (let page = 0; page < backfillPages; page += 1) {
    const earliest = minimum(byTime.keys(), now);
    if (earliest <= requestedStart + intervalMs) break;
    const older = await fetchCandles(pair, timeframe, HISTORY_PAGE_SIZE, undefined, new Date(earliest - 1).toISOString(), options.mode);
    if (!older.length) break;
    for (const candle of older) byTime.set(candleTime(candle), candle);
  }

  let candles = [...byTime.entries()]
    .filter(([time]) => time >= requestedStart)
    .sort(([left], [right]) => left - right)
    .map(([, candle], index) => ({ ...candle, candleIndex: index }));
  // Another worker may have filled the same archive while broker requests were in flight.
  const concurrent=readArchivedCandles(archiveKey,Math.floor(requestedStart/1000),Math.floor(now/1000));
  if(concurrent.length){
    const merged=new Map(candles.map(candle=>[candleTime(candle),candle]));
    for(const candle of concurrent){const time=candleTime(candle);if(time>=requestedStart)merged.set(time,candle)}
    candles=[...merged.entries()].sort(([left],[right])=>left-right).map(([,candle],index)=>({...candle,candleIndex:index}));
  }
  upsertArchivedCandles(archiveKey,candles);
  if (options.maxCandles && candles.length > options.maxCandles) {
    return candles.slice(-options.maxCandles).map((candle, index) => ({ ...candle, candleIndex: index }));
  }
  return candles;
};
