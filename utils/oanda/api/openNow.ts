import { logMessage } from "../../logger";
import { oandaReadRequest } from './request.ts';
import { getLoginMode } from "../../loginState";
import { normalizePairKeyUnderscore } from "../../shared";

export interface Price {
  priceValue: string;
}

export interface StopLossOrder {
  price: string;
}

export interface TakeProfitOrder {
  price: string;
}

export interface Trade {
  currentUnits?: string;
  financing?: string;
  id?: string;
  initialUnits?: string;
  instrument?: string;
  openTime?: string;
  price?: string;
  realizedPL?: string;
  state?: string;
  unrealizedPL?: string;
  clientExtensions?: {
    id?: string;
  };
  stopLossOrder?: StopLossOrder;
  takeProfitOrder?: TakeProfitOrder;
}

export interface OpenTrade {
  lastTransactionID: string;
  trades: Trade[];
}

export interface TradeById {
  lastTransactionID: string;
  trade: Trade;
}

export const openNow = async (
  pair?: string,
  mode: 'live' | 'demo' = getLoginMode(),
  signal?:AbortSignal,
): Promise<OpenTrade | undefined> => {
  try {
    const response = await oandaReadRequest({operation:'open_trades',endpointTemplate:'/v3/accounts/{account}/openTrades',mode,pair,signal,
      buildPath:({accountId})=>`/v3/accounts/${encodeURIComponent(accountId)}/openTrades`});

    const rawText = await response.text();
    let responseData: OpenTrade;
    try {
      responseData = JSON.parse(rawText);
    } catch (e) {
      logMessage(`❌ Failed to parse open trades response`, e, { fileName: "openNow", pair });
      return undefined;
    }

    if (pair) {
      const isTradeId = /^\d+$/.test(pair);
      const normalizedPair = normalizePairKeyUnderscore(pair);
      const filteredTrades = responseData.trades.filter((t) =>
        isTradeId
          ? t.id === String(pair)
          : normalizePairKeyUnderscore(t.instrument!) === normalizedPair
      );
      return {
        lastTransactionID: responseData.lastTransactionID,
        trades: filteredTrades,
      };
    }

    return responseData;
  } catch (error) {
    return undefined;
  }
};
