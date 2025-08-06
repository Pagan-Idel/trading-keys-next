// src/utils/oanda/api/close-partial.ts
import { logMessage } from "../../logger";
import { openNow } from "./openNow";
import { closeTrade } from "./closeTrade";
import type { TradeCloseResponse } from "./closeTrade";

export interface ErrorOandaResponse {
  errorMessage: string;
}
export const closeTradePartial = async (
  tradeId: string,
  unitsToClose: number,
  mode: 'live' | 'demo' = 'demo'
): Promise<TradeCloseResponse | ErrorOandaResponse> => {
  const openTrades = await openNow(undefined, mode);
  if (!openTrades || openTrades.trades.length === 0) {
    return { errorMessage: `No open trades available.` };
  }

  const trade = openTrades.trades.find(t => t.id === tradeId || t.clientExtensions?.id === tradeId);
  if (!trade) {
    return { errorMessage: `No trade found with ID ${tradeId}` };
  }

  const absUnits = Math.abs(parseFloat(trade.currentUnits || trade.initialUnits || "0"));
  if (absUnits <= 0) {
    return { errorMessage: "Trade has zero units." };
  }

  const direction = parseFloat(trade.currentUnits || "0") > 0 ? "BUY" : "SELL";
  const pair = trade.instrument;
  if (!pair) {
    return { errorMessage: "Trade instrument (pair) is undefined." };
  }

  if (unitsToClose <= 0 || unitsToClose > absUnits) {
    return { errorMessage: `Invalid unitsToClose: ${unitsToClose}` };
  }

  const result = await closeTrade({ action: "PartialClose50", pair }, pair, unitsToClose, mode);
  if (!result || typeof result === "boolean") {
    logMessage(`❌ Failed to close partial trade for ${pair} (Trade ID: ${tradeId})`, undefined, {
      level: "error",
      fileName: "close-partial"
    });
    return { errorMessage: "Failed to close partial trade." };
  }

  logMessage(`✅ Partial close of ${unitsToClose} units successful for ${pair} (Trade ID: ${tradeId})`, result, {
    level: "info",
    fileName: "close-partial"
  });

  return result;
};
