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
  
export interface PositionsResponseMT {
  positions: Position[];
}

export interface ErrorMTResponse {
  errorMessage: string;
}
  
export const openedPositionsMT = async (): Promise<PositionsResponseMT | ErrorMTResponse> => {

  const apiEndpoint = '/api/match-trader/opened-positions';

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

    let data: PositionsResponseMT;
    try {
      data = JSON.parse(rawResponseText);
    } catch (e) {
      console.error('Error parsing success response as JSON:', e);
      throw new Error(`Error: ${rawResponseText}`);
    }

    console.log('Open Positon Successful');
  
    return data;
  } catch (error) {
    console.error('An error occurred opening position:', error);
    return { errorMessage: 'An unknown error occurred opening position' } as ErrorMTResponse;
  }
};
