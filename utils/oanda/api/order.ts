// src/utils/oanda/api/order.ts

import { OrderParameters } from "../../shared.js";
import { logMessage  } from "../../logger.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credentialsRaw = await fs.readFile(path.join(__dirname, '../../../credentials.json'), 'utf-8');
const credentials = JSON.parse(credentialsRaw);

import { RISK, calculalateRisk, getPrecision, normalizeOandaSymbol } from "../../shared.js";
import { loginMode } from '../../../runner/startRunner.js';

export enum TYPE {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  MARKET_IF_TOUCHED = 'MARKET_IF_TOUCHED',
  TAKE_PROFIT = 'TAKE_PROFIT',
  STOP_LOSS = 'STOP_LOSS',
  GUARANTEED_STOP_LOSS = 'GUARANTEED_STOP_LOSS',
  TRAILING_STOP_LOSS = 'TRAILING_STOP_LOSS',
  FIXED_PRICE = 'FIXED_PRICE'
}

export enum ACTION {
  SELL = 'SELL',
  BUY = 'BUY',
  SLatEntry = 'SLatEntry',
  MoveSL = 'MoveSL',
  MoveTP = 'MoveTP',
  PartialClose50 = 'PartialClose50',
  PartialClose25 = 'PartialClose25',
  CLOSE = 'Close',
  UP = 'Up',
  DOWN = 'Down'
}

export interface ActionOnFill {
  price: string;
}

export interface MarketOrderRequest {
  type?: TYPE;
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

const getLocalStorageItem = (key: string): string | null => {
  if (typeof window !== "undefined") {
    return localStorage.getItem(key);
  }
  return null;
};

export const order = async (orderType: OrderParameters): Promise<boolean> => {
  const pair = orderType.pair;
  if (!pair) {
    logMessage ("❌ Pair is not specified in orderType.");
    return false;
  }

  const normalizedPair = normalizeOandaSymbol(pair);
  const precision = getPrecision(pair);

  const accountType = getLocalStorageItem("accountType") || loginMode;
  const hostname =
    accountType === "live"
      ? "https://api-fxtrade.oanda.com"
      : "https://api-fxpractice.oanda.com";

  const accountId =
    accountType === "live"
      ? credentials.OANDA_LIVE_ACCOUNT_ID
      : credentials.OANDA_DEMO_ACCOUNT_ID;

  const token =
    accountType === "live"
      ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
      : credentials.OANDA_DEMO_ACCOUNT_TOKEN;

  if (!accountId || !hostname || !token) {
    logMessage ("❌ Token or AccountId is not set.");
    return false;
  }

  let units: string;
  let stopLoss = orderType.stopLoss;
  let takeProfit = orderType.takeProfit;

  if (!stopLoss || !takeProfit) {
    const riskData: RISK | undefined = await calculalateRisk(orderType, pair);
    if (!riskData?.units || !riskData?.stopLoss || !riskData?.takeProfit) {
      logMessage ("❌ Error Calculating Risk. No data found");
      return false;
    }
    units = riskData.units;
    stopLoss = stopLoss ?? riskData.stopLoss;
    takeProfit = takeProfit ?? riskData.takeProfit;
  } else {
    const conservative: OrderParameters = { ...orderType, risk: 0.25 };
    const riskData = await calculalateRisk(conservative, pair);
    if (!riskData?.units) {
      logMessage ("❌ Error calculating units");
      return false;
    }
    units = riskData.units;
  }

  const requestBody: OrderRequest = {
    order: {
      type: TYPE.MARKET,
      instrument: normalizedPair,
      units: `${orderType.action === ACTION.SELL ? '-' : ''}${units}`,
      stopLossOnFill: {
        price: parseFloat(stopLoss).toFixed(precision)
      },
      takeProfitOnFill: {
        price: parseFloat(takeProfit).toFixed(precision)
      },
      timeInForce: "FOK"
    }
  };

  const apiUrl = `${hostname}/v3/accounts/${accountId}/orders`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "Accept-Datetime-Format": "RFC3339"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    logMessage (`❌ HTTP error! Status: ${response.status}`, errorText);
    return false;
  }

  return true;
};
