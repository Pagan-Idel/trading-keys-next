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
  let accountType = '';
  let tradingApiToken = '';
  let systemUuid = '';

  // Only access localStorage if on the client-side
  if (typeof window !== 'undefined') {
    accountType = localStorage.getItem('accountType') || '';
    tradingApiToken = localStorage.getItem('TRADING_API_TOKEN') || '';
    systemUuid = localStorage.getItem('SYSTEM_UUID') || '';
  }

  let requestBody: EditPositionRequestMT = {
    id: ""
  };

  const apiEndpoint = '/api/match-trader/edit-position';
  const recentPosition = await openedPositionsMT();

  // Check if recentPosition is an error response
  if ('errorMessage' in recentPosition) {
    console.error('Error getting positions:', recentPosition.errorMessage);
    return recentPosition;
  }

  if (recentPosition.positions.length > 0) {
    const position = recentPosition.positions[0];  // Use the first position for example purposes

    // Handle moving stop-loss (SL)
    if (action === ACTION.MoveSL) {
      requestBody = {
          id: position.id,
          instrument: position.symbol,
          orderSide: position.side,
          volume: parseFloat(position.volume),
          slPrice: action2 === ACTION.DOWN ? parseFloat(position.stopLoss) - pipIncrement : parseFloat(position.stopLoss) + pipIncrement,
          tpPrice: parseFloat(position.takeProfit),
          isMobile: false
      };
    }
    // Handle moving take-profit (TP)
    else if (action === ACTION.MoveTP) {
      requestBody = {
        id: position.id,
        instrument: position.symbol,
        orderSide: position.side,
        volume: parseFloat(position.volume),
        slPrice: parseFloat(position.stopLoss),
        tpPrice: action2 === ACTION.DOWN ? parseFloat(position.takeProfit) - pipIncrement : parseFloat(position.takeProfit) + pipIncrement,
        isMobile: false
      };
    }
    
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'TRADING_API_TOKEN': tradingApiToken,
          'SYSTEM_UUID': systemUuid,
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

      console.log('Moving SL/TP Successful');
      return data;
    } catch (error) {
      console.error('An error occurred during moving SL/TP position:', error);
      return { errorMessage: 'An unknown error occurred during moving SL/TP' } as ErrorMTResponse;
    }
  } else {
    console.error('No positions available');
    return { errorMessage: 'No positions available' } as ErrorMTResponse;
  }
};
