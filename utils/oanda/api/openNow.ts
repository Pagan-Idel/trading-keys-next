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

export const openNow = async (): Promise<OpenTrade | undefined> => {
  const accountType = localStorage.getItem('accountType');
  let hostname = accountType === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
  const accountId = accountType === 'live' ? credentials.NEXT_PUBLIC_OANDA_LIVE_ACCOUNT_ID : credentials.NEXT_PUBLIC_OANDA_DEMO_ACCOUNT_ID;
  const token = accountType === 'live' ? credentials.NEXT_PUBLIC_OANDA_LIVE_ACCOUNT_TOKEN : credentials.NEXT_PUBLIC_OANDA_DEMO_ACCOUNT_TOKEN;
  // Check if the environment variable is set
  if (!accountId || !token || !hostname) {
    logToFileAsync("Token or AccountId is not set.");
    // You might want to handle this case differently, e.g., throw an error or return a specific value
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
      // Handle error responses, e.g., throw an error or return a specific value
      console.error(`Error: ${response.status} - ${response.statusText}`);
      // You might want to throw an error or return a specific value here
    }

    const responseData: OpenTrade = await response.json();

    // Assuming the API response structure matches the OpenTrades interface
    return responseData;
  } catch (error) {
    console.error('Error fetching open trades:', error);
    // You might want to throw an error or return a specific value here
    return undefined;
  }
};
