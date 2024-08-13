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
  const accountType = localStorage.getItem('accountType');
  const apiEndpoint = '/api/match-trader/balance';

  try {
    const response = await fetch(apiEndpoint, {
      method: 'GET',
      headers: {
        'TRADING_API_TOKEN': `${localStorage.getItem('TRADING_API_TOKEN')}`,
        'SYSTEM_UUID': `${localStorage.getItem('SYSTEM_UUID')}`,
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
      console.error('Market Watch failed:', errorResponse.errorMessage);
      return errorResponse;
    }

    let data: BalanceResponseMT;
    try {
      data = JSON.parse(rawResponseText);
    } catch (e) {
      console.error('Error parsing success response as JSON:', e);
      throw new Error(`Error: ${rawResponseText}`);
    }

    logToFileAsync('Market Match Successful');
  
    return data;
  } catch (error) {
    console.error('An error occurred during market watch:', error);
    return { errorMessage: 'An unknown error occurred during market watch' } as ErrorMTResponse;
  }
};
