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
  orders: any[]; // Replace 'any' with the actual type for orders, positions, trades, if known
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

export const handleOandaLogin = async (): Promise<AccountResponse> => {
  const token = localStorage.getItem('token');
  const accountType = localStorage.getItem('accountType');
  const hostname = accountType === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
  const accountId = accountType === 'live' ? '[redacted]' : '[redacted]';

  // Check if the environment variable is set
  if (!accountId || !token || !accountType) {
    console.log("Token or AccountId is not set.");
  }

  const api2: string = `${hostname}/v3/accounts`;
  const response2: Response = await fetch(api2, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
  
  const responseData2: AccountResponse = await response2.json();
  console.log(responseData2);
  const api: string = `${hostname}/v3/accounts/${accountId}`;
  const response: Response = await fetch(api, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    console.log(`HTTP error! Status: ${response.status}`);
  }

  const responseData: AccountResponse = await response.json();
  console.log(responseData);
  return responseData
};
