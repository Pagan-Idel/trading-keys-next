import { logToFileAsync } from "../../logger";

export interface Position {
  id: string;
  symbol: string;
  volume: string;
  side: 'BUY' | 'SELL';
  openTime: string;
  openPrice: string;
  stopLoss: string;
  takeProfit: string;
  swap: string;
  profit: string;
  netProfit: string;
  currentPrice: string;
  stopLossInMainWallet: string;
  takeProfitInMainWallet: string;
  commission: string;
  bidPrice: number;
  askPrice: number;
}
  
export interface OpenedPositionsResponseMT {
  positions: Position[];
}

export interface ErrorMTResponse {
  errorMessage: string;
}

// Function to fetch opened positions
export const openedPositionsMT = async (): Promise<OpenedPositionsResponseMT | ErrorMTResponse> => {
  let accountType = '';
  let tradingApiToken = '';
  let systemUuid = '';

  // Check if running in browser to access localStorage
  if (typeof window !== 'undefined') {
    accountType = localStorage.getItem('accountType') || '';
    tradingApiToken = localStorage.getItem('TRADING_API_TOKEN') || '';
    systemUuid = localStorage.getItem('SYSTEM_UUID') || '';
  }

  const apiEndpoint = '/api/match-trader/opened-positions';

  try {
    const response = await fetch(apiEndpoint, {
      method: 'GET',
      headers: {
        'TRADING_API_TOKEN': tradingApiToken,
        'SYSTEM_UUID': systemUuid,
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
      console.error('Opened Positions Failed:', errorResponse.errorMessage);
      return errorResponse;
    }

    let data: OpenedPositionsResponseMT;
    try {
      data = JSON.parse(rawResponseText);
    } catch (e) {
      console.error('Error parsing success response as JSON:', e);
      throw new Error(`Error: ${rawResponseText}`);
    }

    if (data.positions.length === 0) {
      let errorResponse: ErrorMTResponse = { errorMessage: "No Opened Positions" };
      console.error('No Opened Positions');
      return errorResponse;
    }

    return data;
  } catch (error) {
    console.error('An error occurred opening positions:', error);
    return { errorMessage: 'An unknown error occurred opening positions' } as ErrorMTResponse;
  }
};
