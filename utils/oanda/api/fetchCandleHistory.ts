import fs from 'fs';
import path from 'path';
import { gunzipSync, gzipSync } from 'zlib';
import type { Candle } from '../../swingLabeler.ts';
import { normalizePairKeyUnderscore, tfToSeconds } from '../../shared.ts';
import { fetchCandles } from './fetchCandles.ts';

interface CandleHistoryCache {
  coverageStart: number;
  candles: Candle[];
}

interface CandleHistoryOptions {
  lookbackDays: number;
  mode: 'live' | 'demo';
  maxCandles?: number;
  backfillPages?: number;
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

const writeCache = (filePath: string, cache: CandleHistoryCache) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, gzipSync(JSON.stringify(cache)));
  fs.renameSync(temporary, filePath);
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
  const now = Date.now() - 10_000;
  const intervalMs = tfToSeconds(timeframe) * 1000;
  const requestedStart = now - options.lookbackDays * 24 * 60 * 60 * 1000;
  const filePath = cachePath(pair, timeframe, options.mode);
  const existing = readCache(filePath);
  const byTime = new Map<number, Candle>();
  for (const candle of existing?.candles ?? []) {
    const time = candleTime(candle);
    if (Number.isFinite(time) && time >= requestedStart - intervalMs) byTime.set(time, candle);
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
  const concurrent = readCache(filePath);
  if (concurrent) {
    const merged = new Map(candles.map(candle => [candleTime(candle), candle]));
    for (const candle of concurrent.candles) {
      const time = candleTime(candle);
      if (time >= requestedStart) merged.set(time, candle);
    }
    candles = [...merged.entries()].sort(([left], [right]) => left - right).map(([, candle], index) => ({ ...candle, candleIndex: index }));
  }
  const actualCoverageStart = candles.length ? candleTime(candles[0]) : requestedStart;
  writeCache(filePath, { coverageStart: actualCoverageStart, candles });
  if (options.maxCandles && candles.length > options.maxCandles) {
    return candles.slice(-options.maxCandles).map((candle, index) => ({ ...candle, candleIndex: index }));
  }
  return candles;
};
