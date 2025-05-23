import { logToFileAsync } from "../../logger";
import { openedPositionsMT, OpenedPositionsResponseMT } from "./opened-positions";

export interface EditPositionResponseMT {
  status: 'OK' | 'REJECTED' | 'PARTIAL_SUCCESS';
  nativeCode: string | null;
  errorMessage: string | null;
}

export interface EditPositionRequestMT {
  id: string;
  instrument?: string;
  orderSide?: 'BUY' | 'SELL';
  volume?: number;
  slPrice?: number;
  tpPrice?: number;
  isMobile?: boolean;
}

export interface ErrorMTResponse {
  errorMessage: string;
}

export const stopAtEntryMT = async (
  pair: string
): Promise<EditPositionRequestMT | ErrorMTResponse> => {
  let accountType = '';
  let tradingApiToken = '';
  let systemUuid = '';

  if (typeof window !== 'undefined') {
    accountType = localStorage.getItem('accountType') || '';
    tradingApiToken = localStorage.getItem('TRADING_API_TOKEN') || '';
    systemUuid = localStorage.getItem('SYSTEM_UUID') || '';
  }

  const apiEndpoint = '/api/match-trader/edit-position';
  const recentPosition = await openedPositionsMT(pair);

  if ('positions' in recentPosition) {
    const position = recentPosition.positions[0];

    const requestBody: EditPositionRequestMT = {
      id: position.id,
      instrument: position.symbol,
      orderSide: position.side,
      volume: parseFloat(position.volume),
      slPrice: parseFloat(position.openPrice),
      tpPrice: parseFloat(position.takeProfit),
      isMobile: false
    };

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'TRADING_API_TOKEN': tradingApiToken,
          'SYSTEM_UUID': systemUuid,
          'Accept': 'application/json',
          'Hostname': accountType === 'demo'
            ? "https://demo.match-trader.com"
            : "https://mtr.gooeytrade.com"
        },
        body: JSON.stringify(requestBody),
        credentials: 'include'
      });

      const rawResponseText = await response.text();
      if (!response.ok) {
        try {
          const errorResponse: ErrorMTResponse = JSON.parse(rawResponseText);
          console.error('Stop At Entry Failed:', errorResponse.errorMessage);
          return errorResponse;
        } catch (e) {
          throw new Error(`Error parsing error response: ${rawResponseText}`);
        }
      }

      const data: EditPositionRequestMT = JSON.parse(rawResponseText);
      logToFileAsync(`✅ Stop At Entry Successful for ${pair}`);
      return data;

    } catch (error) {
      console.error(`❌ Error during stop at entry for ${pair}:`, error);
      return { errorMessage: 'An unknown error occurred during moving stop loss at entry' };
    }

  } else {
    console.error(`Error getting position for ${pair}:`, recentPosition.errorMessage);
    return recentPosition;
  }
};
