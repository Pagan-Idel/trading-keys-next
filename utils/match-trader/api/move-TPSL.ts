
import { logToFileAsync } from "../../logger";
import { ACTION } from "../../oanda/api";
import { pipIncrement } from "../../shared";
import { openedPositionsMT, OpenedPositionsResponseMT } from "./opened-positions";

export interface EditPositionResponseMT {
  status: 'OK' | 'REJECTED' | 'PARTIAL_SUCCESS';
  nativeCode: string | null;
  errorMessage: string | null;
}

export interface EditPositionRequestMT {
  id: string;
  instrument?: string;  // shortcut name of the instrument
  orderSide?: 'BUY' | 'SELL';  // side of trade: BUY or SELL
  volume?: number;  // amount of trade
  slPrice?: number;  // stop-loss price: 0 if not set
  tpPrice?: number;  // take-profit price: 0 if not set
  isMobile?: boolean;  // request source: true if mobile, false if desktop
}

export interface ErrorMTResponse {
  errorMessage: string;
}
  
export const moveTPSLMT = async (action: ACTION, action2: ACTION): Promise<EditPositionRequestMT | ErrorMTResponse> => {
  const accountType = localStorage.getItem('accountType');
  let requestBody: EditPositionRequestMT = {
    id: ""
  };
  const apiEndpoint = '/api/match-trader/edit-position';
  const recentPosition: OpenedPositionsResponseMT | ErrorMTResponse = await openedPositionsMT();
  if ('positions' in recentPosition) {
    if (action == ACTION.MoveSL) {
      requestBody = {
          id: recentPosition.positions[0].id,
          instrument: recentPosition.positions[0].symbol,
          orderSide: recentPosition.positions[0].side, 
          volume: parseFloat(recentPosition.positions[0].volume), 
          slPrice: action2 == ACTION.DOWN ? parseFloat(recentPosition.positions[0].stopLoss) - pipIncrement : parseFloat(recentPosition.positions[0].stopLoss) + pipIncrement,  
          tpPrice: parseFloat(recentPosition.positions[0].takeProfit),
          isMobile: false
      };
    } else if (action == ACTION.MoveTP) {
      requestBody = {
        id: recentPosition.positions[0].id,
        instrument: recentPosition.positions[0].symbol,
        orderSide: recentPosition.positions[0].side, 
        volume: parseFloat(recentPosition.positions[0].volume), 
        slPrice: parseFloat(recentPosition.positions[0].stopLoss),  
        tpPrice: action2 == ACTION.DOWN ? parseFloat(recentPosition.positions[0].takeProfit) - pipIncrement : parseFloat(recentPosition.positions[0].takeProfit) + pipIncrement,
        isMobile: false
      };
    };
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'TRADING_API_TOKEN': `${localStorage.getItem('TRADING_API_TOKEN')}`,
          'SYSTEM_UUID': `${localStorage.getItem('SYSTEM_UUID')}`,
          'Accept': 'application/json',
          'Hostname': accountType === 'demo' ? "https://demo.match-trader.com" : "https://mtr.gooeytrade.com"
        },
        body: JSON.stringify(requestBody),
        credentials: 'include'
      });

      const rawResponseText = await response.text();
      if (!response.ok) {
        let errorResponse: ErrorMTResponse;
        try {
          errorResponse = JSON.parse(rawResponseText);
        } catch (e) {
          console.error('Error parsing error response as JSON:', e);
          throw new Error(`Error: ${rawResponseText}`);
        }
        console.error('Moving SL/TP Failed:', errorResponse.errorMessage);
        return errorResponse;
      }

      let data: EditPositionRequestMT;
      try {
        data = JSON.parse(rawResponseText);
      } catch (e) {
        console.error('Error parsing success response as JSON:', e);
        throw new Error(`Error: ${rawResponseText}`);
      }

      logToFileAsync('Moving SL/TP Successful');
    
      return data;
    } catch (error) {
      console.error('An error occurred during moving SL/TP position:', error);
      return { errorMessage: 'An unknown error occurred during moving SL/TP' } as ErrorMTResponse;
    }
  } else {
    console.error('Error getting positions:', recentPosition.errorMessage);
    return recentPosition ;
  }
};
