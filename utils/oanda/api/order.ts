import { OrderParameters } from "../../../components/Keyboard";
import { logToFileAsync } from "../../logger";
import credentials from "../../../credentials.json";
import { RISK, calculalateRisk } from "../../shared";

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

export enum INSTRUMENT {
  EUR_USD = 'EUR_USD',
  GBP_USD = 'GPB_USD'
}

export interface ActionOnFill {
  price: string;
}

export interface MarketOrderRequest {
  type?: TYPE; 
  instrument?: INSTRUMENT;
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

// Helper function to safely access localStorage on the client side
const getLocalStorageItem = (key: string): string | null => {
  if (typeof window !== "undefined") {
    return localStorage.getItem(key);
  }
  return null;
};

export const order = async (orderType: OrderParameters): Promise<boolean> => {
  const accountType = getLocalStorageItem('accountType');
  const hostname = accountType === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
  const accountId = accountType === 'live' ? credentials.NEXT_PUBLIC_OANDA_LIVE_ACCOUNT_ID : credentials.NEXT_PUBLIC_OANDA_DEMO_ACCOUNT_ID;
  const token = accountType === 'live' ? credentials.NEXT_PUBLIC_OANDA_LIVE_ACCOUNT_TOKEN : credentials.NEXT_PUBLIC_OANDA_DEMO_ACCOUNT_TOKEN;
  // Check if the environment variable is set
  // Check if the environment variable is set
  if (!accountId || !hostname || !token) {
    logToFileAsync("Token or AccountId is not set.");
    return false;
  }
    const riskData: RISK | undefined = await calculalateRisk(orderType);
      // Check if the environment variable is set
    if (!riskData?.units || !riskData?.stopLoss || !riskData?.takeProfit) {
      logToFileAsync("Error Calculating Risk. No data found");
      return false;
    }
    const requestBody: OrderRequest = {
      order: {
        type: TYPE.MARKET, 
        instrument: INSTRUMENT.EUR_USD,
        units: `${orderType.action == ACTION.SELL ? `-` : ``}${riskData!.units}`,
        stopLossOnFill: { price: riskData!.stopLoss.toString() },
        takeProfitOnFill: { price: riskData!.takeProfit.toString() },
        timeInForce: "FOK"
      }
    };
    const apiUrl = `${hostname}/v3/accounts/${accountId}/orders`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept-Datetime-Format': 'RFC3339'
      },
      body: JSON.stringify({
        ...requestBody, // Merge additional body parameters if needed
      }),
    });
  
    if (!response.ok) {
      logToFileAsync(`HTTP error! Status: ${response.status}`);
      return false;
    }
  return true;
};