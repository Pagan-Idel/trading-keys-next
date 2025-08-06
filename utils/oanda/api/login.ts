import { logMessage  } from "../../logger";
import credentials from "../../../credentials.json" with { type: "json"};
 // Import credentials.json at the top
import { loginMode } from "../../../utils/loginMode";

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
  orders: any[];
  positions: any[];
  trades: any[];
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
  errorMessage: string;
}

const getLocalStorageItem = (key: string): string | null => {
  if (typeof window !== "undefined") {
    return localStorage.getItem(key);
  }
  return null;
};

export const handleOandaLogin = async (
  pair?: string
): Promise<AccountResponse> => {
  const accountType = getLocalStorageItem('accountType') || loginMode || 'demo';
  const hostname =
    accountType === 'live'
      ? 'https://api-fxtrade.oanda.com'
      : 'https://api-fxpractice.oanda.com';

  const accountId =
    accountType === 'live'
      ? credentials.OANDA_LIVE_ACCOUNT_ID
      : credentials.OANDA_DEMO_ACCOUNT_ID;

  const token =
    accountType === 'live'
      ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
      : credentials.OANDA_DEMO_ACCOUNT_TOKEN;

  if (!token || !accountId) {
    logMessage ("❌ Token or AccountId is not set.");
    throw new Error("Token or AccountId is not set.");
  }

  const accountListUrl = `${hostname}/v3/accounts`;
  const response2: Response = await fetch(accountListUrl, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
  const responseData2: AccountResponse = await response2.json();
  // logMessage ("✅ /accounts list response", responseData2);

  const accountDetailsUrl = `${hostname}/v3/accounts/${accountId}`;
  const response: Response = await fetch(accountDetailsUrl, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    logMessage (`❌ HTTP error! Status: ${response.status}`);
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const responseData: AccountResponse = await response.json();
  // logMessage (`✅ Account details${pair ? ` for ${pair}` : ""}`, responseData);
  return responseData;
};
