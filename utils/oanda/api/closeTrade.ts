// src/utils/oanda/api/closeTrade.ts

import credentials from "../../../credentials.json";
import type { Trade } from "./openNow";
import { ACTION } from "./order";
import type { OrderParameters } from "../../shared";
import { logMessage } from "../../logger";
import { recentTrade } from "../../shared";
import { getLoginMode } from "../../loginState";

export interface TradeCloseResponse {
  lastTransactionID?: TransactionID;
  orderCreateTransaction?: MarketOrderTransaction;
  orderFillTransaction?: OrderFillTransaction;
  orderCancelTransaction?: OrderCancelTransaction;
  relatedTransactionIDs?: TransactionID[];
}

export interface MarketOrderTransaction {
  tradeClose?: {
    tradeID?: string;
    units?: string;
  };
  [key: string]: any;
}

export interface OrderFillTransaction {
  tradeReduced?: {
    tradeID?: string;
    units?: string;
    realizedPL?: string;
  };
  [key: string]: any;
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

// 🆕 unitsOverride = new optional param
export const closeTrade = async (
  orderType: OrderParameters,
  pair?: string,
  unitsOverride?: number
): Promise<TradeCloseResponse | boolean> => {
  const accountType = getLoginMode(); // 👈 use dynamic loginMode
  let accountId = '';
  let token = '';
  let hostname = '';

  hostname = accountType === "live"
    ? "https://api-fxtrade.oanda.com"
    : "https://api-fxpractice.oanda.com";

  accountId = accountType === "live"
    ? credentials.OANDA_LIVE_ACCOUNT_ID
    : credentials.OANDA_DEMO_ACCOUNT_ID;

  token = accountType === "live"
    ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
    : credentials.OANDA_DEMO_ACCOUNT_TOKEN;

  if (!accountId || !token) {
    logMessage("❌ Token or AccountId is not set.");
    return false;
  }

  const mostRecentTrade: Trade | undefined = await recentTrade(pair);
  if (!mostRecentTrade) {
    logMessage(`⚠️ No recent trade found${pair ? ` for ${pair}` : ""}.`);
    return false;
  }

  let requestBody: CloseRequestBody = {};

  // ✅ Use exact units if provided
  if (unitsOverride !== undefined) {
    requestBody.units = Math.floor(unitsOverride).toString();
  } else if (
    orderType.action === ACTION.PartialClose25 ||
    orderType.action === ACTION.PartialClose50
  ) {
    const initialUnits = Math.abs(parseFloat(mostRecentTrade.initialUnits ?? "0"));
    const partialClose =
      orderType.action === ACTION.PartialClose25 ? 0.25 :
      orderType.action === ACTION.PartialClose50 ? 0.5 : 1;

    requestBody.units = Math.floor(initialUnits * partialClose).toString();
  }

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
      logMessage(`❌ HTTP error! Status: ${response.status}`, responseData, {
        level: 'error',
        fileName: 'closeTrade'
      });
      return false;
    }

    logMessage(`✅ Trade closed${pair ? ` for ${pair}` : ''}`, responseData, {
      fileName: 'closeTrade'
    });
    return responseData;

  } catch (error) {
    logMessage(`❌ Exception closing trade${pair ? ` for ${pair}` : ''}:`, error, {
      level: 'error',
      fileName: 'closeTrade'
    });
    return false;
  }
};
