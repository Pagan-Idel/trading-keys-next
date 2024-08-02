import { OrderParameters } from '../components/Keyboard';
import { ACTION, INSTRUMENT, OpenTrade, Trade, handleOandaLogin, currentPrice, openNow } from './oanda/api'; 

export const pipIncrement: number = 0.0001;
export const contractSize: number = 100000;

export interface RISK {
  units: string;
  takeProfit: string;
  stopLoss: string;
}

export interface SLatEntry {
 orderId: string;
 entryPrice: string;
}

export const calculalateRisk = async (orderType: OrderParameters): Promise<RISK | undefined> => {
  const stopLoss: number = parseFloat(localStorage.getItem('stopLoss')!);
  const takeProfit: number = stopLoss * 2;
  try {
    const riskResponse: RISK = {
      units: "0",
      takeProfit: "0",
      stopLoss: "0"
    };
    const { account } = await handleOandaLogin();
   // Check if the environment variable is set
   if (!account) {
    throw new Error("Token or AccountId is not set.");
  }
    const { ask, bid} = await currentPrice(INSTRUMENT.EUR_USD);
    console.log("account", account);
    const a = parseFloat(account.balance) * ( orderType.risk! / 100 );
    const b = stopLoss * pipIncrement;
    const units = a / b;
    riskResponse.units = units.toFixed(0);
    riskResponse.takeProfit = orderType.action == ACTION.BUY ? (parseFloat(ask) + (pipIncrement * takeProfit)).toFixed(5) : (parseFloat(bid) - (pipIncrement * takeProfit)).toFixed(5);
    riskResponse.stopLoss = orderType.action == ACTION.BUY ? (parseFloat(ask) - (pipIncrement * stopLoss)).toFixed(5) : (parseFloat(bid) + (pipIncrement * stopLoss)).toFixed(5);
    console.log("Balance", account.balance);
    console.log("Risk", orderType.risk!);
    console.log("stopLoss", stopLoss);
    console.log("pipIncrement", pipIncrement);
    console.log("a", a);
    console.log("b", b);
    console.log("Units", riskResponse.units);
    console.log("TakeProfit Price", riskResponse.takeProfit);
    console.log("StopLoss Price", riskResponse.stopLoss);
    return riskResponse;
  } catch (error: any) {
    // Log any errors that occur during the process
    console.error('Error fetching account information:', error.message);
    return undefined;
  }
};

export const recentTrade = async (): Promise<Trade | undefined> => {
  const openTrades: OpenTrade | undefined = await openNow();
  if (!openTrades) {
    console.log("No response from openTrades()");
  }
  const trades = openTrades!.trades;
  if (!trades || trades.length === 0) {
    console.log("No trades available");
  }

  // Find the trade with the latest openTime
  let mostRecentTrade: Trade = trades.reduce((prevTrade, currentTrade) => {
    // Ensure that openTime is defined for both trades
    if (prevTrade.openTime && currentTrade.openTime) {
      const prevTime = new Date(prevTrade.openTime).getTime();
      const currentTime = new Date(currentTrade.openTime).getTime();
      return prevTime > currentTime ? prevTrade : currentTrade;
    } else if (prevTrade.openTime) {
      // Handle the case where currentTrade.openTime is undefined
      return prevTrade;
    } else if (currentTrade.openTime) {
      // Handle the case where prevTrade.openTime is undefined
      return currentTrade;
    } else {
      // Handle the case where both openTime values are undefined
      return prevTrade; // or currentTrade, depending on your requirements
    }
  }, trades[0]); // Set an initial value to avoid issues with empty trades array
  if (!mostRecentTrade) {;
    return undefined;
  } else {
  return mostRecentTrade;
  }
}

export const getCookieValue = (name: string) => {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
      const [cookieName, cookieValue] = cookie.trim().split('=');
      if (cookieName === name) {
          return cookieValue;
      }
  }
  return null;
}