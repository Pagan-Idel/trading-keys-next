import { logToFileAsync } from "../../logger";


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
    
  export const editPositionMT = async (requestBody?: EditPositionRequestMT ): Promise<EditPositionRequestMT | ErrorMTResponse> => {
    const accountType = localStorage.getItem('accountType');
    const apiEndpoint = '/api/match-trader/edit-position';
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
        console.error('Edit Position Failed:', errorResponse.errorMessage);
        return errorResponse;
      }
  
      let data: EditPositionRequestMT;
      try {
        data = JSON.parse(rawResponseText);
      } catch (e) {
        console.error('Error parsing success response as JSON:', e);
        throw new Error(`Error: ${rawResponseText}`);
      }
  
      logToFileAsync('Edit Position Successful');
    
      return data;
    } catch (error) {
      console.error('An error occurred during editing position:', error);
      return { errorMessage: 'An unknown error occurred during editing postion' } as ErrorMTResponse;
    }
  };
  