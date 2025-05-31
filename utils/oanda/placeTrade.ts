// src/strategy/logic/placeTrade.ts

import { ACTION, order, TYPE } from "../../utils/oanda/api/order.js";
import { logMessage  } from "../../utils/logger.js";
import { getPrecision } from "../../utils/shared.js";
import { TradeSignal } from "../determineStrategySignal.js";
import { openNow } from "../../utils/oanda/api/openNow.js";
import { TradeManager } from "../trade-managerMT.js";

/**
 * Executes a trade using a predefined strategy signal.
 * Risk is hardcoded at 0.25%.
 */
export const placeTrade = async (signal: TradeSignal): Promise<boolean> => {
  const { pair, action, entryPrice, stopLoss, takeProfit } = signal;

  const precision = getPrecision(pair);

  const formattedSL = stopLoss.toFixed(precision);
  const formattedTP = takeProfit.toFixed(precision);

  await logMessage (`📥 Executing ${action} on ${pair} | Entry: ${entryPrice} | SL: ${formattedSL} | TP: ${formattedTP}`);

  const success = await order({
    pair,
    action,
    risk: 0.25,
    orderType: TYPE.MARKET,
    stopLoss: formattedSL,
    takeProfit: formattedTP
  });

  if (success) {
    await logMessage (`✅ Trade placed successfully for ${pair}`);

    const tradeInfo = await openNow(pair);
    const trade = tradeInfo?.trades?.[0];

    if (trade?.id && trade.price) {
      const manager = TradeManager.getInstance();
      manager.start(
        trade.id,
        parseFloat(trade.stopLossOrder?.price ?? "0"),
        parseFloat(trade.takeProfitOrder?.price ?? "0"),
        action as "BUY" | "SELL",
        parseFloat(trade.price),
        pair
      );
    } else {
      await logMessage (`⚠️ Trade placed but could not find trade ID or price for ${pair}`);
    }

  } else {
    await logMessage (`❌ Trade failed for ${pair}`);
  }

  return success;
};
