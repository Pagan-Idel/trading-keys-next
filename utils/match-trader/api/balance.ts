import { logToFileAsync } from "../../logger";

export interface BalanceResponseMT {
  balance: string;
  equity: string;
  margin: string;
  freeMargin: string;
  marginLevel: string;
  profit: string;
  netProfit: string;
  credit: string;
  currency: string;
}

export interface ErrorMTResponse {
  errorMessage: string;
}

export interface LoginMTRequest {
  email: string;
  password: string;
}

export const balanceMT = async (): Promise<BalanceResponseMT | ErrorMTResponse> => {
  // Ensure localStorage is only accessed on the client-side
  if (typeof window === 'undefined') {
    return { errorMessage: 'localStorage is not available in the current environment.' } as ErrorMTResponse;
  }

  const accountType = localStorage.getItem('accountType');
  const apiEndpoint = '/api/match-trader/balance';

  try {
    const response = await fetch(apiEndpoint, {
      method: 'GET',
      headers: {
        'TRADING_API_TOKEN': localStorage.getItem('TRADING_API_TOKEN') || '',
        'SYSTEM_UUID': localStorage.getItem('SYSTEM_UUID') || '',
        'Accept': 'application/json',
        'Hostname': accountType === 'demo' ? "https://demo.match-trader.com" : "https://mtr.gooeytrade.com"
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
      console.error('Balance fetch failed:', errorResponse.errorMessage);
      return errorResponse;
    }

    let data: BalanceResponseMT;
    try {
      data = JSON.parse(rawResponseText);
    } catch (e) {
      console.error('Error parsing success response as JSON:', e);
      throw new Error(`Error: ${rawResponseText}`);
    }

    logToFileAsync('Balance fetch successful');

    return data;
  } catch (error) {
    console.error('An error occurred while fetching balance:', error);
    return { errorMessage: 'An unknown error occurred while fetching balance.' } as ErrorMTResponse;
  }
};
