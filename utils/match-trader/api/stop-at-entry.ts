import { logToFileAsync } from "../../logger";
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

export const stopAtEntryMT = async (): Promise<EditPositionRequestMT | ErrorMTResponse> => {
  let accountType = '';
  let tradingApiToken = '';
  let systemUuid = '';

  // Check if running in browser to access localStorage
  if (typeof window !== 'undefined') {
    accountType = localStorage.getItem('accountType') || '';
    tradingApiToken = localStorage.getItem('TRADING_API_TOKEN') || '';
    systemUuid = localStorage.getItem('SYSTEM_UUID') || '';
  }

  const apiEndpoint = '/api/match-trader/edit-position';
  const recentPosition: OpenedPositionsResponseMT | ErrorMTResponse = await openedPositionsMT();

  if ('positions' in recentPosition) {
    const requestBody: EditPositionRequestMT = {
      id: recentPosition.positions[0].id,
      instrument: recentPosition.positions[0].symbol,
      orderSide: recentPosition.positions[0].side,
      volume: parseFloat(recentPosition.positions[0].volume),
      slPrice: parseFloat(recentPosition.positions[0].openPrice),
      tpPrice: parseFloat(recentPosition.positions[0].takeProfit),
      isMobile: false,
    };

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
        console.error('Stop At Entry Failed:', errorResponse.errorMessage);
        return errorResponse;
      }

      let data: EditPositionRequestMT;
      try {
        data = JSON.parse(rawResponseText);
      } catch (e) {
        console.error('Error parsing success response as JSON:', e);
        throw new Error(`Error: ${rawResponseText}`);
      }

      logToFileAsync('Stop At Entry Successful');
      return data;

    } catch (error) {
      console.error('An error occurred during moving stop loss at entry:', error);
      return { errorMessage: 'An unknown error occurred during moving stop loss at entry' } as ErrorMTResponse;
    }

  } else {
    console.error('Error getting positions - ', (recentPosition as ErrorMTResponse).errorMessage);
    return recentPosition as ErrorMTResponse;
  }
};
