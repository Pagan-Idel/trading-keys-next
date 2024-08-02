import { updateLanguageServiceSourceFile } from "typescript";
import { OrderParameters } from "../../../components/Keyboard";
import { RISK, calculalateRisk } from "../../shared";
import { OpenTrade, openNow } from "./openNow";

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
  PartialClose = 'PartialClose',
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



export const order = async (orderType: OrderParameters): Promise<boolean> => {
  const accountId = localStorage.getItem('accountId');
  const token = localStorage.getItem('token');
  const accountEnv = localStorage.getItem('accountEnv');
  // Check if the environment variable is set
  if (!accountId || !token || !accountEnv) {
    console.log("Token or AccountId is not set.");
    return false;
  }
    const riskData: RISK | undefined = await calculalateRisk(orderType);
      // Check if the environment variable is set
    if (!riskData?.units || !riskData?.stopLoss || !riskData?.takeProfit) {
      console.log("Error Calculating Risk. No data found");
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
    const apiUrl = `${accountEnv}/v3/accounts/${accountId}/orders`;

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
      console.log(`HTTP error! Status: ${response.status}`);
      return false;
    }
  return true;
};