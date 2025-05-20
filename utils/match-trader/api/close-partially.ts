import { logToFileAsync } from "../../logger";
import { openedPositionsMT, OpenedPositionsResponseMT } from "./opened-positions";

export interface ClosePositionResponseMT {
  status: 'OK' | 'REJECTED' | 'PARTIAL_SUCCESS';
  nativeCode: string | null;
  errorMessage: string | null;
}

export interface ClosePartialPositionMT {
  positionId: string;
  instrument: string;
  orderSide: string;
  isMobile: boolean;
  volume: number;
}

export interface ErrorMTResponse {
  errorMessage: string;
}

export const closePartiallyMT = async (
  partialAmount: number,
  pair: string
): Promise<ClosePartialPositionMT | ErrorMTResponse> => {
  if (typeof window === 'undefined') {
    return { errorMessage: 'localStorage is not available in the current environment.' };
  }

  const accountType = localStorage.getItem('accountType');
  const recentPosition: OpenedPositionsResponseMT | ErrorMTResponse = await openedPositionsMT();

  if ('positions' in recentPosition) {
    const matched = recentPosition.positions.find(p => p.symbol === pair);
    if (!matched) {
      return { errorMessage: `No open position found for ${pair}` };
    }

    const openVolume = parseFloat(matched.volume);
    if (isNaN(openVolume) || openVolume <= 0) {
      return { errorMessage: `Invalid open volume for ${pair}` };
    }

    const requestBody: ClosePartialPositionMT = {
      positionId: matched.id,
      instrument: matched.symbol,
      orderSide: matched.side,
      isMobile: false,
      volume: parseFloat((openVolume * partialAmount).toFixed(2))
    };

    const apiEndpoint = '/api/match-trader/close-partially';

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'TRADING_API_TOKEN': localStorage.getItem('TRADING_API_TOKEN') || '',
          'SYSTEM_UUID': localStorage.getItem('SYSTEM_UUID') || '',
          'Accept': 'application/json',
          'Hostname': accountType === 'demo' ? "https://demo.match-trader.com" : "https://mtr.gooeytrade.com"
        },
        body: JSON.stringify(requestBody),
        credentials: 'include'
      });

      const rawResponseText = await response.text();

      if (!response.ok) {
        try {
          const errorResponse: ErrorMTResponse = JSON.parse(rawResponseText);
          console.error(`Close Partial Position Failed`, errorResponse.errorMessage);
          return errorResponse;
        } catch (e) {
          throw new Error(`Error parsing error response: ${rawResponseText}`);
        }
      }

      const data: ClosePartialPositionMT = JSON.parse(rawResponseText);

      logToFileAsync(`✅ Close Partial Position Successful for ${pair}`);
      return data;

    } catch (error) {
      console.error(`❌ Error during partial close for ${pair}:`, error);
      return { errorMessage: `An unknown error occurred during partial close for ${pair}` };
    }

  } else {
    console.error("Error Getting Recent Position - ", recentPosition.errorMessage);
    return { errorMessage: recentPosition.errorMessage };
  }
};
