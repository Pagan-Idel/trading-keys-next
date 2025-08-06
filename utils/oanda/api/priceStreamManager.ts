import credentials from "../../../credentials.json";
import { getPrecision, normalizePairKeyUnderscore, tfToMs } from "../../shared";
import { logMessage } from "../../logger";
import { getLoginMode } from "../../loginState";

type Price = { bid: string; ask: string; updatedAt: number };
const priceCache: Record<string, Price> = {};
const streamInitialized: Set<string> = new Set();
const streamControllers: Record<string, ReadableStreamDefaultReader<Uint8Array>> = {};
const staleCheckIntervals: Record<string, NodeJS.Timeout> = {};

const getLocalStorageItem = (key: string): string | null => {
  if (typeof window !== "undefined") {
    return localStorage.getItem(key);
  }
  return null;
};

const getAccountDetails = () => {
  const accountType = getLoginMode(); // ✅ use dynamic backend-safe login mode
  const hostname =
    accountType === "live"
      ? "https://stream-fxtrade.oanda.com"
      : "https://stream-fxpractice.oanda.com";
  const restHost =
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

  return { hostname, restHost, accountId, token };
};

export const fetchPriceOnce = async (symbol: string): Promise<{ bid: string; ask: string } | null> => {
  const norm = normalizePairKeyUnderscore(symbol);
  const { restHost, accountId, token } = getAccountDetails();
  const url = `${restHost}/v3/accounts/${accountId}/pricing?instruments=${norm}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    const prices = json?.prices?.[0];

    if (!prices?.bids?.[0]?.price || !prices?.asks?.[0]?.price) {
      logMessage(`❌ Missing price data for ${norm}`);
      return null;
    }

    // logMessage(`📡 One-time price fetch for ${norm} — Bid: ${prices.bids[0].price}, Ask: ${prices.asks[0].price}`, undefined, {fileName: "priceStream"});

    return {
      bid: prices.bids[0].price,
      ask: prices.asks[0].price
    };
  } catch (err: any) {
    logMessage(`❌ Error fetching one-time price for ${norm}: ${err.message}`, undefined, { fileName: "priceStream" });
    return null;
  }
};

const monitorStaleStream = (symbol: string) => {
  const norm = normalizePairKeyUnderscore(symbol);
  if (staleCheckIntervals[norm]) return;

  staleCheckIntervals[norm] = setInterval(async () => {
    const price = priceCache[norm];
    const ageSec = price ? (Date.now() - price.updatedAt) / 1000 : Infinity;

    if (ageSec > 5) {
      logMessage(`🔁 Detected stale price for ${norm} (${ageSec.toFixed(1)}s old). Restarting stream.`, undefined, { fileName: "priceStream" });
      await stopPriceStream(symbol);
      await new Promise((res) => setTimeout(res, 1000));
      setupStream(symbol);
    }
  }, 5000);
};

const setupStream = async (symbol: string) => {
  const norm = normalizePairKeyUnderscore(symbol);
  if (streamInitialized.has(norm)) {
    logMessage(`⏩ Stream already initialized for ${norm}`, undefined, { fileName: "priceStream" });
    return;
  }

  streamInitialized.add(norm);
  const { hostname, accountId, token } = getAccountDetails();
  const url = `${hostname}/v3/accounts/${accountId}/pricing/stream?instruments=${norm}`;

  logMessage(`📡 Opening price stream for ${norm}`, undefined, { fileName: "priceStream" });
  logMessage(`🌐 URL: ${url}`, undefined, { fileName: "priceStream" });

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const reader = res.body?.getReader();
    if (!reader) throw new Error("Stream reader not available");

    streamControllers[norm] = reader;
    monitorStaleStream(symbol);

    const decoder = new TextDecoder();

    (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          logMessage(`📴 Stream for ${norm} closed. Retrying in 5 seconds...`, undefined, { fileName: "priceStream" });
          streamInitialized.delete(norm);
          delete streamControllers[norm];
          clearInterval(staleCheckIntervals[norm]);
          delete staleCheckIntervals[norm];
          setTimeout(() => setupStream(symbol), 5000);
          break;
        }

        const text = decoder.decode(value);
        const lines = text.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.asks && json.bids) {
              const ask = json.asks.at(-1)?.price;
              const bid = json.bids.at(-1)?.price;
              if (ask && bid) {
                priceCache[norm] = {
                  ask,
                  bid,
                  updatedAt: Date.now(),
                };
              } else {
                logMessage(`⚠️ Missing ask/bid price in stream data for ${norm}`, undefined, { fileName: "priceStream" });
              }
            }
          } catch (err) {
            logMessage(`❌ Failed to parse stream data for ${norm}: ${line}`, undefined, { fileName: "priceStream" });
          }
        }
      }
    })().catch((err) => {
      logMessage(`❌ Stream error for ${norm}: ${err.message}`, undefined, { fileName: "priceStream" });
      streamInitialized.delete(norm);
      delete streamControllers[norm];
      clearInterval(staleCheckIntervals[norm]);
      delete staleCheckIntervals[norm];
    });

  } catch (err: any) {
    logMessage(`❌ Stream connection error for ${norm}: ${err.message}. Retrying in 5 seconds...`, undefined, { fileName: "priceStream" });
    streamInitialized.delete(norm);
    delete streamControllers[norm];
    clearInterval(staleCheckIntervals[norm]);
    delete staleCheckIntervals[norm];
    setTimeout(() => setupStream(symbol), 5000);
  }
};

export const initializePriceStreams = async (symbols: string[]) => {
  logMessage(`🧠 Initializing price streams for: ${symbols.join(", ")}`, undefined, { fileName: "priceStream" });
  symbols.forEach(startPriceStream);
};

export const startPriceStream = (symbol: string) => {
  setupStream(symbol); // non-blocking
};

export const isStreamInitialized = (symbol: string): boolean => {
  const norm = normalizePairKeyUnderscore(symbol);
  return streamInitialized.has(norm);
};

export const stopPriceStream = async (symbol: string) => {
  const norm = normalizePairKeyUnderscore(symbol);
  const controller = streamControllers[norm];
  if (controller) {
    try {
      await controller.cancel();
      logMessage(`🛑 Manually closed stream for ${norm}`, undefined, { fileName: "priceStream" });
    } catch (err: any) {
      logMessage(`⚠️ Error closing stream for ${norm}: ${err.message}`, undefined, { fileName: "priceStream" });
    }
  } else {
    logMessage(`⚠️ No stream controller found for ${norm}`, undefined, { fileName: "priceStream" });
  }
  streamInitialized.delete(norm);
  delete streamControllers[norm];
  clearInterval(staleCheckIntervals[norm]);
  delete staleCheckIntervals[norm];
};

export const stopAllStreams = async () => {
  const pairs = Object.keys(streamControllers);
  for (const pair of pairs) {
    await stopPriceStream(pair);
  }
};

export const getLatestPrice = (symbol: string): { bid: string; ask: string } => {
  const norm = normalizePairKeyUnderscore(symbol);
  const price = priceCache[norm];
  if (!price) {
    logMessage(`⚠️ No price found in cache for ${norm}. Returning 0s.`, undefined, { fileName: "priceStream" });
    return { bid: "0", ask: "0" };
  }

  const ageSec = (Date.now() - price.updatedAt) / 1000;
  if (ageSec > 5) {
    logMessage(`⚠️ Stale price data (${ageSec.toFixed(1)}s old) for ${norm}.`, undefined, { fileName: "priceStream" });
  } else {
    // logMessage(`📦 Cached price for ${norm}: Bid ${price.bid}, Ask ${price.ask}, Age ${ageSec.toFixed(1)}s`, undefined, { fileName: "priceStream" });
  }

  return { bid: price.bid, ask: price.ask };
};

export const streamToCandles = async (
  symbol: string,
  tf: string,
  maxCandles = 10
): Promise<{ instrument: string; granularity: string; candles: any[] }> => {
  const norm = normalizePairKeyUnderscore(symbol);
  const durationMs = tfToMs(tf);

  const candles: any[] = [];
  let current: any = null;
  let start = 0;

  // ✅ Ensure stream is running
  if (!isStreamInitialized(symbol)) {
    logMessage(`📡 Starting price stream for ${norm}`, undefined, { fileName: "priceStream" });
    startPriceStream(symbol);
  }

  // ✅ Wait for first tick BEFORE aligning
  let tries = 0;
  while (tries < 50) {
    const price = getLatestPrice(symbol);
    const bid = parseFloat(price.bid);
    const ask = parseFloat(price.ask);
    if (!isNaN(bid) && !isNaN(ask)) {
      logMessage(`✅ First tick received for ${norm}`, undefined, { fileName: "priceStream" });
      break;
    }
    logMessage(`⏳ Waiting for first price tick for ${norm}...`, undefined, { fileName: "priceStream" });
    await new Promise(res => setTimeout(res, 200));
    tries++;
  }

  // ✅ Snap to current TF window without waiting for next boundary
  const now = Date.now();
  start = Math.floor(now / durationMs) * durationMs;

  logMessage(`🕯️ Starting candle aggregation for ${norm} TF ${tf}`, undefined, { fileName: "priceStream" });

  while (candles.length < maxCandles) {
    const price = getLatestPrice(symbol);
    const bid = parseFloat(price.bid);
    const ask = parseFloat(price.ask);

    if (isNaN(bid) || isNaN(ask)) {
      await new Promise(res => setTimeout(res, 250));
      continue;
    }

    const mid = (bid + ask) / 2; // ✅ raw mid, no rounding

    const now = Date.now();

    if (!current || now >= start + durationMs) {
      if (current) {
        if (
          current.mid &&
          typeof current.mid.o === "number" &&
          !isNaN(current.mid.o)
        ) {
          current.complete = true;
          candles.push(current);
        }
      }
      start = Math.floor(now / durationMs) * durationMs;
      current = {
        time: new Date(start).toISOString(),
        mid: { o: mid, h: mid, l: mid, c: mid },
        volume: 0,
        complete: false
      };
    }

    // ✅ Preserve raw floats, no rounding here
    current.mid.h = Math.max(current.mid.h, mid);
    current.mid.l = Math.min(current.mid.l, mid);
    current.mid.c = mid;
    current.volume++;

    await new Promise(res => setTimeout(res, 250)); // sample interval
  }

  return { instrument: norm, granularity: tf, candles };
};


export const killStreamByPair = async (symbol: string) => {
  const norm = normalizePairKeyUnderscore(symbol);
  logMessage(`🛑 Killing price stream for ${norm}`, undefined, { fileName: "priceStream" });
  await stopPriceStream(symbol);
};

function roundToOanda(symbol: string, value: number): number {
  const precision = getPrecision(symbol);
  const factor = Math.pow(10, precision);
  return Math.trunc(value * factor) / factor;
}