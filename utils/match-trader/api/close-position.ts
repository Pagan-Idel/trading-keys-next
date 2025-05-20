import { logToFileAsync } from "../../logger";
import { TradeManager } from "../../trade-manager";
import { openedPositionsMT, OpenedPositionsResponseMT } from "./opened-positions";

export interface ClosePositionResponseMT {
  status: 'OK' | 'REJECTED' | 'PARTIAL_SUCCESS';
  nativeCode: string | null;
  errorMessage: string | null;
}

export interface ClosePositionMT {
  positionId: string;
  instrument: string;
  orderSide: string;
  volume: string;
}

export type ClosePositionsMT = ClosePositionMT[];

export interface ErrorMTResponse {
  errorMessage: string;
}

export const closePositionMT = async (pair: string): Promise<ClosePositionsMT | ErrorMTResponse> => {
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

    const requestBody: ClosePositionsMT = [{
      positionId: matched.id,
      instrument: matched.symbol,
      orderSide: matched.side,
      volume: matched.volume
    }];

    const apiEndpoint = '/api/match-trader/close-position';

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
          console.error(`Close Position Failed`, errorResponse.errorMessage);
          return errorResponse;
        } catch (e) {
          throw new Error(`Error parsing error response: ${rawResponseText}`);
        }
      }

      const data: ClosePositionsMT = JSON.parse(rawResponseText);

      try {
        const tradeManager = TradeManager.getInstance();
        tradeManager.stop(matched.id);
      } catch (e) {
        console.error('Error stopping trade manager:', e);
        throw new Error(`Error: ${rawResponseText}`);
      }

      logToFileAsync(`✅ Close Position Successful for ${pair}`);
      return data;

    } catch (error) {
      console.error(`❌ Error closing position:`, error);
      return { errorMessage: `An unknown error occurred during closing position for ${pair}` };
    }

  } else {
    console.error("Error Getting Recent Position - ", recentPosition.errorMessage);
    return { errorMessage: recentPosition.errorMessage };
  }
};
