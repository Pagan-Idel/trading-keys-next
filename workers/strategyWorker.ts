import { fetchCandles } from "../utils/oanda/api/fetchCandles.ts";
import { determineSwingPoints, type Candle as SwingCandle, type SwingResult } from "../utils/swingLabeler.ts";
import { placeTrade } from "../utils/placeTrade.ts";
import { openNow } from "../utils/oanda/api/openNow.ts";
import { logMessage } from "../utils/automationLogger.ts";
import { ACTION } from "../utils/oanda/api/order.ts";
import { wait, normalizePairKeyUnderscore, logSwingSummary, tfToMs } from "../utils/shared.ts";
import { isEngulfed } from "../utils/isEngulfed.ts";
import { throttleConnection } from "../utils/throttleConnections.ts";
import { TradeManager } from "../utils/trade-manager.ts";
import type { TradeSignal } from "../utils/placeTrade.ts";
import { fetchPriceOnce } from "../utils/oanda/api/priceStreamManager.ts";
import { isTradeSessionOpen } from "../utils/sessionUtils.ts";
import { getTradeDetailsById } from "../utils/oanda/api/getTradeDetails.ts";
import { saveTradeRecord } from "../utils/tradeHistory.ts";
import { setLoginMode } from "../utils/loginState.ts";
import { clearActiveTrade, setActiveTrade, updateWorkerStatus } from "../utils/automationStore.ts";
import { evaluateSpread } from "../utils/spreadGuard.ts";

const OUTER_TF = "M1";
const HIGHER_TF = "H1";
const MAX_CACHE = 30000;
const RISK_TO_REWARD = 1.25;
const SWING_TOLERANCE = 0.1;
const CANDLES_TO_FETCH = 5000;
const RISK_PERCENTAGE = 3;

const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const mode = modeArg?.split("=")[1] === "live" ? "live" : "demo";
setLoginMode(mode);

let killed = false;

process.on('SIGINT', () => killed = true);
process.on('SIGTERM', () => killed = true);

export function isKilled() {
  return killed;
}

let lastOuterSwing: { a: any; b: any } | null = null;

export const waitForTfStartPlusDelay = async (tf: string, delayMs = 5000) => {
  const tfMs = tfToMs(tf);
  const now = Date.now();
  const waitTime = tfMs - (now % tfMs) + delayMs;
  const seconds = Math.floor(waitTime / 1000);
  const nowFormatted = new Date(now).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "America/Chicago",
  });
  // logMessage(`ðŸ•’ Now time: ${nowFormatted}`, undefined, { fileName: "strategy" });
  // logMessage(`â³ Waiting ${seconds}s for next TF start + ${delayMs}ms...`, undefined, { level: "info", fileName: "strategy" });
  await wait(waitTime);
};

const candlesCache: Record<string, Record<string, SwingCandle[]>> = {
  [OUTER_TF]: {},
  [HIGHER_TF]: {},
};

const fetchAndUpdateCache = async (pair: string, tf: string): Promise<SwingCandle[]> => {
  const normPair = normalizePairKeyUnderscore(pair);
  const cache = candlesCache[tf][normPair] || [];
  const newCandles = await fetchCandles(pair, tf, CANDLES_TO_FETCH);
  // newCandles.forEach((c, i) => {
  //   logMessage(`[Candle ${i}] Time: ${toLocalTime(c.time)} | High: ${c.high} | Low: ${c.low}`, undefined, {
  //     level: "debug",
  //     fileName: "candles", pair,
  //   });
  // });
  const parsedNew = newCandles.filter((c) => !cache.some((x) => x.time === c.time));
  const updated = [...cache, ...parsedNew].slice(-MAX_CACHE);
  updated.forEach((c, i) => (c.candleIndex = i));
  candlesCache[tf][normPair] = updated;
  return updated;
};

const checkHigherTFBias = async (
  pair: string,
  livePrice: number,
  innerDirection: "BUY" | "SELL"
): Promise<boolean> => {
  const candles = await fetchAndUpdateCache(pair, HIGHER_TF);
  const swings = determineSwingPoints(candles);
  logSwingSummary(swings, HIGHER_TF, true, pair);

  for (let i = swings.length - 2; i >= 0; i--) {
    const a = swings[i];
    const b = swings[i + 1];
    const valid =
      (a.swing === "HL" && b.swing === "HH") ||
      (a.swing === "LL" && b.swing === "HH") ||
      (a.swing === "LH" && b.swing === "LL") ||
      (a.swing === "HH" && b.swing === "LL");
    if (!valid) continue;

    const direction = b.swing === "HH" ? "BUY" : "SELL";
    const min = Math.min(a.price, b.price);
    const max = Math.max(a.price, b.price);
    const mid = min + (max - min) / 2;
    const indexB = candles.findIndex(c => c.time === b.time);
    const futureCandles = candles.slice(indexB + 1);

    let crossedMid = false;
    if (direction === "BUY") {
      crossedMid = futureCandles.some(c => c.low <= mid);
    } else {
      crossedMid = futureCandles.some(c => c.high >= mid);
    }

    const aboveMid = livePrice >= mid;
    let expectedDirection: "BUY" | "SELL";

    if (!crossedMid) {
      // âŒ Not crossed yet â†’ flipped logic
      expectedDirection =
        direction === "BUY" && aboveMid ? "SELL" :
          direction === "SELL" && !aboveMid ? "BUY" :
            direction;
    } else {
      // âœ… Already crossed â†’ normal logic
      expectedDirection = direction;
    }

    const allowed = innerDirection === expectedDirection;

    logMessage(
      `ðŸ“Š Higher TF Bias Check | A: ${a.swing} @ ${a.price}, B: ${b.swing} @ ${b.price} | Mid: ${mid} | Price: ${livePrice} | CrossedMid: ${crossedMid} | Expected 1M: ${expectedDirection} | Got: ${innerDirection} | âœ… ${allowed}`,
      undefined,
      { fileName: "swing", pair }
    );

    return allowed;
  }

  return false;
};

const monitorOuterSwing = async (pair: string) => {
  const outerCandles = await fetchAndUpdateCache(pair, OUTER_TF);
  const swings = determineSwingPoints(outerCandles);
  logSwingSummary(swings, OUTER_TF, true, pair);

  const swingRanges: number[] = [];
  let lastValidPair: { a: SwingResult; b: SwingResult } | null = null;

  for (let i = 0; i < swings.length - 1; i++) {
    const a = swings[i];
    const b = swings[i + 1];
    if (
      (a.swing === "LL" && b.swing === "HH") ||
      (a.swing === "HL" && b.swing === "HH") ||
      (a.swing === "HH" && b.swing === "LL") ||
      (a.swing === "LH" && b.swing === "LL")
    ) {
      swingRanges.push(Math.abs(a.price - b.price));
      lastValidPair = { a, b };
    }
  }

  const last = swings.at(-1);
  if (!last || !lastValidPair || swingRanges.length < 2) return null;

  const avg = swingRanges.reduce((a, b) => a + b, 0) / swingRanges.length;
  const range = swingRanges.at(-1)!;

  const isFirstRun = !lastOuterSwing;
  const isNewSwing = !isFirstRun && (lastOuterSwing?.b.price !== last?.price || lastOuterSwing?.b.swing !== last?.swing);

  logMessage(
    isFirstRun ? `ðŸ” Initial Outer Swing: ${last?.swing}` :
      isNewSwing ? `ðŸ§ New Outer Swing Detected: ${last?.swing}` :
        `â¸ï¸ Outer Swing unchanged.`,
    undefined,
    { fileName: "strategy", pair }
  );

  lastOuterSwing = { a: lastValidPair.a, b: lastValidPair.b };
  logMessage(`ðŸ“Š Range = ${range} | Avg = ${avg}`, undefined, { fileName: "strategy", pair });

  // Only accept swing ranges within Â±30% of average
  const minAllowed = avg * (1 - SWING_TOLERANCE);
  // currently not using maxAllowed, but can be added if needed
  const maxAllowed = avg * (1 + SWING_TOLERANCE);
  if (range < minAllowed) {
    logMessage(
      `ðŸ”• Skipping swing. Range ${range} is outside of allowed range (${minAllowed}})`,
      undefined,
      { fileName: "strategy", pair }
    );
    return null;
  }

  const direction = last.swing === "HH" ? ACTION.BUY : ACTION.SELL;
  return { a: lastValidPair.a, b: lastValidPair.b, direction };
};

const runStrategy = async () => {
  const pair = process.argv[2];
  if (!pair) {
    console.error("âŒ No pair provided");
    process.exit(1);
  }

  await throttleConnection(1000);
  updateWorkerStatus(pair, "starting", "initializing", "Initializing strategy worker", mode);
  logMessage(`â³ Initializing strategy for pair: ${pair}`, undefined, { fileName: "strategy", pair });

  const manager = TradeManager.getInstance();

  while (true) {
    const open = await openNow(pair);
    const exists = open?.trades?.some(
      (t) => Boolean(t.instrument) && normalizePairKeyUnderscore(t.instrument!) === normalizePairKeyUnderscore(pair)
    );
    const tfMs = tfToMs(OUTER_TF);

    if (exists) {
      const existingTrade = open?.trades?.find(
        (trade) => Boolean(trade.instrument) && normalizePairKeyUnderscore(trade.instrument!) === normalizePairKeyUnderscore(pair),
      );
      if (existingTrade?.id) {
        setActiveTrade({
          tradeId: existingTrade.id,
          pair,
          direction: Number(existingTrade.currentUnits ?? 0) >= 0 ? "BUY" : "SELL",
          entry: Number(existingTrade.price),
          stopLoss: Number(existingTrade.stopLossOrder?.price) || undefined,
          takeProfit: Number(existingTrade.takeProfitOrder?.price) || undefined,
          mode,
        });
      }
      if (manager.tradeIntervals.has(pair)) {
        logMessage(`â›” TradeManager already running for ${pair}, skipping resume`, undefined, {
          fileName: "strategy",
          pair,
        });
        break;
      }

      logMessage(`â™»ï¸ Resuming manager for ${pair}`, undefined, {
        fileName: "strategy",
        pair,
      });

      await manager.resumeFromOpenTrades(pair);
      await wait(tfMs);
    } else {
      clearActiveTrade(pair);
      logMessage(`âœ… No open trades found for ${pair} â€” exiting resume loop`, undefined, {
        fileName: "strategy",
        pair,
      });
      break;
    }
  }

  while (true) {
    try {
      if (isKilled()) {
        updateWorkerStatus(pair, "stopped", "terminated", "Worker received a stop signal", mode);
        logMessage(`ðŸ›‘ Strategy terminated for ${pair}`, undefined, { fileName: "strategy", pair });
        return;
      }

      if (!isTradeSessionOpen(pair)) {
        updateWorkerStatus(pair, "paused", "session_closed", "Trading session is closed", mode);
        logMessage(`ðŸ•’ Session closed for ${pair}`, undefined, { fileName: "strategy", pair });
        return;
      }

      const open = await openNow(pair);
      const exists = open?.trades?.some((t) => Boolean(t.instrument) && normalizePairKeyUnderscore(t.instrument!) === normalizePairKeyUnderscore(pair));
      if (exists) {
        updateWorkerStatus(pair, "in_trade", "managing_trade", "An existing trade is being managed", mode);
        logMessage("ðŸ›‘ Trade already open. Restarting over...", undefined, { fileName: "strategy", pair });
        await waitForTfStartPlusDelay(OUTER_TF, 5000);
        continue;
      }
      clearActiveTrade(pair);

      updateWorkerStatus(pair, "scanning", "scanning_swings", "Scanning candles for a valid swing structure", mode);
      const outer = await monitorOuterSwing(pair);
      if (!outer) {
        updateWorkerStatus(pair, "waiting", "waiting_for_swing", "No qualifying M1 swing structure yet. Waiting for the next completed candle.", mode);
        logMessage("â¸ï¸ No valid outer swing or range too small. Restarting over...", undefined, { fileName: "strategy", pair });
        await waitForTfStartPlusDelay(OUTER_TF, 5000);
        continue;
      }

      const { a: prev, b: last, direction } = outer;
      const sl = prev.price;
      const tp = last.price;
      const range = Math.abs(prev.price - last.price);
      const zoneRange = range * (1 / (RISK_TO_REWARD + 1));
      const rrHigh = direction === ACTION.BUY ? prev.price + zoneRange : prev.price;
      const rrLow = direction === ACTION.BUY ? prev.price : prev.price - zoneRange;
      logMessage(`ðŸ“€ RR Zone -> rrLow: ${rrLow}, rrHigh: ${rrHigh}`, undefined, { fileName: "strategy", pair });

      const livePrice = await fetchPriceOnce(pair);
      if (!livePrice?.bid || !livePrice?.ask) {
        logMessage(`âŒ Failed to fetch live price for spread buffer`, undefined, { fileName: "strategy", pair });
        continue;
      }

      const priceToCheck = direction === ACTION.BUY ? parseFloat(livePrice.ask) : parseFloat(livePrice.bid);
      updateWorkerStatus(pair, "scanning", "checking_higher_timeframe", `Checking H1 bias for ${direction}`, mode);
      const isBiasAllowed = await checkHigherTFBias(pair, priceToCheck, direction);
      if (!isBiasAllowed) {
        updateWorkerStatus(pair, "waiting", "bias_rejected", `${direction} setup rejected because it conflicts with the H1 market bias.`, mode);
        logMessage(`âš ï¸ Rejected by Higher TF Bias Filter â€” 1M direction: ${direction} is not valid under current 1H structure`, undefined, {
          fileName: "strategy",
          pair,
        });
        await waitForTfStartPlusDelay(OUTER_TF, 5000);
        continue;
      }


      updateWorkerStatus(pair, "waiting", "waiting_for_engulfing", `Waiting for ${direction} engulfing confirmation`, mode);
      const engulfed = await isEngulfed(pair, OUTER_TF, direction, { a: prev, b: last }, rrLow, rrHigh, isKilled);
      if (!engulfed) {
        logMessage(`â³ Engulfing not found. Restarting over...`, undefined, { fileName: "strategy", pair });
        await waitForTfStartPlusDelay(OUTER_TF, 5000);
        continue;
      }

      const executionQuote = await fetchPriceOnce(pair, mode);
      if (!executionQuote?.bid || !executionQuote?.ask) {
        updateWorkerStatus(pair, "waiting", "spread_rejected", "Trade rejected because a fresh bid/ask quote was unavailable.", mode);
        logMessage(`Spread guard rejected setup: no fresh bid/ask quote.`, undefined, { level: "warn", fileName: "strategy", pair });
        continue;
      }
      const spreadCheck = evaluateSpread(pair, Number(executionQuote.bid), Number(executionQuote.ask));
      const rawSpread = spreadCheck.rawSpread;
      const maxBuffer = spreadCheck.maxSpread;
      if (!spreadCheck.allowed) {
        updateWorkerStatus(pair, "waiting", "spread_rejected", spreadCheck.reason, mode);
        logMessage(`Spread rejected | raw=${rawSpread} | maximum=${maxBuffer}. Trade setup skipped.`, undefined, { level: "warn", fileName: "strategy", pair });
        await waitForTfStartPlusDelay(OUTER_TF, 5000);
        continue;
      }
      logMessage(`Spread pre-check passed | ${spreadCheck.spreadPips.toFixed(2)} pips. Final quote will be checked at submission.`, undefined, { fileName: "strategy", pair });

      const signal: TradeSignal = {
        pair,
        action: direction,
        stopLoss: sl,
        takeProfit: tp,
        risk: RISK_PERCENTAGE
      };

      updateWorkerStatus(pair, "scanning", "placing_trade", `Submitting ${direction} order`, mode);
      const tradeInfo = await placeTrade(signal, mode);
      if (!tradeInfo) continue;

      const journalData = {
        swingA: prev,
        swingB: last,
        direction,
        range,
        rrZone: { low: rrLow, high: rrHigh },
        spread: {
          bid: String(tradeInfo.spread.bid),
          ask: String(tradeInfo.spread.ask),
          raw: tradeInfo.spread.rawSpread,
          buffer: tradeInfo.spread.buffer,
          pipSize: tradeInfo.spread.pipSize,
        },
        tf: OUTER_TF,
        timestamp: new Date().toISOString(),
      };

      manager.start(
        tradeInfo.slPrice,
        tradeInfo.tpPrice,
        tradeInfo.orderSide,
        tradeInfo.openPrice,
        tradeInfo.pair
      );
      setActiveTrade({
        tradeId: tradeInfo.tradeId,
        pair: tradeInfo.pair,
        direction: tradeInfo.orderSide,
        entry: tradeInfo.openPrice,
        stopLoss: tradeInfo.slPrice,
        takeProfit: tradeInfo.tpPrice,
        mode,
      });
      updateWorkerStatus(pair, "in_trade", "trade_open", `${direction} trade is open and being managed`, mode);

      logMessage(`â³ Waiting for ${pair} trade to close...`, undefined, { fileName: "strategy", pair });

      while (true) {
        const stillOpen = (await openNow(pair))?.trades?.some(
          (t) => Boolean(t.instrument) && normalizePairKeyUnderscore(t.instrument!) === normalizePairKeyUnderscore(pair)
        );
        if (!stillOpen) break;
        await wait(5000);
      }

      logMessage(`âœ… ${pair} trade closed`, undefined, { fileName: "strategy", pair });
      clearActiveTrade(pair);
      updateWorkerStatus(pair, "scanning", "trade_closed", "Trade closed; scanning will resume", mode);

      const details = await getTradeDetailsById(tradeInfo.tradeId);
      const realizedPL = details?.realizedPL || undefined;
      const outcome = realizedPL && parseFloat(realizedPL) > 0 ? "WIN" : "LOSS";

      await saveTradeRecord(
        tradeInfo.tradeId,
        tradeInfo.pair,
        tradeInfo.openPrice,
        tradeInfo.slPrice,
        tradeInfo.tpPrice,
        tradeInfo.orderSide,
        journalData,
        outcome,
        realizedPL
      );

    } catch (err) {
      updateWorkerStatus(pair, "error", "error", (err as Error).message, mode);
      logMessage(`âŒ Error: ${(err as Error).message}`, undefined, { fileName: "strategy", pair });
    }

    await waitForTfStartPlusDelay(OUTER_TF, 5000);
  }
};

runStrategy();
