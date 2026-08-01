import { logMessage } from "../../logger";
import { oandaReadRequest } from './request.ts';
import type { Candle } from "../../swingLabeler";
import { normalizePairKeyUnderscore } from "../../shared";
import { getLoginMode } from "../../loginState";

export const fetchLatestCandles = async (
  symbol: string,
  interval: string,
  mode: 'live' | 'demo' = getLoginMode(),
  signal?:AbortSignal,
): Promise<Candle[]> => {
  try {
    const instrument = normalizePairKeyUnderscore(symbol);
    const granularity = interval.toUpperCase();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

    const url = new URL(`https://oanda.invalid/v3/accounts/account/candles/latest`);
    const spec = `${instrument}:${granularity}:BM`;
    url.searchParams.set("candleSpecifications", spec);
    url.searchParams.set("alignmentTimezone", timezone);
    url.searchParams.set("dailyAlignment", "17");

    const response=await oandaReadRequest({operation:'latest_account_candles',endpointTemplate:'/v3/accounts/{account}/candles/latest',mode,pair:symbol,signal,
      buildPath:({accountId})=>`/v3/accounts/${encodeURIComponent(accountId)}/candles/latest${url.search}`});

    const data = await response.json();

    const rawCandles = data.latestCandles?.[0]?.candles ?? [];

    const candles: Candle[] = rawCandles
      .filter((c: any) => c.complete && c.mid)
      .map((c: any, i: number) => ({
        time: c.time,
        candleIndex: i,
        open: parseFloat(c.mid.o),
        high: parseFloat(c.mid.h),
        low: parseFloat(c.mid.l),
        close: parseFloat(c.mid.c),
      }));

    return candles;
  } catch (error) {
    logMessage("🚫 fetchLatestCandles failed:", (error as Error).message, {
      level: "error",
      fileName: "fetchLatestCandles"
    });
    throw error;
  }
};
