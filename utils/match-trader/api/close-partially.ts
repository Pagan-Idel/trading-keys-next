import { openedPositionsMT, PositionsResponseMT } from "./opened-positions";

export interface ClosePositionResponseMT {
  status: 'OK' | 'REJECTED' | 'PARTIAL_SUCCESS';
  nativeCode: string | null;
  errorMessage: string | null;
}

export interface ClosePartialPositionMT {
  positionId: string; // Unique identifier for the position
  instrument: string; // shortcut name of instrument
  orderSide: string;  // side of trade: BUY or SELL
  isMobile: boolean;
  volume: number;    // amount of trade
}

export interface ErrorMTResponse {
  errorMessage: string;
}
    
  export const closePartiallyMT = async (partialAmount: number): Promise<ClosePartialPositionMT | ErrorMTResponse> => {
    let requestBody: ClosePartialPositionMT = {  
      positionId: "",
      instrument: "",
      orderSide: "",
      isMobile: false,
      volume: 0 
    };
    const apiEndpoint = '/api/match-trader/close-partially';
    
    try {
      const recentPosition: PositionsResponseMT | ErrorMTResponse = await openedPositionsMT();
      if ('errorMessage' in recentPosition) {
        console.error("Error Getting Recent Postion - ", recentPosition.errorMessage);
      } else {
        requestBody = {
            positionId: recentPosition.positions[recentPosition.positions.length - 1].id,         
            instrument: recentPosition.positions[recentPosition.positions.length - 1].symbol,     
            orderSide: recentPosition.positions[recentPosition.positions.length - 1].side,
            isMobile: false,
            volume: parseFloat((parseFloat(recentPosition.positions[recentPosition.positions.length - 1].volume) * partialAmount).toFixed(2))
        };
      }
    } catch (e) {
      console.error("Error Getting Recent Postion - ", e);
    } 
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
        console.error(`Close Partial Position Failed`, errorResponse.errorMessage);
        return errorResponse;
      }
  
      let data: ClosePartialPositionMT;
      try {
        data = JSON.parse(rawResponseText);
      } catch (e) {
        console.error('Error parsing success response as JSON:', e);
        throw new Error(`Error: ${rawResponseText}`);
      }
  
      console.log(`Close Partial Position Successful`);
    
      return data;
    } catch (error) {
      console.error(`An error occurred during Partial closing position:`, error);
      return { errorMessage: `An unknown error occurred during Partial closing postion` } as ErrorMTResponse;
    }
  };
  