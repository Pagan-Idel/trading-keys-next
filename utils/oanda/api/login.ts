import { logToFileAsync } from "../../logger";
import credentials from "../../../credentials.json"; // Import credentials.json at the top

export interface Order {
  // Define the structure of an order if known
  id: string;
  units: string;
  instrument: string;
  price: string;
  time: string;
}

export interface Position {
  // Define the structure of a position if known
  instrument: string;
  units: string;
  side: 'BUY' | 'SELL';
}

export interface TradeLogin {
  // Define the structure of a TradeLogin if known
  id: string;
  instrument: string;
  price: string;
  units: string;
  realizedPL: string;
}

export interface Account {
  guaranteedStopLossOrderMode: string;
  hedgingEnabled: boolean;
  id: string;
  createdTime: string;
  currency: string;
  createdByUserID: number;
  alias: string;
  marginRate: string;
  lastTransactionID: string;
  balance: string;
  openTradeCount: number;
  openPositionCount: number;
  pendingOrderCount: number;
  pl: string;
  resettablePL: string;
  resettablePLTime: string;
  financing: string;
  commission: string;
  dividendAdjustment: string;
  guaranteedExecutionFees: string;
  orders: Order[];  // Replaced 'any[]' with 'Order[]' for stronger typing
  positions: Position[]; // Replaced 'any[]' with 'Position[]' for stronger typing
  trades: TradeLogin[]; // Replaced 'any[]' with 'TradeLogin[]' for stronger typing
  unrealizedPL: string;
  NAV: string;
  marginUsed: string;
  marginAvailable: string;
  positionValue: string;
  marginCloseoutUnrealizedPL: string;
  marginCloseoutNAV: string;
  marginCloseoutMarginUsed: string;
  marginCloseoutPositionValue: string;
  marginCloseoutPercent: string;
  withdrawalLimit: string;
  marginCallMarginUsed: string;
  marginCallPercent: string;
}

export interface AccountResponse {
  account: Account;
  lastTransactionID: string;
  errorMessage?: string; // Make this optional since it may not always be present
}

// Helper function to safely access localStorage on the client side
const getLocalStorageItem = (key: string): string | null => {
  if (typeof window !== "undefined") {
    return localStorage.getItem(key);
  }
  return null;
};

export const handleOandaLogin = async (): Promise<AccountResponse> => {
  const accountType = getLocalStorageItem('accountType');
  const hostname = accountType === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
  
  // Using credentials from credentials.json instead of process.env
  const accountId = accountType === 'live' ? credentials.NEXT_PUBLIC_OANDA_LIVE_ACCOUNT_ID : credentials.NEXT_PUBLIC_OANDA_DEMO_ACCOUNT_ID;
  const token = accountType === 'live' ? credentials.NEXT_PUBLIC_OANDA_LIVE_ACCOUNT_TOKEN : credentials.NEXT_PUBLIC_OANDA_DEMO_ACCOUNT_TOKEN;

  // Check if the credentials are set
  if (!token || !accountId) {
    logToFileAsync("Token or AccountId is not set.");
    throw new Error("Token or AccountId is not set.");
  }

  try {
    // Fetch all accounts
    const accountsApiUrl = `${hostname}/v3/accounts`;
    const accountsResponse: Response = await fetch(accountsApiUrl, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    const accountsResponseData: AccountResponse = await accountsResponse.json();
    logToFileAsync(accountsResponseData);

    if (!accountsResponse.ok) {
      logToFileAsync(`HTTP error when fetching accounts! Status: ${accountsResponse.status}`);
      throw new Error(`HTTP error when fetching accounts! Status: ${accountsResponse.status}`);
    }

    // Fetch account details for the specific account ID
    const accountDetailsApiUrl = `${hostname}/v3/accounts/${accountId}`;
    const accountDetailsResponse: Response = await fetch(accountDetailsApiUrl, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!accountDetailsResponse.ok) {
      logToFileAsync(`HTTP error when fetching account details! Status: ${accountDetailsResponse.status}`);
      throw new Error(`HTTP error when fetching account details! Status: ${accountDetailsResponse.status}`);
    }

    const accountDetailsResponseData: AccountResponse = await accountDetailsResponse.json();
    logToFileAsync(accountDetailsResponseData);

    return accountDetailsResponseData;
  } catch (error: unknown) {
    if (error instanceof Error) {
      logToFileAsync(`Error during OANDA login: ${error.message}`);
      throw error;
    } else {
      logToFileAsync("An unknown error occurred during OANDA login.");
      throw new Error("An unknown error occurred during OANDA login.");
    }
  }
};
