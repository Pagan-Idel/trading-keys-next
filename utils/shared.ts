import { OrderParameters } from '../components/Keyboard';
import { logToFileAsync } from './logger';
import { balanceMT, ErrorMTResponse } from './match-trader/api/balance';
import { marketWatchMT, MarketWatchResponseMT } from './match-trader/api/market-watch';
import { openedPositionsMT } from './match-trader/api/opened-positions';
import { ACTION, INSTRUMENT, OpenTrade, Trade, handleOandaLogin, currentPrice, openNow } from './oanda/api'; 

export const pipIncrement: number = 0.0001;
export const contractSize: number = 100000;
export const commissionPerLot: number = 7;
export interface RISK {
  units: string;
  takeProfit: string;
  stopLoss: string;
}

export interface SLatEntry {
 orderId: string;
 entryPrice: string;
}

export interface SLTPMT {
  slPrice: number;
  tpPrice: number;
}

export const wait = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to get localStorage item safely (client-side only)
const getLocalStorageItem = (key: string): string | null => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(key);
  }
  return null;
}

// Only calculate SLTPMT on client-side where localStorage is available
export const calculateSLTPMT = (openPrice: string, orderSide: "BUY" | "SELL"): SLTPMT => {
  const stopLoss = parseFloat(getLocalStorageItem('stopLoss') || '0');
  const takeProfit = stopLoss * 2;
  let tpPrice = orderSide == ACTION.BUY 
    ? parseFloat((parseFloat(openPrice) + (pipIncrement * takeProfit)).toFixed(5)) 
    : parseFloat((parseFloat(openPrice) - (pipIncrement * takeProfit)).toFixed(5));
  
  let slPrice = orderSide == ACTION.BUY 
    ? parseFloat((parseFloat(openPrice) - (pipIncrement * stopLoss)).toFixed(5)) 
    : parseFloat((parseFloat(openPrice) + (pipIncrement * stopLoss)).toFixed(5));
  
  logToFileAsync("OpenPrice", openPrice);
  logToFileAsync("TakeProfit Price", tpPrice);
  logToFileAsync("StopLoss Price", slPrice);
  
  return { slPrice, tpPrice };
}

// Use Redis or other backend solution to calculate volume when server-side
export const calculateVolumeMT = async (risk: number): Promise<number | string> => {
  const stopLoss = parseFloat(getLocalStorageItem('stopLoss') || '0');
  const balanceResponse = await balanceMT();

  if ('balance' in balanceResponse) {
    let balance: string = balanceResponse.balance;
    const pipValue = stopLoss * pipIncrement;

    const riskAmount = parseFloat(balance) * (risk / 100);
    const volume = parseFloat((riskAmount / pipValue / contractSize).toFixed(1));

    logToFileAsync("Balance", balance);
    logToFileAsync("Risk", risk);
    logToFileAsync("StopLoss", stopLoss);
    logToFileAsync("Pip Value", pipValue);
    logToFileAsync("Risk Amount", riskAmount);
    logToFileAsync("Volume", volume);

    return volume;
  } else {
    return "No Volume!";
  }
};

// Calculate risk with proper error handling for server-side
export const calculalateRisk = async (orderType: OrderParameters): Promise<RISK | undefined> => {
  const stopLoss = parseFloat(getLocalStorageItem('stopLoss') || '0');
  const takeProfit = stopLoss * 2;
  try {
    const riskResponse: RISK = {
      units: "0",
      takeProfit: "0",
      stopLoss: "0"
    };
    const { account } = await handleOandaLogin();
   
    if (!account) {
      throw new Error("Token or AccountId is not set.");
    }
    const { ask, bid } = await currentPrice(INSTRUMENT.EUR_USD);
    logToFileAsync("account", account);
    const a = parseFloat(account.balance) * (orderType.risk! / 100);
    const b = stopLoss * pipIncrement;
    const units = a / b;
    
    riskResponse.units = units.toFixed(0);
    riskResponse.takeProfit = orderType.action == ACTION.BUY 
      ? (parseFloat(ask) + (pipIncrement * takeProfit)).toFixed(5) 
      : (parseFloat(bid) - (pipIncrement * takeProfit)).toFixed(5);
    
    riskResponse.stopLoss = orderType.action == ACTION.BUY 
      ? (parseFloat(ask) - (pipIncrement * stopLoss)).toFixed(5) 
      : (parseFloat(bid) + (pipIncrement * stopLoss)).toFixed(5);

    logToFileAsync("Balance", account.balance);
    logToFileAsync("Risk", orderType.risk!);
    logToFileAsync("stopLoss", stopLoss);
    logToFileAsync("pipIncrement", pipIncrement);
    logToFileAsync("a", a);
    logToFileAsync("b", b);
    logToFileAsync("Units", riskResponse.units);
    logToFileAsync("TakeProfit Price", riskResponse.takeProfit);
    logToFileAsync("StopLoss Price", riskResponse.stopLoss);

    return riskResponse;
  } catch (error: any) {
    console.error('Error fetching account information:', error.message);
    return undefined;
  }
};

// Ensure market watch only accesses necessary client-side data
export const getBidAndAsk = async (currency: string = "EURUSD") => {
  const response = await marketWatchMT(currency);

  if (Array.isArray(response)) {
    if (response.length > 0) {
      const { bid, ask } = response[0];
      return { bid, ask };
    } else {
      console.error('No market data available.');
      return { bid: null, ask: null };
    }
  } else {
    console.error('Failed to fetch market data:', (response as ErrorMTResponse).errorMessage);
    return { bid: null, ask: null };
  }
};

// Use Redis or an appropriate backend for recent trades
export const recentTrade = async (): Promise<Trade | undefined> => {
  const openTrades: OpenTrade | undefined = await openNow();
  
  if (!openTrades) {
    logToFileAsync("No response from openTrades()");
  }
  const trades = openTrades!.trades;
  if (!trades || trades.length === 0) {
    logToFileAsync("No trades available");
  }

  // Find the trade with the latest openTime
  let mostRecentTrade: Trade = trades.reduce((prevTrade, currentTrade) => {
    if (prevTrade.openTime && currentTrade.openTime) {
      const prevTime = new Date(prevTrade.openTime).getTime();
      const currentTime = new Date(currentTrade.openTime).getTime();
      return prevTime > currentTime ? prevTrade : currentTrade;
    } else if (prevTrade.openTime) {
      return prevTrade;
    } else if (currentTrade.openTime) {
      return currentTrade;
    } else {
      return prevTrade;
    }
  }, trades[0]);

  if (!mostRecentTrade) {
    return undefined;
  } else {
    return mostRecentTrade;
  }
};
