import { ACTION } from "../../oanda/api";
import { calculateRiskMT } from "../../shared";

  export interface OpenResponseMT {
    status: 'OK' | 'REJECTED' | 'PARTIAL_SUCCESS';
    nativeCode: string | null;
    errorMessage: string | null;
  }

  export interface OpenRequestMT {
    instrument: string;  // shortcut name of the instrument
    orderSide: 'BUY' | 'SELL';  // side of trade: BUY or SELL
    volume: number;  // amount of trade
    slPrice: number;  // stop-loss price: 0 if not set
    tpPrice: number;  // take-profit price: 0 if not set
    isMobile: boolean;  // request source: true if mobile, false if desktop
  }

  export interface ErrorMTResponse {
    errorMessage: string;
  }
    
  export const openMT = async (risk: number, orderSide: ACTION.BUY | ACTION.SELL): Promise<OpenResponseMT | ErrorMTResponse> => {

    const apiEndpoint = '/api/match-trader/open';
    let requestBody: OpenRequestMT = {
        instrument: "EURUSD",  // shortcut name of the instrument
        orderSide,  // side of trade: BUY or SELL
        volume : 0,  // amount of trade
        slPrice : 0,  // stop-loss price: 0 if not set
        tpPrice : 0,  // take-profit price: 0 if not set
        isMobile: false  // request source: true if mobile, false if desktop};
      };
    try {
        const result = await calculateRiskMT(risk, orderSide);
        // Check if the result is an error message
        if (typeof result === 'string') {
          console.error(result);
        }
    
        // Destructure the result
        const { volume, slPrice, tpPrice } = result;
        requestBody = {
            instrument: "EURUSD",  // shortcut name of the instrument
            orderSide: orderSide,  // side of trade: BUY or SELL
            volume: volume,  // amount of trade
            slPrice: slPrice,  // stop-loss price: 0 if not set
            tpPrice: tpPrice,  // take-profit price: 0 if not set
            isMobile: false  // request source: true if mobile, false if desktop};
          };
        console.log(`Volume: ${volume}, SL Price: ${slPrice}, TP Price: ${tpPrice}`);
      } catch (error) {
        console.error('An error occurred:', error);
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
        console.error('Market Watch failed:', errorResponse.errorMessage);
        return errorResponse;
      }
  
      let data: OpenResponseMT;
      try {
        data = JSON.parse(rawResponseText);
      } catch (e) {
        console.error('Error parsing success response as JSON:', e);
        throw new Error(`Error: ${rawResponseText}`);
      }
  
      console.log('Market Match Successful');
    
      return data;
    } catch (error) {
      console.error('An error occurred during market watch:', error);
      return { errorMessage: 'An unknown error occurred during market watch' } as ErrorMTResponse;
    }
  };
  