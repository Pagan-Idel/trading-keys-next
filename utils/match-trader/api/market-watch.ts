import { getCookieValue } from "../../shared";

  export interface BodyItem {
      symbol: string;
      bid: string;
      ask: string;
      change: string;
      high: string;
      low: string;
      timestampSec: number;
  }

  export interface MarketWatchResponseMT {
    body: BodyItem[];
  }
  export interface ErrorMTResponse {
    errorMessage: string;
  }

  export interface LoginMTRequest {
    email: string;
    password: string;
  }
    
  export const marketWatchMT = async (currency: string = "EURUSD"): Promise<MarketWatchResponseMT | ErrorMTResponse> => {

    const apiEndpoint = '/api/match-trader/market-watch';

    try {
      const response = await fetch(apiEndpoint, {
        method: 'GET',
        headers: {
          'TRADING_API_TOKEN': `${localStorage.getItem('TRADING_API_TOKEN')}`,
          'SYSTEM_UUID': `${localStorage.getItem('SYSTEM_UUID')}`,
          'Accept': 'application/json'
        },
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
  
      let data: MarketWatchResponseMT;
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
  