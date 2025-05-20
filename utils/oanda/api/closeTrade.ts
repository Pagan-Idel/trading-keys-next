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

export const closeTrade = async (
  orderType: OrderParameters,
  pair?: string
): Promise<TradeCloseResponse | boolean> => {
  let accountType = '';
  let accountId = '';
  let token = '';
  let hostname = '';

  if (typeof window !== 'undefined') {
    accountType = localStorage.getItem('accountType') || '';
    hostname = accountType === 'live'
      ? 'https://api-fxtrade.oanda.com'
      : 'https://api-fxpractice.oanda.com';
    accountId = accountType === 'live'
      ? credentials.OANDA_LIVE_ACCOUNT_ID
      : credentials.OANDA_DEMO_ACCOUNT_ID;
    token = accountType === 'live'
      ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
      : credentials.OANDA_DEMO_ACCOUNT_TOKEN;
  }

  if (!accountId || !token) {
    logToFileAsync("❌ Token or AccountId is not set.");
    return false;
  }

  const mostRecentTrade: Trade | undefined = await recentTrade(pair);
  if (!mostRecentTrade) {
    logToFileAsync(`⚠️ No recent trade found${pair ? ` for ${pair}` : ""}.`);
    return false;
  }

  const partialClose =
    orderType.action === ACTION.PartialClose25 ? 0.24999999999 :
    orderType.action === ACTION.PartialClose50 ? 0.4999999999 :
    1;

  const initialUnitsString = mostRecentTrade.initialUnits!;
  const initialUnitsWithoutNegative = initialUnitsString.replace('-', '');
  const partialUnits = (parseFloat(initialUnitsWithoutNegative) * partialClose).toFixed(0);

  const requestBody: CloseRequestBody =
    orderType.action === ACTION.PartialClose25 || orderType.action === ACTION.PartialClose50
      ? { units: partialUnits }
      : {};

  const api = `${hostname}/v3/accounts/${accountId}/trades/${mostRecentTrade.id}/close`;

  try {
    const response: Response = await fetch(api, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(requestBody),
    });

    const responseData: TradeCloseResponse = await response.json();

    if (!response.ok) {
      logToFileAsync(`❌ HTTP error! Status: ${response.status}`);
      return false;
    }

    logToFileAsync(`✅ Trade closed${pair ? ` for ${pair}` : ''}`, responseData);
    return responseData;

  } catch (error) {
    logToFileAsync(`❌ Exception closing trade${pair ? ` for ${pair}` : ''}:`, error);
    return false;
  }
};
