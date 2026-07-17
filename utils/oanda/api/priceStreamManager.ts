import credentials from "../../../credentials.json";
import { normalizePairKeyUnderscore, tfToMs } from "../../shared";
import { logMessage } from "../../logger";
import { getLoginMode } from "../../loginState";

type Mode = "live" | "demo";
export type OandaQuote = {
  bid: string;
  ask: string;
  oandaTime: string;
  receivedAt: number;
  tradeable: boolean;
  source: "stream" | "rest";
};

type StreamState = {
  symbols: string[];
  mode: Mode;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  abort?: AbortController;
  decoder: TextDecoder;
  carry: string;
  lastMessageAt: number;
  reconnectAttempt: number;
  reconnectTimer?: NodeJS.Timeout;
  healthTimer?: NodeJS.Timeout;
  stopped: boolean;
};

const STREAM_QUOTE_MAX_AGE_MS = 2_000;
const STREAM_MESSAGE_TIMEOUT_MS = 15_000;
const priceCache = new Map<string, OandaQuote>();
const streams = new Map<string, StreamState>();
const cacheKey = (symbol: string, mode: Mode) => `${mode}:${normalizePairKeyUnderscore(symbol)}`;

const getAccountDetails = (mode: Mode = getLoginMode()) => ({
  hostname: mode === "live" ? "https://stream-fxtrade.oanda.com" : "https://stream-fxpractice.oanda.com",
  restHost: mode === "live" ? "https://api-fxtrade.oanda.com" : "https://api-fxpractice.oanda.com",
  accountId: mode === "live" ? credentials.OANDA_LIVE_ACCOUNT_ID : credentials.OANDA_DEMO_ACCOUNT_ID,
  token: mode === "live" ? credentials.OANDA_LIVE_ACCOUNT_TOKEN : credentials.OANDA_DEMO_ACCOUNT_TOKEN,
});

const acceptPriceMessage = (state: StreamState, message: any) => {
  state.lastMessageAt = Date.now();
  if (message?.type === "HEARTBEAT") return;
  if (message?.type !== "PRICE") return;
  const bid = message.bids?.[0]?.price;
  const ask = message.asks?.[0]?.price;
  if (!bid || !ask || !message.time) return;

  const instrument = message.instrument;
  if (!instrument || !state.symbols.some(symbol => normalizePairKeyUnderscore(symbol) === instrument)) return;
  const key = cacheKey(instrument, state.mode);
  const current = priceCache.get(key);
  if (current && Date.parse(message.time) < Date.parse(current.oandaTime)) return;
  priceCache.set(key, {
    bid,
    ask,
    oandaTime: message.time,
    receivedAt: Date.now(),
    tradeable: message.tradeable !== false,
    source: "stream",
  });
  state.reconnectAttempt = 0;
};

/** OANDA uses newline-delimited JSON and may split a JSON object across chunks. */
export const consumePricingChunk = (state: Pick<StreamState, "decoder" | "carry">, chunk: Uint8Array, onMessage: (message: any) => void) => {
  state.carry += state.decoder.decode(chunk, { stream: true });
  const lines = state.carry.split("\n");
  state.carry = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) onMessage(JSON.parse(trimmed));
  }
};

const scheduleReconnect = (state: StreamState) => {
  if (state.stopped || state.reconnectTimer) return;
  state.reconnectAttempt += 1;
  const base = Math.min(30_000, 1_000 * (2 ** Math.min(state.reconnectAttempt - 1, 5)));
  const delay = base + Math.floor(Math.random() * 500);
  logMessage(`Shared price stream reconnecting in ${(delay / 1000).toFixed(1)}s.`, undefined, { fileName: "priceStream" });
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = undefined;
    void connect(state);
  }, delay);
};

const connect = async (state: StreamState) => {
  if (state.stopped) return;
  const { hostname, accountId, token } = getAccountDetails(state.mode);
  const instruments = state.symbols.map(normalizePairKeyUnderscore);
  state.abort = new AbortController();
  state.decoder = new TextDecoder();
  state.carry = "";
  try {
    const url = `${hostname}/v3/accounts/${accountId}/pricing/stream?instruments=${encodeURIComponent(instruments.join(','))}&snapshot=true`;
    const response = await fetch(url, {
      signal: state.abort.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("OANDA returned no streaming response body.");
    state.reader = reader;
    state.lastMessageAt = Date.now();
    logMessage(`Shared price stream connected for ${instruments.length} instrument(s) (${state.mode}).`, undefined, { fileName: "priceStream" });

    while (!state.stopped) {
      const { value, done } = await reader.read();
      if (done) throw new Error("OANDA closed the pricing stream.");
      if (!value) continue;
      try {
        consumePricingChunk(state, value, message => acceptPriceMessage(state, message));
      } catch (error) {
        logMessage(`Ignored malformed OANDA stream line: ${(error as Error).message}`, undefined, { level: "warn", fileName: "priceStream" });
      }
    }
  } catch (error) {
    if (!state.stopped && (error as Error).name !== "AbortError") {
      logMessage(`Shared price stream interrupted: ${(error as Error).message}`, undefined, { level: "warn", fileName: "priceStream" });
      scheduleReconnect(state);
    }
  } finally {
    state.reader = undefined;
    state.abort = undefined;
  }
};

export const startCombinedPriceStream = (symbols: string[], mode: Mode = getLoginMode()) => {
  const uniqueSymbols = [...new Set(symbols.map(normalizePairKeyUnderscore))].sort();
  const key = `${mode}:stream:${uniqueSymbols.join(',')}`;
  if (streams.has(key)) return;
  const state: StreamState = {
    symbols: uniqueSymbols, mode, decoder: new TextDecoder(), carry: "", lastMessageAt: Date.now(), reconnectAttempt: 0, stopped: false,
  };
  state.healthTimer = setInterval(() => {
    if (!state.reader || Date.now() - state.lastMessageAt <= STREAM_MESSAGE_TIMEOUT_MS) return;
    logMessage(`Shared price stream heartbeat is stale; reconnecting.`, undefined, { level: "warn", fileName: "priceStream" });
    void state.reader.cancel().catch(() => undefined);
  }, 5_000);
  streams.set(key, state);
  void connect(state);
};

export const startPriceStream = (symbol: string, mode: Mode = getLoginMode()) => startCombinedPriceStream([symbol], mode);

export const initializePriceStreams = async (symbols: string[], mode: Mode = getLoginMode()) => {
  startCombinedPriceStream(symbols, mode);
};

export const isStreamInitialized = (symbol: string, mode: Mode = getLoginMode()) =>
  [...streams.values()].some(state => state.mode === mode && state.symbols.includes(normalizePairKeyUnderscore(symbol)));

export const stopPriceStream = async (symbol: string, mode: Mode = getLoginMode()) => {
  const entry = [...streams.entries()].find(([, candidate]) => candidate.mode === mode && candidate.symbols.includes(normalizePairKeyUnderscore(symbol)));
  const key = entry?.[0];
  const state = entry?.[1];
  if (!state) return;
  state.stopped = true;
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  if (state.healthTimer) clearInterval(state.healthTimer);
  state.abort?.abort();
  await state.reader?.cancel().catch(() => undefined);
  if (key) streams.delete(key);
};

export const stopAllStreams = async () => {
  await Promise.all([...streams.values()].map(state => stopPriceStream(state.symbols[0], state.mode)));
};

export const getLatestQuote = (symbol: string, mode: Mode = getLoginMode(), maxAgeMs = STREAM_QUOTE_MAX_AGE_MS): OandaQuote | null => {
  const quote = priceCache.get(cacheKey(symbol, mode));
  if (!quote || !quote.tradeable || Date.now() - quote.receivedAt > maxAgeMs) return null;
  return quote;
};

export const waitForFreshPrice = async (symbol: string, mode: Mode = getLoginMode(), timeoutMs = 5_000): Promise<OandaQuote | null> => {
  if (!isStreamInitialized(symbol, mode)) startPriceStream(symbol, mode);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const quote = getLatestQuote(symbol, mode);
    if (quote) return quote;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return null;
};

export const fetchPriceOnce = async (symbol: string, mode: Mode = getLoginMode()): Promise<OandaQuote | null> => {
  const hubUrl = typeof process !== 'undefined' ? process.env.OANDA_MARKET_DATA_HUB_URL : undefined;
  if (hubUrl) {
    try {
      const response = await fetch(`${hubUrl}/quote?instrument=${encodeURIComponent(normalizePairKeyUnderscore(symbol))}`, {
        signal: AbortSignal.timeout(1_500),
        headers: { Accept: 'application/json' },
      });
      if (response.ok) return await response.json() as OandaQuote;
    } catch {
      // The worker falls through to direct OANDA REST pricing if the local hub is unavailable.
    }
  }
  const streamed = getLatestQuote(symbol, mode);
  if (streamed) return streamed;

  const norm = normalizePairKeyUnderscore(symbol);
  const { restHost, accountId, token } = getAccountDetails(mode);
  try {
    const response = await fetch(`${restHost}/v3/accounts/${accountId}/pricing?instruments=${norm}`, {
      signal: AbortSignal.timeout(5_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const price = (await response.json())?.prices?.[0];
    const bid = price?.bids?.[0]?.price;
    const ask = price?.asks?.[0]?.price;
    if (!bid || !ask || !price.time || price.tradeable === false) return null;
    const quote: OandaQuote = { bid, ask, oandaTime: price.time, receivedAt: Date.now(), tradeable: true, source: "rest" };
    priceCache.set(cacheKey(symbol, mode), quote);
    return quote;
  } catch (error) {
    logMessage(`Price unavailable for ${norm}: ${(error as Error).message}`, undefined, { level: "warn", fileName: "priceStream" });
    return null;
  }
};

/** Compatibility wrapper. Prefer getLatestQuote so stale data is represented as null. */
export const getLatestPrice = (symbol: string, mode: Mode = getLoginMode()) => {
  const quote = getLatestQuote(symbol, mode);
  return quote ? { bid: quote.bid, ask: quote.ask } : { bid: "0", ask: "0" };
};

// Retained for the legacy strategy. Goldilocks uses OANDA-completed REST candles.
export const streamToCandles = async (symbol: string, tf: string, maxCandles = 10) => {
  const durationMs = tfToMs(tf);
  startPriceStream(symbol);
  await waitForFreshPrice(symbol);
  const candles: any[] = [];
  let current: any;
  while (candles.length < maxCandles) {
    const quote = getLatestQuote(symbol);
    if (!quote) { await new Promise(resolve => setTimeout(resolve, 50)); continue; }
    const mid = (Number(quote.bid) + Number(quote.ask)) / 2;
    const tickTime = Date.parse(quote.oandaTime);
    const start = Math.floor(tickTime / durationMs) * durationMs;
    if (!current || current.time !== new Date(start).toISOString()) {
      if (current) { current.complete = true; candles.push(current); }
      current = { time: new Date(start).toISOString(), mid: { o: mid, h: mid, l: mid, c: mid }, volume: 0, complete: false };
    }
    current.mid.h = Math.max(current.mid.h, mid);
    current.mid.l = Math.min(current.mid.l, mid);
    current.mid.c = mid;
    current.volume += 1;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return { instrument: normalizePairKeyUnderscore(symbol), granularity: tf, candles };
};

export const killStreamByPair = stopPriceStream;
