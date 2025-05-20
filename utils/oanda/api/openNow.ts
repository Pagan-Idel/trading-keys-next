import { logToFileAsync } from "../../logger";
import credentials from "../../../credentials.json";

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
  const accountType = getLocalStorageItem("accountType");
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
    logToFileAsync("❌ Token or AccountId is not set.");
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
      console.error(`❌ Error: ${response.status} - ${response.statusText}`);
      return undefined;
    }

    const responseData: OpenTrade = await response.json();

    // ✅ If pair specified, filter the trades array
    if (pair) {
      const filteredTrades = responseData.trades.filter(
        (t) => t.instrument === pair
      );
      return {
        lastTransactionID: responseData.lastTransactionID,
        trades: filteredTrades,
      };
    }

    return responseData;
  } catch (error) {
    console.error("❌ Error fetching open trades:", error);
    return undefined;
  }
};
