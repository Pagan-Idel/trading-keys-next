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

// Helper function to safely access localStorage on the client side
const getLocalStorageItem = (key: string): string | null => {
  if (typeof window !== "undefined") {
    return localStorage.getItem(key);
  }
  return null;
};

export const openNow = async (): Promise<OpenTrade | undefined> => {
  const accountType = getLocalStorageItem('accountType');
  let hostname = accountType === 'live' 
    ? 'https://api-fxtrade.oanda.com' 
    : 'https://api-fxpractice.oanda.com';
  
  const accountId = accountType === 'live' 
    ? credentials.NEXT_PUBLIC_OANDA_LIVE_ACCOUNT_ID 
    : credentials.NEXT_PUBLIC_OANDA_DEMO_ACCOUNT_ID;
  
  const token = accountType === 'live' 
    ? credentials.NEXT_PUBLIC_OANDA_LIVE_ACCOUNT_TOKEN 
    : credentials.NEXT_PUBLIC_OANDA_DEMO_ACCOUNT_TOKEN;

  // Check if the credentials are set
  if (!accountId || !token || !hostname) {
    logToFileAsync("Token or AccountId is not set.");
    return undefined;
  }

  const apiUrl = `${hostname}/v3/accounts/${accountId}/openTrades`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      logToFileAsync(`HTTP error! Status: ${response.status}`);
      return undefined;
    }

    const responseData: OpenTrade = await response.json();
    logToFileAsync("Open Trades Response", responseData);

    return responseData;
  } catch (error: unknown) {
    if (error instanceof Error) {
      logToFileAsync('Error fetching open trades:', error.message);
    } else {
      logToFileAsync('Unknown error occurred while fetching open trades');
    }
    return undefined;
  }
};
