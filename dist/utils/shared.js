// src/utils/shared.ts
import { ACTION } from '../utils/oanda/api/order.js';
import { handleOandaLogin } from './oanda/api/login.js';
import { currentPrice } from './oanda/api/currentPrice.js';
import { openNow } from './oanda/api/openNow.js';
import { balanceMT } from './match-trader/api/balance.js';
import { pipMap, instrumentPrecision, contractSize } from './constants.js';
export function isForexMarketOpen() {
    const now = new Date();
    // Convert to UTC for simplicity (Forex opens Sunday 22:00 UTC and closes Friday 22:00 UTC)
    const utcDay = now.getUTCDay(); // Sunday = 0, Monday = 1, ..., Saturday = 6
    const utcHour = now.getUTCHours();
    // Market is closed from Friday 22:00 UTC to Sunday 22:00 UTC
    if (utcDay === 5 && utcHour >= 22)
        return false; // Friday after 22:00 UTC
    if (utcDay === 6)
        return false; // Saturday all day
    if (utcDay === 0 && utcHour < 22)
        return false; // Sunday before 22:00 UTC
    return true;
}
const normalizePairKey = (pair) => {
    return pair.replace(/[^A-Z]/gi, '').toUpperCase(); // e.g., "usd_jpy" → "USDJPY"
};
export const getPipIncrement = (pair) => {
    const key = normalizePairKey(pair);
    return pipMap[key] ?? 0.0001;
};
export const getPrecision = (pair) => {
    const key = normalizePairKey(pair);
    return instrumentPrecision[key] ?? 5;
};
// Converts symbols like "EURUSD" → "EUR_USD" for OANDA compatibility
export const normalizeOandaSymbol = (symbol) => {
    return symbol.length === 6
        ? `${symbol.slice(0, 3)}_${symbol.slice(3, 6)}`
        : symbol;
};
export const wait = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};
const getLocalStorageItem = (key) => {
    if (typeof window !== 'undefined')
        return localStorage.getItem(key);
    return null;
};
export const calculateSLTPMT = (openPrice, orderSide, pair) => {
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
export const calculalateRisk = async (orderType, pair) => {
    const pip = getPipIncrement(pair);
    const precision = getPrecision(pair);
    const stopLoss = parseFloat(getLocalStorageItem('stopLoss') || '0');
    const takeProfit = stopLoss * 2;
    try {
        const { account } = await handleOandaLogin();
        if (!account)
            throw new Error("Account not loaded");
        const { ask, bid } = await currentPrice(pair);
        const riskAmount = parseFloat(account.balance) * (orderType.risk / 100);
        const pipValue = stopLoss * pip;
        const units = riskAmount / pipValue;
        return {
            units: units.toFixed(0),
            takeProfit: (orderType.action === ACTION.BUY
                ? parseFloat(ask) + pip * takeProfit
                : parseFloat(bid) - pip * takeProfit).toFixed(precision),
            stopLoss: (orderType.action === ACTION.BUY
                ? parseFloat(ask) - pip * stopLoss
                : parseFloat(bid) + pip * stopLoss).toFixed(precision)
        };
    }
    catch (error) {
        console.error('Error calculating risk:', error.message);
        return undefined;
    }
};
export const calculateVolumeMT = async (risk, pair) => {
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
export const recentTrade = async (pair) => {
    const openTrades = await openNow(pair);
    if (!openTrades?.trades?.length)
        return undefined;
    return openTrades.trades.reduce((prev, curr) => {
        const prevTime = new Date(prev.openTime || 0).getTime();
        const currTime = new Date(curr.openTime || 0).getTime();
        return currTime > prevTime ? curr : prev;
    });
};
export const storeTokensInRedis = async (TRADING_API_TOKEN, SYSTEM_UUID) => {
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
