import { openNow } from "./oanda/api/openNow.ts";
import { closeTrade } from "./oanda/api/closeTrade.ts";
import { ACTION } from "./oanda/api/order.ts";
import { logMessage } from "./automationLogger.ts";
import { isForexHolidayAt, isForexWeekendEntryBlocked, isForexWeekendLiquidationWindow } from './forexMarketHours.ts';

export function isWeekendCloseWindow(now=new Date()): boolean {
  return isForexWeekendEntryBlocked(now);
}

export function isWeekendLiquidationWindow(now=new Date()): boolean {
  return isForexWeekendLiquidationWindow(now);
}

// âœ… Detect if today is a holiday
export function isHolidayCloseWindow(now=new Date()): boolean {
  return isForexHolidayAt(now);
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
