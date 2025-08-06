// src/utils/shared.ts
import { ACTION, TYPE } from '../utils/oanda/api/order';
import type { Trade } from './oanda/api/openNow';
import { handleOandaLogin } from './oanda/api/login';
import { fetchPriceOnce } from "./oanda/api/priceStreamManager";
import { openNow } from './oanda/api/openNow';
import { pipMap, instrumentPrecision, contractSize } from './constants';
import type { SwingResult } from './swingLabeler';
// import { logMessage } from './logger';

export interface OrderParameters {
  orderType?: (typeof TYPE)[keyof typeof TYPE];
  price?: string;
  action?: ACTION;
  action2?: ACTION;
  risk?: number;
  orderId?: string;
  priceId?: string;
  pair: string;
  stopLoss?: string;
  takeProfit?: string;
}

export const toLocalTime = (utc: string): string =>
  new Date(utc).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: true,
    timeZone: "America/Chicago",
  });

export const logSwingSummary = (
  swings: SwingResult[],
  tf: string,
  summarize = true,
  pair: string,
  fileName: string = "swing" // optional override
) => {
  const format = (label: SwingResult) =>
    `[Candle ${label.candleIndex}] → ${label.swing} at ${label.price} (${toLocalTime(label.time!)})`;

  console.log(`🟢 ${tf} Swing Labels:`, undefined, {
    level: "info",
    fileName,
    pair,
  });

  if (summarize) {
    const lastSix = swings.slice(-5);
    lastSix.forEach((l) =>
      console.log(format(l), undefined, { fileName, pair })
    );
  } else {
    swings.forEach((l) =>
      console.log(format(l), undefined, { fileName, pair })
    );
  }
};

export function isForexMarketOpen(): boolean {
  const now = new Date();

  // Get current UTC date parts
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();

  // Calculate most recent Sunday 21:00 UTC
  const dayOfWeek = now.getUTCDay();
  const daysSinceSunday = dayOfWeek; // 0 = Sunday
  const sundayOpen = new Date(Date.UTC(year, month, date - daysSinceSunday, 21, 0, 0, 0));

  // Calculate upcoming Friday 21:00 UTC relative to same week
  const daysUntilFriday = 5 - dayOfWeek + (dayOfWeek === 0 ? 0 : 0);
  const fridayClose = new Date(Date.UTC(year, month, date - daysSinceSunday + 5, 21, 0, 0, 0));

  const utcNow = now.getTime();
  const isMarketOpen = utcNow >= sundayOpen.getTime() && utcNow < fridayClose.getTime();

  const todayKey = now.toISOString().split("T")[0];
  const { fullHolidays, partialHolidays } = getUSDHolidayDates(now.getFullYear());
  if (fullHolidays.has(todayKey) || partialHolidays.has(todayKey)) {
    console.log(`🚫 Holiday detected: ${todayKey}`);
    return false;
  }

  return isMarketOpen;
}


function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function getUSDHolidayDates(year: number): { fullHolidays: Set<string>; partialHolidays: Set<string> } {
  const full = new Set<string>();
  const half = new Set<string>();

  const nthWeekday = (n: number, weekday: number, month: number): Date => {
    const date = new Date(year, month - 1, 1);
    let count = 0;
    while (date.getMonth() === month - 1) {
      if (date.getDay() === weekday) count++;
      if (count === n) break;
      date.setDate(date.getDate() + 1);
    }
    return date;
  };

  const lastWeekday = (weekday: number, month: number): Date => {
    const date = new Date(year, month, 0);
    while (date.getDay() !== weekday) {
      date.setDate(date.getDate() - 1);
    }
    return date;
  };

  const add = (d: Date, set: Set<string>) => {
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    set.add(key);
  };

  // Full U.S. federal holidays
  add(new Date(year, 0, 1), full);              // New Year's Day
  add(nthWeekday(3, 1, 1), full);               // MLK Day
  add(nthWeekday(3, 1, 2), full);               // Presidents’ Day
  add(lastWeekday(1, 5), full);                 // Memorial Day
  add(new Date(year, 5, 19), full);             // Juneteenth
  add(new Date(year, 6, 4), full);              // Independence Day
  add(nthWeekday(1, 1, 9), full);               // Labor Day
  add(nthWeekday(2, 1, 10), full);              // Columbus Day
  add(new Date(year, 10, 11), full);            // Veterans Day
  const thanksgiving = nthWeekday(4, 4, 11);    // Thanksgiving
  add(thanksgiving, full);
  add(new Date(year, 11, 25), full);            // Christmas Day

  // Half-day holidays (treated as full-day no-trade)
  const blackFriday = new Date(thanksgiving);
  blackFriday.setDate(blackFriday.getDate() + 1);
  add(blackFriday, half);
  add(new Date(year, 11, 24), half);            // Christmas Eve
  add(new Date(year, 6, 3), half);              // July 3 (day before Independence Day)

  return { fullHolidays: full, partialHolidays: half };
}

export const normalizePairKey = (pair: string): string => {
  return pair.replace(/[^A-Z]/gi, '').toUpperCase(); // e.g., "usd_jpy" → "USDJPY"
};

export const normalizePairKeyUnderscore = (pair: string): string => {
  return pair.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase(); // e.g., "USD/JPY" → "USD_JPY"
};

export const getPipIncrement = (pair: string): number => {
  const key = normalizePairKeyUnderscore(pair);
  return pipMap[key] ?? 0.0001;
};

export const getPrecision = (pair: string): number => {
  const key = normalizePairKeyUnderscore(pair);
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

// 🔢 Standard‐lot size (import or keep here)
export const lotSize = 100_000;

// 🎯 Get proper rate symbol
export const getQuoteRateSymbol = (quote: string): string => {
  switch (quote) {
    case "CAD":
    case "CHF":
    case "JPY":
      return `USD_${quote}`;
    case "AUD":
    case "NZD":
    case "GBP":
      return `${quote}_USD`;
    case "USD":
      return ""; // already USD-quoted
    default:
      throw new Error(`❌ Unsupported quote currency: ${quote}`);
  }
};


export const calculateRisk = async (
  orderType: OrderParameters,
  pair: string
): Promise<RISK | undefined> => {
  const pip = getPipIncrement(pair);
  const precision = getPrecision(pair);
  console.log(`🔍 Calculating risk for ${pair} with orderType: ${JSON.stringify(orderType)}`, undefined, { fileName: "shared", pair });
  console.log(`📊 Pip Increment: ${pip}, Precision: ${precision}`, undefined, { fileName: "shared", pair });

  try {
    if (!orderType.risk || orderType.risk <= 0) {
      throw new Error("❌ Invalid risk % provided.");
    }

    const { account } = await handleOandaLogin();
    if (!account) throw new Error("❌ Account not loaded");

    const { ask, bid } = (await fetchPriceOnce(pair)) ?? {};
    if (!ask || !bid) throw new Error("❌ No price available in stream");

    const entryPrice = orderType.action === ACTION.BUY ? parseFloat(ask) : parseFloat(bid);

    const rawSL = orderType.stopLoss ?? getLocalStorageItem("stopLoss") ?? "0";
    const rawTP = orderType.takeProfit ?? "";
    console.log(`📉 Entry=${entryPrice}, rawSL=${rawSL}, rawTP=${rawTP}`, undefined, { fileName: "shared", pair });

    const isPriceBased = rawSL.includes(".");
    let stopLossPips: number;
    let takeProfitPips: number;
    let slPrice: number;
    let tpPrice: number;

    if (isPriceBased) {
      slPrice = parseFloat(rawSL);
      stopLossPips = Math.abs(entryPrice - slPrice) / pip;
      console.log(`📊 Price-based SL: ${slPrice}, Pips: ${stopLossPips}`, undefined, { fileName: "shared", pair });

      if (rawTP) {
        tpPrice = parseFloat(rawTP);
        takeProfitPips = Math.abs(tpPrice - entryPrice) / pip;
        console.log(`📊 Price-based TP: ${tpPrice}, Pips: ${takeProfitPips}`, undefined, { fileName: "shared", pair });
      } else {
        takeProfitPips = stopLossPips * 2;
        tpPrice = orderType.action === ACTION.BUY
          ? entryPrice + takeProfitPips * pip
          : entryPrice - takeProfitPips * pip;
        console.log(`📊 Default TP: ${tpPrice}, Pips: ${takeProfitPips}`, undefined, { fileName: "shared", pair });
      }
    } else {
      stopLossPips = parseFloat(rawSL);
      takeProfitPips = rawTP ? parseFloat(rawTP) : stopLossPips * 2;

      slPrice = orderType.action === ACTION.BUY
        ? entryPrice - stopLossPips * pip
        : entryPrice + stopLossPips * pip;

      tpPrice = orderType.action === ACTION.BUY
        ? entryPrice + takeProfitPips * pip
        : entryPrice - takeProfitPips * pip;

      console.log(`📊 Pips-based SL: ${slPrice}, Pips: ${stopLossPips}`, undefined, { fileName: "shared", pair });
    }

    if (!stopLossPips || stopLossPips <= 0) {
      throw new Error("❌ Invalid stopLoss value.");
    }

    // 🔎 Normalize pair
    const cleanPair = pair.replace(/_/g, "").toUpperCase();
    const quote = cleanPair.slice(-3);
    let pipValuePerLot = 10;

    if (quote !== "USD") {
      const rateSymbol = getQuoteRateSymbol(quote);
      const { ask: rateAsk, bid: rateBid } = (await fetchPriceOnce(rateSymbol)) ?? {};
      if (!rateAsk || !rateBid) throw new Error(`❌ Failed to fetch rate for ${rateSymbol}`);
      const rate = (parseFloat(rateAsk) + parseFloat(rateBid)) / 2;

      pipValuePerLot = quote === "JPY" ? (10 / rate) * 100 : 10 / rate;
      console.log(`🔄 Cross conversion | ${quote}->USD via ${rateSymbol}: ${pipValuePerLot}`, undefined, { fileName: "shared", pair });
    }

    const pipValuePerUnit = pipValuePerLot / contractSize;
    const riskAmount = parseFloat(account.balance) * (orderType.risk / 100);
    const units = riskAmount / (stopLossPips * pipValuePerUnit);

    console.log(`💰 Risk Amount: ${riskAmount}`, undefined, { fileName: "shared", pair });
    console.log(`🔢 pipValuePerUnit: ${pipValuePerUnit}`, undefined, { fileName: "shared", pair });
    console.log(`📐 Units to trade: ${units}`, undefined, { fileName: "shared", pair });
    console.log(`📉 Entry=${entryPrice}, SL=${slPrice}, TP=${tpPrice}`, undefined, { fileName: "shared", pair });
    console.log(`📊 SL Pips=${stopLossPips.toFixed(2)}, TP Pips=${takeProfitPips.toFixed(2)}`, undefined, { fileName: "shared", pair });
    console.log(`📈 Account Balance: ${account.balance}`, undefined, { fileName: "shared", pair });

    return {
      units: units.toFixed(0),
      stopLoss: slPrice.toFixed(precision),
      takeProfit: tpPrice.toFixed(precision),
    };
  } catch (error: any) {
    console.log(`❌ Error calculating risk: ${error.message}`, undefined, { fileName: "shared", pair });
    return undefined;
  }
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

export const tfToSeconds = (tf: string): number => {
  switch (tf) {
    case "S5": return 5;
    case "S10": return 10;
    case "S30": return 30;
    case "M1": return 60;
    case "M5": return 5 * 60;
    case "M15": return 15 * 60;
    case "M30": return 30 * 60;
    case "H1": return 60 * 60;
    case "H4": return 4 * 60 * 60;
    case "D": return 24 * 60 * 60;
    case "W": return 7 * 24 * 60 * 60;
    case "M": return 30 * 24 * 60 * 60;
    default: throw new Error(`Unsupported TF: ${tf}`);
  }
};

export const tfToMs = (tf: string): number => tfToSeconds(tf) * 1000;