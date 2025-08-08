// src/utils/oanda/api/order.ts

import type { OrderParameters } from "../../shared";
import { logMessage } from "../../logger";
import credentials from "../../../credentials.json";
import { type RISK, calculateRisk, getPrecision, normalizeOandaSymbol } from "../../shared";

export const TYPE = {
  MARKET: 'MARKET',
  LIMIT: 'LIMIT',
  STOP: 'STOP',
  MARKET_IF_TOUCHED: 'MARKET_IF_TOUCHED',
  TAKE_PROFIT: 'TAKE_PROFIT',
  STOP_LOSS: 'STOP_LOSS',
  GUARANTEED_STOP_LOSS: 'GUARANTEED_STOP_LOSS',
  TRAILING_STOP_LOSS: 'TRAILING_STOP_LOSS',
  FIXED_PRICE: 'FIXED_PRICE'
} as const;

export const ACTION = {
  SELL: 'SELL',
  BUY: 'BUY',
  SLatEntry: 'SLatEntry',
  MoveSL: 'MoveSL',
  MoveTP: 'MoveTP',
  PartialClose50: 'PartialClose50',
  PartialClose25: 'PartialClose25',
  PartialClose: 'PartialClose',
  CLOSE: 'Close',
  UP: 'Up',
  DOWN: 'Down'
} as const;

export type ACTION = typeof ACTION[keyof typeof ACTION];

export interface ActionOnFill {
  price: string;
}

export interface MarketOrderRequest {
  type?: keyof typeof TYPE;
  instrument?: string;
  units?: string;
  price?: string;
  tradeID?: string;
  stopLossOnFill?: ActionOnFill;
  takeProfitOnFill?: ActionOnFill;
  timeInForce: string;
}

export interface OrderRequest {
  order: MarketOrderRequest;
}

export const order = async (orderType: OrderParameters, mode: 'live' | 'demo' = 'demo'): Promise<{ success: boolean; reason: string; raw: any }> => {
  const fileName = "order";
  logMessage("Placing order", orderType, { fileName });

  const pair = orderType.pair;
  if (!pair) {
    logMessage("❌ Pair is not specified in orderType", orderType, { level: "error", fileName });
    return { success: false, reason: 'Pair not specified', raw: orderType };
  }

  const normalizedPair = normalizeOandaSymbol(pair);
  const accountType = mode;
  const hostname = accountType === "live"
    ? "https://api-fxtrade.oanda.com"
    : "https://api-fxpractice.oanda.com";
  const accountId = accountType === "live"
    ? credentials.OANDA_LIVE_ACCOUNT_ID
    : credentials.OANDA_DEMO_ACCOUNT_ID;
  const token = accountType === "live"
    ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
    : credentials.OANDA_DEMO_ACCOUNT_TOKEN;

  if (!accountId || !hostname || !token) {
    logMessage("❌ Missing accountId, token, or hostname", { accountType, accountId, token, hostname }, { level: "error", fileName });
    return { success: false, reason: 'Missing accountId, token, or hostname', raw: { accountType, accountId, token, hostname } };
  }

  // Always use calculated SL/TP prices from calculateRisk
  const riskData: RISK | undefined = await calculateRisk(orderType, pair, mode);
  if (!riskData?.units || !riskData?.stopLoss || !riskData?.takeProfit) {
    logMessage("❌ Error Calculating Risk — incomplete data", riskData, { level: "error", fileName });
    return { success: false, reason: 'Error Calculating Risk — incomplete data', raw: riskData };
  }

  const units = riskData.units;
  const stopLoss = riskData.stopLoss;
  const takeProfit = riskData.takeProfit;
  const signedUnits = `${orderType.action === ACTION.SELL ? '-' : ''}${units}`;
  logMessage("Creating order request", { pair, signedUnits, stopLoss, takeProfit }, { level: "info", fileName });

  const requestBody: OrderRequest = {
    order: {
      type: TYPE.MARKET,
      instrument: normalizedPair,
      units: signedUnits,
      stopLossOnFill: {
        price: stopLoss
      },
      takeProfitOnFill: {
        price: takeProfit
      },
      timeInForce: "FOK"
    }
  };

  const apiUrl = `${hostname}/v3/accounts/${accountId}/orders`;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "Accept-Datetime-Format": "RFC3339"
      },
      body: JSON.stringify(requestBody)
    });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = text;
    }

    if (!response.ok) {
      logMessage("❌ HTTP error placing order", { status: response.status, errorText: json }, { level: "error", fileName });
      return { success: false, reason: json?.orderCancelTransaction?.reason || json?.errorMessage || 'HTTP error', raw: json };
    }

    // Extract reason from OANDA response
    let reason = 'UNKNOWN';
    if (json?.orderFillTransaction?.reason) {
      reason = json.orderFillTransaction.reason;
    } else if (json?.orderCancelTransaction?.reason) {
      reason = json.orderCancelTransaction.reason;
    } else if (json?.orderCreateTransaction?.reason) {
      reason = json.orderCreateTransaction.reason;
    }

    logMessage("✅ Order placed response", json, { level: "info", fileName });
    return { success: !!json?.orderFillTransaction, reason, raw: json };

  } catch (err: any) {
    logMessage("❌ Fetch threw an error", err, { level: "error", fileName });
    return { success: false, reason: err?.message || 'Fetch error', raw: err };
  }
}
// ...existing code up to the correct order function implementation...
