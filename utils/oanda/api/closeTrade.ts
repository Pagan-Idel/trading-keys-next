import { ACTION, Trade } from ".";
import { OrderParameters } from "../../../components/Keyboard";
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
  const token = localStorage.getItem('token');
  const accountId = localStorage.getItem('accountId');
  const accountEnv = localStorage.getItem('accountEnv');
  // Check if the environment variable is set
  if (!accountId || !token || !accountEnv) {
    console.log("Token or AccountId is not set.");
  }

  const mostRecentTrade: Trade | undefined = await recentTrade();
  if (!mostRecentTrade) {
    return false;
  }
  const initialUnitsString: string = mostRecentTrade.initialUnits!;
  const initialUnitsWithoutNegative: string = initialUnitsString.replace('-', '');
  const partialUnits: string = (parseFloat(initialUnitsWithoutNegative) * 0.249999999999).toFixed(0);
  const requestBody: CloseRequestBody = orderType.action === ACTION.PartialClose
  ? { units: partialUnits }
  : {};
  const api: string = `${accountEnv}/v3/accounts/${accountId}/trades/${mostRecentTrade.id}/close`;
  const response: Response = await fetch(api, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      ...requestBody, // Merge additional body parameters if needed
    }),
  });
  
  if (!response.ok) {
    console.log(`HTTP error! Status: ${response.status}`);
  }
  const responseData: TradeCloseResponse = await response.json();
  console.log("responseData",responseData);
  return responseData;
} 