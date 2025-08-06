import { logMessage } from "../../logger";
import credentials from "../../../credentials.json" with { type: "json"};
import { loginMode } from '../../../utils/loginMode';
import { log } from "console";
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

const getLocalStorageItem = (key: string): string | null => {
  if (typeof window !== "undefined") {
    return localStorage.getItem(key);
  }
  return null;
};

export const openNow = async (
  pair?: string
): Promise<OpenTrade | undefined> => {
  // logMessage("🔍 openNow.ts file loaded", undefined, { fileName: "openNow", pair });
  const accountType = getLocalStorageItem("accountType") || loginMode;
  const hostname =
    accountType === "live"
      ? "https://api-fxtrade.oanda.com"
      : "https://api-fxpractice.oanda.com";

  const accountId =
    accountType === "live"
      ? credentials.OANDA_LIVE_ACCOUNT_ID
      : credentials.OANDA_DEMO_ACCOUNT_ID;

  const token =
    accountType === "live"
      ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
      : credentials.OANDA_DEMO_ACCOUNT_TOKEN;

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

    const responseData: OpenTrade = await response.json();

    // ✅ If input is specified, determine if it's a tradeId or pair
    if (pair) {
      
      const isTradeId = /^\d+$/.test(pair); // simple check: all digits = trade ID
      const filteredTrades = responseData.trades.filter((t) =>
        //@ts-ignore
        isTradeId ? t.id === String(pair) : normalizePairKeyUnderscore(t.instrument) === normalizePairKeyUnderscore(pair)
      );

      const matchLabel = isTradeId ? `for tradeId ${pair}` : `for ${pair}`;

      // logMessage(
      //   `🔍 Found ${filteredTrades.length} open trades ${matchLabel}` +
      //   (filteredTrades.length > 0 ? ` - latest tradeId: ${filteredTrades[0].id}` : ''),
      //   undefined,
      //   { fileName: "openNow", pair }
      // );

      return {
        lastTransactionID: responseData.lastTransactionID,
        trades: filteredTrades,
      };
    }

    return responseData;
  } catch (error) {
    logMessage("❌ Error fetching open trades", undefined, { fileName: "openNow", pair });
    return undefined;
  }
};
