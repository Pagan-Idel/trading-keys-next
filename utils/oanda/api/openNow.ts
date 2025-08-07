import { logMessage } from "../../logger";
import credentials from "../../../credentials.json";
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
  mode: 'live' | 'demo' = 'demo'
): Promise<OpenTrade | undefined> => {
  const hostname =
    mode === "live"
      ? "https://api-fxtrade.oanda.com"
      : "https://api-fxpractice.oanda.com";

  const accountId =
    mode === "live"
      ? credentials.OANDA_LIVE_ACCOUNT_ID
      : credentials.OANDA_DEMO_ACCOUNT_ID;

  const token =
    mode === "live"
      ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
      : credentials.OANDA_DEMO_ACCOUNT_TOKEN;

  // logMessage(`🔎 openNow using accountId: ${accountId}, token: ${token?.slice(0,8)}..., hostname: ${hostname}, mode: ${mode}`, undefined, { fileName: "openNow", pair });

  if (!accountId || !token || !hostname) {
    logMessage("❌ Token or AccountId is not set.", undefined, { fileName: "openNow", pair });
    return undefined;
  }

  const apiUrl = `${hostname}/v3/accounts/${accountId}/openTrades`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      logMessage(`❌ Error fetching open trades: ${response.status} - ${response.statusText}`, undefined, { fileName: "openNow", pair });
      return undefined;
    }

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
    logMessage("❌ Error fetching open trades", error, { fileName: "openNow", pair });
    return undefined;
  }
};
