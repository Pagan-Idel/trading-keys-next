import credentials from "../../../credentials.json";
import { logMessage } from "../../logger";
import { OANDA_GRANULARITIES, INTERVAL_TO_GRANULARITY } from "../../constants";
import type { Candle } from "../../swingLabeler";
import { normalizePairKeyUnderscore } from "../../shared";

export const fetchCandles = async (
  symbol: string,
  interval: string,
  count: number = 5000,
  from?: string,
  to?: string,
  mode: 'live' | 'demo' = 'demo'
): Promise<Candle[]> => {
  try {
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

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

    const url = new URL(`${hostname}/v3/instruments/${instrument}/candles`);
    url.searchParams.set("granularity", granularity);
    if (!from && !to) {
      url.searchParams.set("count", count.toString());
    }
    url.searchParams.set("dailyAlignment", "17");
    url.searchParams.set("alignmentTimezone", timezone);
    if (from) url.searchParams.set("from", from);
    if (to) url.searchParams.set("to", to);
    logMessage("🔐 fetchCandles using account type", accountType, {
      fileName: "fetchCandles",
    });
    logMessage("🔑 Token and Account ID check", {
      token: token?.slice(0, 8) + '...', // partial token for safety
      accountId,
      url: url.toString(),
    }, {
      fileName: "fetchCandles",
    });

    const response = await fetch(url.toString(), {
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

    return candles;
  } catch (error) {
    logMessage("🚫 fetchCandles failed:", (error as Error).message, {
      level: "error",
      fileName: "fetchCandles"
    });
    throw error;
  }
};
