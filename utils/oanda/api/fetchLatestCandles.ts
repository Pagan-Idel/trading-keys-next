import { logMessage } from "../../logger";
import credentials from "../../../credentials.json";
import type { Candle } from "../../swingLabeler";
import { normalizePairKeyUnderscore } from "../../shared";
import { getLoginMode } from "../../loginState";

export const fetchLatestCandles = async (
  symbol: string,
  interval: string,
  mode: 'live' | 'demo' = 'demo'
): Promise<Candle[]> => {
  try {
    const hostname =
      mode === "live"
        ? "https://api-fxtrade.oanda.com"
        : "https://api-fxpractice.oanda.com";

    const accountId =
      mode === "live"
        ? credentials.OANDA_LIVE_ACCOUNT_ID
        : credentials.OANDA_DEMO_ACCOUNT_ID;

    const token =
      mode === "live"
        ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
        : credentials.OANDA_DEMO_ACCOUNT_TOKEN;

    if (!accountId || !hostname || !token) {
      logMessage("❌ Missing OANDA credentials or hostname.", undefined, {
        level: "error",
        fileName: "fetchLatestCandles",
      });
      throw new Error("❌ Missing OANDA credentials or hostname.");
    }

    const instrument = normalizePairKeyUnderscore(symbol);
    const granularity = interval.toUpperCase();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

    const url = new URL(`${hostname}/v3/accounts/${accountId}/candles/latest`);
    const spec = `${instrument}:${granularity}:BM`;
    url.searchParams.set("candleSpecifications", spec);
    url.searchParams.set("alignmentTimezone", timezone);
    url.searchParams.set("dailyAlignment", "17");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logMessage("❌ Failed to fetch latest candles", errorText, {
        level: "error",
        fileName: "fetchLatestCandles"
      });
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

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
