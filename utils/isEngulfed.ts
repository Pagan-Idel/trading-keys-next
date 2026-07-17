import { fetchCandles } from "./oanda/api/fetchCandles.ts";
import { fetchLatestCandles } from "./oanda/api/fetchLatestCandles.ts";
import { isStrongBody, getAverageRange } from "./swingLabeler.ts";
import type { SwingResult } from "./swingLabeler.ts";
import { ACTION } from "./oanda/api/order.ts";
import { logMessage } from "./automationLogger.ts";
import { fetchPriceOnce, killStreamByPair, streamToCandles } from "../utils/oanda/api/priceStreamManager.ts";
import { toLocalTime, getPrecision } from "./shared.ts";
import { isTradeSessionOpen } from "./sessionUtils.ts";

export async function isEngulfed(
  pair: string,
  tf: string,
  direction: ACTION,
  swingPoints: { a: SwingResult; b: SwingResult },
  rangeLow: number,
  rangeHigh: number,
  shouldStop: () => boolean = () => false
): Promise<boolean> {
  const now = Date.now();
  const fromA = new Date(swingPoints.a.time || "").toISOString();
  const swingBTime = new Date(swingPoints.b.time || "").getTime();

  const nowFormatted = new Date(now).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  });

  logMessage(`ðŸ•’ Now time: ${nowFormatted}`);
  logMessage(`ðŸ“‰ swing a = ${swingPoints.a.swing} at ${swingPoints.a.price} at ${toLocalTime(swingPoints.a.time)}`, undefined, { fileName: "isEngulfed", pair });
  logMessage(`ðŸ“ˆ swing b = ${swingPoints.b.swing} at ${swingPoints.b.price} at ${toLocalTime(swingPoints.b.time)}`, undefined, { fileName: "isEngulfed", pair });
  logMessage(`ðŸ“ RR Zone = rrLow: ${rangeLow} â†’ rrHigh: ${rangeHigh}`, undefined, { fileName: "isEngulfed", pair });

  let baseCandle: any = null;

  while (true) {
    if (shouldStop()) {
      logMessage(`ðŸ›‘ isEngulfed exiting due to kill flag`, undefined, { fileName: 'isEngulfed', pair });
      return false;
    }

    if (!isTradeSessionOpen(pair)) {
      logMessage(`ðŸ›‘ Session closed. Exiting loop for ${pair}`, undefined, { fileName: "isEngulfed", pair });
      return false;
    }

    const avgCandles = await fetchCandles(pair, tf, undefined, fromA);
    const avgRange = getAverageRange(avgCandles);

    const { candles } = await streamToCandles(pair, tf, 1);
    const c = candles[0];
    if (!c) continue;

    // âœ… Map raw mid to rounded OHLC for viewing & logic
    const precision = getPrecision(pair);
    const round = (v: number) => Number(v.toFixed(precision));

    const o = round(c.mid?.o ?? 0);
    const h = round(c.mid?.h ?? 0);
    const l = round(c.mid?.l ?? 0);
    const cl = round(c.mid?.c ?? 0);

    if (!o || !h || !l || !cl) {
      logMessage(`âš ï¸ Skipping invalid candle for ${pair}`, undefined, { fileName: "isEngulfed", pair });
      continue;
    }

    // âœ… Assign to top-level fields for consistent usage
    c.open = o;
    c.high = h;
    c.low = l;
    c.close = cl;

    const cTime = new Date(c.time).getTime();
    const range = h - l;
    const formattedTime = toLocalTime(c.time);

    logMessage(
      `ðŸ•¯ï¸ Candle: [${formattedTime}] O:${o} H:${h} L:${l} C:${cl} Range: ${range.toFixed(5)} | Avg Range: ${avgRange.toFixed(5)}`,
      undefined,
      { fileName: "isEngulfed", pair }
    );

    const breached =
      (direction === ACTION.SELL && (h > swingPoints.a.price || l < swingPoints.b.price)) ||
      (direction === ACTION.BUY && (l < swingPoints.a.price || h > swingPoints.b.price));

    if (breached) {
      logMessage(
        `ðŸš« Price breached swing bounds â†’ New swing formed. Candle: [${l}, ${h}] at ${formattedTime}`,
        undefined,
        { fileName: "isEngulfed", pair }
      );
      return false;
    }

    const strong = isStrongBody(c, avgCandles);
    const inZone = l >= rangeLow && h <= rangeHigh;
    const afterSwingB = cTime > swingBTime;

    if (!strong || !inZone || !afterSwingB) continue;

    const bullish = cl > o;
    const bearish = cl < o;

    // ðŸŸ« BASE CANDLE LOGIC
    if ((direction === ACTION.BUY && bearish) || (direction === ACTION.SELL && bullish)) {
      if (!baseCandle) {
        baseCandle = { ...c };
        logMessage(
          `ðŸŸ¤ New base candle: [${formattedTime}] O:${o} H:${h} L:${l} C:${cl}`,
          undefined,
          { fileName: "isEngulfed", pair }
        );
      } else {
        const currentIsBetter =
          direction === ACTION.BUY ? l < baseCandle.low : h > baseCandle.high;
        if (currentIsBetter) baseCandle = { ...c };
      }

      logMessage(`ðŸŸ¤ Base candle updated: [${formattedTime}] O:${o} H:${h} L:${l} C:${cl}`, undefined, { fileName: "isEngulfed", pair });
      continue;
    }

    if (!baseCandle) continue;

    const testEngulf =
      direction === ACTION.BUY
        ? bullish && cl > baseCandle.high
        : bearish && cl < baseCandle.low;

    const testAfterBase = cTime > new Date(baseCandle.time).getTime();

    if (testEngulf && testAfterBase) {
      const strongTest = isStrongBody(c, avgCandles);
      if (!strongTest) {
        logMessage(`âŒ Test candle ${c.candleIndex} failed strong body check.`, undefined, { fileName: "isEngulfed", pair });
        continue;
      }

      const maxDelayMs = 4 * 60 * 1000;
      const testAge = Date.now() - cTime;
      if (testAge > maxDelayMs) {
        logMessage(
          `â° Test candle ${c.candleIndex} is too old (${Math.round(testAge / 1000)}s ago) â€” ` +
          `Time: ${toLocalTime(c.time)} | O:${c.open} H:${c.high} L:${c.low} C:${c.close}. Skipping.`,
          undefined,
          { fileName: "isEngulfed", pair }
        );
        continue;
      }

      logMessage(`âœ… Engulfing candle: [${formattedTime}] engulfed base [${toLocalTime(baseCandle.time)}]`, undefined, { fileName: "isEngulfed", pair });

      const livePrice = await fetchPriceOnce(pair);
      if (!livePrice?.bid || !livePrice?.ask) {
        logMessage(`âŒ Failed to receive live price from fetch.`, undefined, { fileName: "isEngulfed", pair });
        continue;
      }

      const entry = direction === ACTION.BUY ? Number(livePrice.ask) : Number(livePrice.bid);
      logMessage(`ðŸ”Ž Final price check (${direction}): ${entry}`, undefined, { fileName: "isEngulfed", pair });

      if (entry < rangeLow || entry > rangeHigh) {
        logMessage(`âŒ Live price ${entry} not in RR zone. Not valid.`, undefined, { fileName: "isEngulfed", pair });
        continue;
      }

      killStreamByPair(pair);
      return true;
    }
  }
}
