import { openNow } from "./oanda/api/openNow.ts";
import { closeTrade } from "./oanda/api/closeTrade.ts";
import { ACTION } from "./oanda/api/order.ts";
import { logMessage } from "./automationLogger.ts";
import { getUSDHolidayDates } from "./shared.ts"; // reuse your holiday function

// âœ… Detect if we are inside 5 min of Friday close
export function isWeekendCloseWindow(): boolean {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();

  const dayOfWeek = now.getUTCDay();
  const daysSinceSunday = dayOfWeek;
  const fridayClose = new Date(Date.UTC(year, month, date - daysSinceSunday + 5, 21, 0, 0, 0));

  const diff = fridayClose.getTime() - now.getTime();
  return diff > 0 && diff <= 5 * 60 * 1000;
}

// âœ… Detect if today is a holiday
export function isHolidayCloseWindow(): boolean {
  const now = new Date();
  const todayKey = now.toISOString().split("T")[0];
  const { fullHolidays, partialHolidays } = getUSDHolidayDates(now.getFullYear());
  return fullHolidays.has(todayKey) || partialHolidays.has(todayKey);
}

// âœ… Close all open trades
export async function closeAllTrades(reason: string, mode: 'live' | 'demo') {
  try {
    const openTrades = await openNow(undefined, mode);
    if (!openTrades || !openTrades.trades.length) {
      logMessage(`âœ… No open trades to close (${reason}).`);
      return;
    }

    logMessage(`âš ï¸ Closing ${openTrades.trades.length} trades (${reason})...`);
    for (const trade of openTrades.trades) {
      if (trade.instrument) {
        await closeTrade({ action: ACTION.CLOSE, pair: trade.instrument }, trade.instrument, undefined, mode);
      }
    }

    logMessage(`âœ… All trades closed (${reason}).`);
  } catch (err) {
    logMessage(`âŒ Error closing trades (${reason}):`, err);
  }
}
