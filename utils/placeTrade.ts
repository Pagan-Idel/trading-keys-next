import { ACTION, order, TYPE } from "./oanda/api/order";
import { logMessage } from "./logger";
import { openNow } from "./oanda/api/openNow";
import { wait, getPrecision } from "./shared";

export interface TradeSignal {
  pair: string;
  action: ACTION;
  entryPrice?: number;
  stopLoss: number;
  takeProfit: number;
  risk?: number; // Optional risk percentage, default is .25%
}

export interface TradeStartInfo {
  tradeId: string;
  slPrice: number;
  tpPrice: number;
  orderSide: "BUY" | "SELL";
  openPrice: number;
  pair: string;
}

const RISK_PERCENT = .25; // Default risk percentage 
/**
 * Executes a trade using a predefined strategy signal.
 * Returns trade info to start TradeManager externally if successful.
 */
export const placeTrade = async (signal: TradeSignal): Promise<TradeStartInfo | null> => {
  const { pair, action, stopLoss, takeProfit } = signal;

  const precision = getPrecision(pair);

  const formattedSL = stopLoss.toFixed(precision);
  const formattedTP = takeProfit.toFixed(precision);

  logMessage(`📥 Executing ${action} on ${pair} | SL: ${formattedSL} | TP: ${formattedTP}`, undefined, { fileName: "placeTrade", pair });

  const success = await order({
    pair,
    action,
    risk: signal.risk ?? RISK_PERCENT,
    orderType: TYPE.MARKET,
    stopLoss: formattedSL,
    takeProfit: formattedTP,
  });

  if (!success) {
    logMessage(`❌ Trade failed for ${pair}`, undefined, { fileName: "placeTrade", pair });
    return null;
  }

  logMessage(`✅ Trade placed successfully for ${pair}`, undefined, { fileName: "placeTrade", pair });

  let trade;
  for (let attempt = 0; attempt < 3; attempt++) {
    const tradeInfo = await openNow(pair);

    logMessage(`🔄 Retry #${attempt + 1} — openNow result:`, tradeInfo, {
      fileName: "placeTrade",
      pair,
    });

    const maybeTrade = tradeInfo?.trades?.[0];

    if (!maybeTrade) {
      logMessage(`⚠️ No trades returned in openNow() attempt ${attempt + 1}`, undefined, {
        fileName: "placeTrade",
        pair,
      });
    }

    if (maybeTrade?.id && maybeTrade?.price) {
      trade = maybeTrade;
      logMessage(`✅ Found trade ID: ${trade.id} | Open price: ${trade.price}`, undefined, {
        fileName: "placeTrade",
        pair,
      });
      break;
    }

    await wait(1000);
  }

  if (!trade) {
    logMessage(`❌ Could not resolve trade info after 3 retries.`, undefined, {
      fileName: "placeTrade",
      pair,
      level: "error",
    });
    return null;
  }

  // ✅ Final return after successful trade match
  return {
    tradeId: trade.id!,
    slPrice: parseFloat(trade.stopLossOrder?.price ?? "0"),
    tpPrice: parseFloat(trade.takeProfitOrder?.price ?? "0"),
    orderSide: parseFloat(trade.currentUnits || "0") > 0 ? "BUY" : "SELL",
    openPrice: parseFloat(trade.price!),
    pair,
  };
};
