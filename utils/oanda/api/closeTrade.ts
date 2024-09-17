import { ACTION, order, Trade } from ".";
import { OrderParameters } from "../../../components/Keyboard";
import { logToFileAsync } from "../../logger";
import credentials from "../../../credentials.json";
import { recentTrade } from "../../shared";

export interface TradeCloseResponse {
  lastTransactionID?: TransactionID;
  orderCreateTransaction?: MarketOrderTransaction;
  orderFillTransaction?: OrderFillTransaction;
  orderCancelTransaction?: OrderCancelTransaction;
  relatedTransactionIDs?: TransactionID[];
}

export interface MarketOrderTransaction {
  accountID?: string;
  batchID?: string;
  id?: string;
  instrument?: string;
  positionFill?: string;
  reason?: string;
  time?: string;
  timeInForce?: string;
  tradeClose?: {
    clientTradeID?: string;
    tradeID?: string;
    units?: string;
  };
  type?: string;
  units?: string;
  userID?: string;
}

export interface OrderFillTransaction {
  accountBalance?: string;
  accountID?: string;
  batchID?: string;
  financing?: string;
  id?: string;
  instrument?: string;
  orderID?: string;
  pl?: string;
  price?: string;
  reason?: string;
  time?: string;
  tradeReduced?: {
    clientTradeID?: string;
    financing?: string;
    realizedPL?: string;
    tradeID?: string;
    units?: string;
  };
  type?: string;
  units?: string;
  userID?: string;
}

export interface OrderCancelTransaction {
  OrderCancelTransaction: any;
}

export interface TransactionID {
  id?: string;
}

export interface CloseRequestBody {
  units?: string;
}

export const closeTrade = async (orderType: OrderParameters): Promise<TradeCloseResponse | boolean> => {
  let accountType = '';
  let accountId = '';
  let token = '';

  // Check if running in browser to access localStorage
  if (typeof window !== 'undefined') {
    accountType = localStorage.getItem('accountType') || '';
    accountId = accountType === 'live' ? credentials.NEXT_PUBLIC_OANDA_LIVE_ACCOUNT_ID : credentials.NEXT_PUBLIC_OANDA_DEMO_ACCOUNT_ID;
    token = accountType === 'live' ? credentials.NEXT_PUBLIC_OANDA_LIVE_ACCOUNT_TOKEN : credentials.NEXT_PUBLIC_OANDA_DEMO_ACCOUNT_TOKEN;
  }

  // Check if the environment variable is set
  if (!accountId || !token) {
    logToFileAsync("Token or AccountId is not set.");
    return false;
  }

  const mostRecentTrade: Trade | undefined = await recentTrade();
  if (!mostRecentTrade) {
    return false;
  }

  const partialClose: number = orderType.action === ACTION.PartialClose25 ? 0.24999999999 : 0.4999999999;
  const initialUnitsString: string = mostRecentTrade.initialUnits!;
  const initialUnitsWithoutNegative: string = initialUnitsString.replace('-', '');
  const partialUnits: string = (parseFloat(initialUnitsWithoutNegative) * partialClose).toFixed(0);

  const requestBody: CloseRequestBody = orderType.action === ACTION.PartialClose25 || orderType.action === ACTION.PartialClose50
    ? { units: partialUnits }
    : {};

  const hostname = accountType === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
  const api: string = `${hostname}/v3/accounts/${accountId}/trades/${mostRecentTrade.id}/close`;

  try {
    const response: Response = await fetch(api, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        ...requestBody,
      }),
    });

    if (!response.ok) {
      logToFileAsync(`HTTP error! Status: ${response.status}`);
      return false;
    }

    const responseData: TradeCloseResponse = await response.json();
    logToFileAsync("responseData", responseData);
    return responseData;

  } catch (error) {
    logToFileAsync(`Error closing trade: ${error}`);
    return false;
  }
};
