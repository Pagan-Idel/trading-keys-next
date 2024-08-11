import { TradeManager } from "../../trade-manager2";
import { openedPositionsMT, OpenedPositionsResponseMT } from "./opened-positions";

export interface ClosePositionResponseMT {
status: 'OK' | 'REJECTED' | 'PARTIAL_SUCCESS';
nativeCode: string | null;
errorMessage: string | null;
}

export interface ClosePositionMT {
positionId: string; // Unique identifier for the position
instrument: string; // shortcut name of instrument
orderSide: string;  // side of trade: BUY or SELL
volume: string;   
}

export type ClosePositionsMT = ClosePositionMT[];

export interface ErrorMTResponse {
errorMessage: string;
}
  
export const closePositionMT = async (): Promise<ClosePositionsMT | ErrorMTResponse> => {
  let requestBody: ClosePositionsMT = [{  
    positionId: "",
    instrument: "",
    orderSide: "",
    volume: "" 
  }];
  const recentPosition: OpenedPositionsResponseMT | ErrorMTResponse = await openedPositionsMT();
  if ('positions' in recentPosition) {
    requestBody = [{
      positionId: recentPosition.positions[0].id,         
      instrument: recentPosition.positions[0].symbol,     
      orderSide: recentPosition.positions[0].side,
      volume: recentPosition.positions[0].volume
    }];
    const apiEndpoint = '/api/match-trader/close-position';
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'TRADING_API_TOKEN': `${localStorage.getItem('TRADING_API_TOKEN')}`,
          'SYSTEM_UUID': `${localStorage.getItem('SYSTEM_UUID')}`,
          'Accept': 'application/json'
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
        console.error(`Close Position Failed`, errorResponse.errorMessage);
        return errorResponse;
      }

    let data: ClosePositionsMT;
    try {
      data = JSON.parse(rawResponseText);
    } catch (e) {
      console.error('Error parsing success response as JSON:', e);
      throw new Error(`Error: ${rawResponseText}`);
    }

    try {
      const tradeManager = TradeManager.getInstance();
      tradeManager.stop(requestBody[0].positionId);
    } catch (e) {
      console.error('Error parsing success response as JSON:', e);
      throw new Error(`Error: ${rawResponseText}`);
    }

    console.log(`Close Position Successful`);
  
    return data;
    } catch (error) {
      console.error(`An error occurred during closing position:`, error);
      return { errorMessage: `An unknown error occurred during closing postion` } as ErrorMTResponse;
    }
  } else {
    console.error("Error Getting Recent Postion - ", recentPosition.errorMessage);
    return { errorMessage: recentPosition.errorMessage } as ErrorMTResponse;
  }
};
