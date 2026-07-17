import { ACTION, order, TYPE } from "./oanda/api/order";
import { logMessage } from "./automationLogger";
import { openNow } from "./oanda/api/openNow";
import { wait, getPrecision } from "./shared";
import { getLoginMode } from "./loginState";
import { fetchPriceOnce } from "./oanda/api/priceStreamManager";
import { applySpreadBuffer, calculateExactRiskRewardLevels, evaluateSpread, type SpreadCheck } from "./spreadGuard";

export interface TradeSignal {
  pair: string;
  action: ACTION;
  entryPrice?: number;
  stopLoss: number;
  takeProfit: number;
  risk?: number; // Optional risk percentage, default is .25%
  exactRewardRisk?: number;
}

export interface TradeStartInfo {
  tradeId: string;
  slPrice: number;
  tpPrice: number;
  orderSide: "BUY" | "SELL";
  openPrice: number;
  pair: string;
  spread: SpreadCheck;
}

const RISK_PERCENT = .25; // Default risk percentage 
/**
 * Executes a trade using a predefined strategy signal.
 * Returns trade info to start TradeManager externally if successful.
 */

export const placeTrade = async (signal: TradeSignal, mode: 'live' | 'demo' = getLoginMode()): Promise<TradeStartInfo | null> => {
  const { pair, action } = signal;

  const quote = await fetchPriceOnce(pair, mode);
  if (!quote?.bid || !quote?.ask) {
    logMessage(`Spread guard rejected ${pair}: no fresh bid/ask quote.`, undefined, { level: "warn", fileName: "placeTrade", pair });
    return null;
  }
  const spread = evaluateSpread(pair, Number(quote.bid), Number(quote.ask));
  if (!spread.allowed) {
    logMessage(`Spread guard rejected ${pair}: ${spread.reason}`, undefined, { level: "warn", fileName: "placeTrade", pair });
    return null;
  }
  const direction = action === ACTION.BUY ? 'BUY' : 'SELL';
  const executableEntry = direction === 'BUY' ? spread.ask : spread.bid;
  const exactLevels = signal.exactRewardRisk === undefined
    ? null
    : calculateExactRiskRewardLevels(direction, executableEntry, signal.stopLoss, signal.exactRewardRisk);
  if (signal.exactRewardRisk !== undefined && !exactLevels) {
    logMessage(`Entry rejected for ${pair}: live price is beyond the zone stop or the requested reward/risk is invalid.`, undefined, { level: "warn", fileName: "placeTrade", pair });
    return null;
  }
  const levels = exactLevels ?? applySpreadBuffer(direction, signal.stopLoss, signal.takeProfit, spread.buffer);
  const stopLoss = levels.stopLoss;
  const takeProfit = levels.takeProfit;

  const precision = getPrecision(pair);
  const formattedSL = stopLoss.toFixed(precision);
  const formattedTP = takeProfit.toFixed(precision);

  logMessage(
    exactLevels
      ? `Spread guard passed | ${spread.spreadPips.toFixed(2)} pips | Goldilocks SL remains at the zone edge and TP is ${signal.exactRewardRisk}R from live entry.`
      : `Spread guard passed | ${spread.spreadPips.toFixed(2)} pips | legacy buffer=${spread.buffer}`,
    undefined,
    { fileName: "placeTrade", pair },
  );

  logMessage(`📥 Executing ${action} on ${pair} | SL: ${formattedSL} | TP: ${formattedTP}`, undefined, { fileName: "placeTrade", pair });

  const orderResult = await order({
    pair,
    action,
    risk: signal.risk ?? RISK_PERCENT,
    orderType: TYPE.MARKET,
    stopLoss: formattedSL,
    takeProfit: formattedTP,
  }, mode);

  if (!orderResult.success) {
    logMessage(`❌ Trade failed for ${pair}`, undefined, { fileName: "placeTrade", pair });
    return null;
  }

  logMessage(`✅ Trade placed successfully for ${pair}`, undefined, { fileName: "placeTrade", pair });

  let trade;
  for (let attempt = 0; attempt < 3; attempt++) {
    const tradeInfo = await openNow(pair, mode);

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
    spread,
  };
};
