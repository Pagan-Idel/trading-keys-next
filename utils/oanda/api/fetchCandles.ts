import credentials from "../../../credentials.json";
import { logMessage } from "../../logger";
import { OANDA_GRANULARITIES, INTERVAL_TO_GRANULARITY } from "../../constants";
import type { Candle } from "../../swingLabeler";
import { normalizePairKeyUnderscore, tfToSeconds } from "../../shared";
import { getLoginMode } from "../../loginState";
import { isArchivedRangeCovered, readArchivedCandles, recordArchivedCoverage, upsertArchivedCandles } from '../../candleArchive.ts';

const MAX_RANGE_CANDLES_PER_REQUEST=4_000;

export const splitCandleRequestRange=(
  from:string,
  to:string,
  intervalSeconds:number,
  maximumCandles=MAX_RANGE_CANDLES_PER_REQUEST,
):Array<{from:string;to:string}>=>{
  const start=Date.parse(from);
  const end=Date.parse(to);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||intervalSeconds<=0)return [{from,to}];
  const maximumSpanMs=Math.max(1,maximumCandles)*intervalSeconds*1000;
  const ranges:Array<{from:string;to:string}>=[];
  for(let cursor=start;cursor<end;cursor+=maximumSpanMs){
    ranges.push({from:new Date(cursor).toISOString(),to:new Date(Math.min(end,cursor+maximumSpanMs)).toISOString()});
  }
  return ranges;
};

export const fetchCandles = async (
  symbol: string,
  interval: string,
  count: number = 5000,
  from?: string,
  to?: string,
  mode: 'live' | 'demo' = getLoginMode()
): Promise<Candle[]> => {
  try {
    const archiveKey={pair:symbol,timeframe:interval,mode};
    const intervalSeconds=tfToSeconds(interval);
    const requestedStart=from?Math.floor(Date.parse(from)/1000):Number.NaN;
    const requestedEnd=to?Math.floor(Date.parse(to)/1000):Number.NaN;
    if(from&&to&&Number.isFinite(requestedStart)&&Number.isFinite(requestedEnd)&&isArchivedRangeCovered(archiveKey,requestedStart,requestedEnd)){
      return readArchivedCandles(archiveKey,requestedStart,requestedEnd);
    }
    const accountType = mode;
    const hostname =
      accountType === "live"
        ? "https://api-fxtrade.oanda.com"
        : "https://api-fxpractice.oanda.com";

    const accountId =
      accountType === "live"
        ? credentials.OANDA_LIVE_ACCOUNT_ID
        : credentials.OANDA_DEMO_ACCOUNT_ID;

    const token =
      accountType === "live"
        ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
        : credentials.OANDA_DEMO_ACCOUNT_TOKEN;

    if (!accountId || !hostname || !token) {
      logMessage("❌ Missing OANDA credentials or hostname.", undefined, {
        level: "error",
        fileName: "fetchCandles",
      });
      throw new Error("❌ Missing OANDA credentials or hostname.");
    }

    const instrument = normalizePairKeyUnderscore(symbol);
    const granularity = INTERVAL_TO_GRANULARITY[interval] || interval.toUpperCase();

    if (!OANDA_GRANULARITIES.includes(granularity)) {
      logMessage("❌ Invalid granularity value", { granularity, interval }, {
        level: "error",
        fileName: "fetchCandles"
      });
      throw new Error(`Invalid granularity: ${granularity}`);
    }

    if(from&&to){
      const ranges=splitCandleRequestRange(from,to,intervalSeconds);
      if(ranges.length>1){
        const byTime=new Map<string,Candle>();
        for(const range of ranges){
          const page=await fetchCandles(symbol,interval,Math.min(count,MAX_RANGE_CANDLES_PER_REQUEST),range.from,range.to,mode);
          for(const candle of page)byTime.set(candle.time,candle);
        }
        const merged=[...byTime.values()]
          .sort((left,right)=>Date.parse(left.time)-Date.parse(right.time))
          .map((candle,candleIndex)=>({...candle,candleIndex}));
        upsertArchivedCandles(archiveKey,merged);
        recordArchivedCoverage(archiveKey,requestedStart,requestedEnd,intervalSeconds);
        return merged;
      }
    }

    const url = new URL(`${hostname}/v3/instruments/${instrument}/candles`);
    url.searchParams.set("granularity", granularity);
    if (!(from && to)) {
      url.searchParams.set("count", count.toString());
    }
    url.searchParams.set("price", "M");
    url.searchParams.set("smooth", "false");
    url.searchParams.set("dailyAlignment", "17");
    // Keep candle boundaries identical on Windows, the Raspberry Pi, and in backtests.
    url.searchParams.set("alignmentTimezone", "America/New_York");
    if (from) url.searchParams.set("from", from);
    if (to) url.searchParams.set("to", to);
    // Removed noisy info-level logs for cleaner output

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logMessage("❌ Failed to fetch candles", errorText, {
        level: "error",
        fileName: "fetchCandles"
      });
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    const candles: Candle[] = data.candles
      .filter((c: any) => c.complete && c.mid)
      .map((c: any, i: number) => ({
        time: c.time,
        candleIndex: i,
        open: parseFloat(c.mid.o),
        high: parseFloat(c.mid.h),
        low: parseFloat(c.mid.l),
        close: parseFloat(c.mid.c),
      }));

    upsertArchivedCandles(archiveKey,candles);
    if(from&&to&&Number.isFinite(requestedStart)&&Number.isFinite(requestedEnd)){
      const completedThrough=Math.min(requestedEnd,Math.floor(Date.now()/1000)-intervalSeconds);
      if(completedThrough>=requestedStart)recordArchivedCoverage(archiveKey,requestedStart,completedThrough,intervalSeconds);
    }

    return candles;
  } catch (error) {
    logMessage("🚫 fetchCandles failed:", (error as Error).message, {
      level: "error",
      fileName: "fetchCandles"
    });
    throw error;
  }
};

/** Fetch only candles completed after a known candle, without returning it again. */
export const fetchCompletedCandlesSince = async (
  symbol: string,
  interval: string,
  lastCompletedTime: string,
  mode: 'live' | 'demo' = getLoginMode(),
  count = 20,
): Promise<Candle[]> => {
  const accountType = mode;
  const hostname = accountType === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
  const token = accountType === 'live' ? credentials.OANDA_LIVE_ACCOUNT_TOKEN : credentials.OANDA_DEMO_ACCOUNT_TOKEN;
  const instrument = normalizePairKeyUnderscore(symbol);
  const granularity = INTERVAL_TO_GRANULARITY[interval] || interval.toUpperCase();
  const url = new URL(`${hostname}/v3/instruments/${instrument}/candles`);
  url.searchParams.set('granularity', granularity);
  url.searchParams.set('price', 'M');
  url.searchParams.set('smooth', 'false');
  url.searchParams.set('from', lastCompletedTime);
  url.searchParams.set('includeFirst', 'false');
  url.searchParams.set('count', String(Math.min(5_000, Math.max(1, count))));
  url.searchParams.set('dailyAlignment', '17');
  url.searchParams.set('alignmentTimezone', 'America/New_York');
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`OANDA incremental candle request failed: HTTP ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const candles=(data.candles ?? [])
    .filter((c: any) => c.complete && c.mid)
    .map((c: any, candleIndex: number) => ({
      time: c.time,
      candleIndex,
      open: Number(c.mid.o), high: Number(c.mid.h), low: Number(c.mid.l), close: Number(c.mid.c),
    }))
    .sort((a: Candle, b: Candle) => Date.parse(a.time) - Date.parse(b.time));
  upsertArchivedCandles({pair:symbol,timeframe:interval,mode},candles);
  return candles;
};
