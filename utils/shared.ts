import { OrderParameters } from '../components/Keyboard';
import { balanceMT, ErrorMTResponse } from './match-trader/api/balance';
import { marketWatchMT, MarketWatchResponseMT } from './match-trader/api/market-watch';
import { openPositionsMT } from './match-trader/api/open-positions';
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

export const calculateSLTPMT = (openPrice: string, orderSide: "BUY" | "SELL"): SLTPMT => {
  const stopLoss: number = parseFloat(localStorage.getItem('stopLoss')!);
  const takeProfit: number = stopLoss * 2;
  let tpPrice = orderSide == ACTION.BUY ? parseFloat((parseFloat(openPrice) + (pipIncrement * takeProfit)).toFixed(5)) : parseFloat((parseFloat(openPrice) - (pipIncrement * takeProfit)).toFixed(5));
  let slPrice = orderSide == ACTION.BUY ? parseFloat((parseFloat(openPrice) - (pipIncrement * stopLoss)).toFixed(5)) : parseFloat((parseFloat(openPrice) + (pipIncrement * stopLoss)).toFixed(5));
  console.log("OpenPrice", openPrice);
  console.log("TakeProfit Price", tpPrice);
  console.log("StopLoss Price", slPrice);
  return {slPrice, tpPrice};
}

export const calculateVolumeMT = async (risk: number): Promise<number | string> => {
  const stopLoss: number = parseFloat(localStorage.getItem('stopLoss')!);
  const balanceResponse = await balanceMT();

  if ('balance' in balanceResponse) {
    let balance: string = balanceResponse.balance;
    const pipValue = stopLoss * pipIncrement;

    // Calculate the initial risk amount
    const riskAmount = parseFloat(balance) * (risk / 100);

    // Adjusted to account for an average commision amount (6 lots * $7).
    const adjustedRiskAmount = riskAmount - 42;

    // Calculate the total commission based on the volume
    const volume = parseFloat((adjustedRiskAmount / pipValue / contractSize).toFixed(1));
    // const totalCommission = volume * commissionPerLot;

    // // Adjust the risk amount by subtracting the total commission
    // const adjustedRiskAmount = initialRiskAmount - totalCommission;

    // // Calculate the lot size to return
    // const lotSize = parseFloat((adjustedRiskAmount / pipValue / contractSize).toFixed(1));

    console.log("Balance", balance);
    console.log("Risk", risk);
    console.log("StopLoss", stopLoss);
    console.log("Pip Value", pipValue);
    console.log("Risk Amount", riskAmount);
    // console.log("Total Commission", totalCommission);
    // console.log("Adjusted Risk Amount", adjustedRiskAmount);
    console.log("Volume", volume);

    return volume;
  } else {
    return "No Volume!";
  }
};



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
