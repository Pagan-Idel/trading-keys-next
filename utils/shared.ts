// src/utils/shared.ts

import { OrderParameters } from '../components/Keyboard';
import { logToFileAsync } from './logger';
import { balanceMT } from './match-trader/api/balance';
import { marketWatchMT } from './match-trader/api/market-watch';
import { ACTION, OpenTrade, Trade, handleOandaLogin, currentPrice, openNow } from './oanda/api';

export const contractSize = 100000;
export const commissionPerLot = 7;

export const forexPairs = [
  'EUR/USD', 'USD/JPY', 'GBP/USD', 'AUD/USD', 'USD/CAD',
  'USD/CHF', 'NZD/USD', 'EUR/JPY', 'GBP/JPY', 'EUR/GBP',
  'AUD/JPY', 'GBP/CAD', 'EUR/CHF', 'NZD/JPY', 'USD/SGD'
];

export const intervals = ['1day', '4h', '1h', '15m', '5m'];
export const pipMap: Record<string, number> = {
  EURUSD: 0.0001, GBPUSD: 0.0001, AUDUSD: 0.0001,
  USDCAD: 0.0001, USDCHF: 0.0001, NZDUSD: 0.0001,
  USDJPY: 0.01, EURJPY: 0.01, GBPJPY: 0.01, CHFJPY: 0.01
};

export const instrumentPrecision: Record<string, number> = {
  EURUSD: 5, GBPUSD: 5, AUDUSD: 5, NZDUSD: 5,
  USDCAD: 5, USDCHF: 5, EURJPY: 3, USDJPY: 3,
  GBPJPY: 3, CHFJPY: 3
};

const normalizePairKey = (pair: string): string => {
  return pair.replace(/[^A-Z]/gi, '').toUpperCase(); // e.g., "usd_jpy" → "USDJPY"
};

export const getPipIncrement = (pair: string): number => {
  const key = normalizePairKey(pair);
  return pipMap[key] ?? 0.0001;
};

export const getPrecision = (pair: string): number => {
  const key = normalizePairKey(pair);
  return instrumentPrecision[key] ?? 5;
};

// Converts symbols like "EURUSD" → "EUR_USD" for OANDA compatibility
export const normalizeOandaSymbol = (symbol: string): string => {
  return symbol.length === 6
    ? `${symbol.slice(0, 3)}_${symbol.slice(3, 6)}`
    : symbol;
};

export const wait = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export interface RISK {
  units: string;
  takeProfit: string;
  stopLoss: string;
}

export interface SLTPMT {
  slPrice: number;
  tpPrice: number;
}

const getLocalStorageItem = (key: string): string | null => {
  if (typeof window !== 'undefined') return localStorage.getItem(key);
  return null;
};

export const calculateSLTPMT = (
  openPrice: string,
  orderSide: "BUY" | "SELL",
  pair: string
): SLTPMT => {
  const pip = getPipIncrement(pair);
  const precision = getPrecision(pair);
  const stopLoss = parseFloat(getLocalStorageItem('stopLoss') || '0');
  const takeProfit = stopLoss * 2;
  const price = parseFloat(openPrice);

  const tpPrice = orderSide === ACTION.BUY
    ? parseFloat((price + pip * takeProfit).toFixed(precision))
    : parseFloat((price - pip * takeProfit).toFixed(precision));

  const slPrice = orderSide === ACTION.BUY
    ? parseFloat((price - pip * stopLoss).toFixed(precision))
    : parseFloat((price + pip * stopLoss).toFixed(precision));

  return { slPrice, tpPrice };
};

export const calculateVolumeMT = async (
  risk: number,
  pair: string
): Promise<number | string> => {
  const pip = getPipIncrement(pair);
  const stopLoss = parseFloat(getLocalStorageItem('stopLoss') || '0');
  const balanceResponse = await balanceMT();

  if ('balance' in balanceResponse) {
    const balance = balanceResponse.balance;
    const pipValue = stopLoss * pip;
    const riskAmount = parseFloat(balance) * (risk / 100);
    return parseFloat((riskAmount / pipValue / contractSize).toFixed(1));
  }

  return "No Volume!";
};

export const calculalateRisk = async (
  orderType: OrderParameters,
  pair: string
): Promise<RISK | undefined> => {
  const pip = getPipIncrement(pair);
  const precision = getPrecision(pair);
  const stopLoss = parseFloat(getLocalStorageItem('stopLoss') || '0');
  const takeProfit = stopLoss * 2;

  try {
    const { account } = await handleOandaLogin();
    if (!account) throw new Error("Account not loaded");

    const { ask, bid } = await currentPrice(pair);
    const riskAmount = parseFloat(account.balance) * (orderType.risk! / 100);
    const pipValue = stopLoss * pip;
    const units = riskAmount / pipValue;

    return {
      units: units.toFixed(0),
      takeProfit: (
        orderType.action === ACTION.BUY
          ? parseFloat(ask) + pip * takeProfit
          : parseFloat(bid) - pip * takeProfit
      ).toFixed(precision),
      stopLoss: (
        orderType.action === ACTION.BUY
          ? parseFloat(ask) - pip * stopLoss
          : parseFloat(bid) + pip * stopLoss
      ).toFixed(precision)
    };
  } catch (error: any) {
    console.error('Error calculating risk:', error.message);
    return undefined;
  }
};

export const getBidAndAsk = async (currency: string = "EURUSD") => {
  const response = await marketWatchMT(currency);
  if (Array.isArray(response) && response.length > 0) {
    const { bid, ask } = response[0];
    return { bid, ask };
  }
  return { bid: null, ask: null };
};

export const recentTrade = async (
  pair?: string
): Promise<Trade | undefined> => {
  const openTrades = await openNow(pair);
  if (!openTrades?.trades?.length) return undefined;

  return openTrades.trades.reduce((prev, curr) => {
    const prevTime = new Date(prev.openTime || 0).getTime();
    const currTime = new Date(curr.openTime || 0).getTime();
    return currTime > prevTime ? curr : prev;
  });
};

export const storeTokensInRedis = async (
  TRADING_API_TOKEN: string,
  SYSTEM_UUID: string
) => {
  const response = await fetch('/api/store-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ TRADING_API_TOKEN, SYSTEM_UUID }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.errorMessage || 'Failed to store tokens in Redis');
  }
};
