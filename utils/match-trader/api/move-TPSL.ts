import { logToFileAsync } from "../../logger";
import { ACTION } from "../../oanda/api";
import { getPipIncrement } from "../../shared";
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

export const moveTPSLMT = async (
  action: ACTION,
  action2: ACTION,
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
  const recentPosition = await openedPositionsMT();

  if ('errorMessage' in recentPosition) {
    console.error('Error getting positions:', recentPosition.errorMessage);
    return recentPosition;
  }

  const position = recentPosition.positions.find(p => p.symbol === pair);
  if (!position) {
    return { errorMessage: `No open position found for ${pair}` };
  }

  const pipIncrement = getPipIncrement(pair);

  const requestBody: EditPositionRequestMT = {
    id: position.id,
    instrument: position.symbol,
    orderSide: position.side,
    volume: parseFloat(position.volume),
    slPrice: action === ACTION.MoveSL
      ? (action2 === ACTION.DOWN
        ? parseFloat(position.stopLoss) - pipIncrement
        : parseFloat(position.stopLoss) + pipIncrement)
      : parseFloat(position.stopLoss),
    tpPrice: action === ACTION.MoveTP
      ? (action2 === ACTION.DOWN
        ? parseFloat(position.takeProfit) - pipIncrement
        : parseFloat(position.takeProfit) + pipIncrement)
      : parseFloat(position.takeProfit),
    isMobile: false
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
      try {
        const errorResponse: ErrorMTResponse = JSON.parse(rawResponseText);
        console.error('Moving SL/TP Failed:', errorResponse.errorMessage);
        return errorResponse;
      } catch (e) {
        throw new Error(`Error parsing error response: ${rawResponseText}`);
      }
    }

    const data: EditPositionRequestMT = JSON.parse(rawResponseText);
    logToFileAsync(`✅ SL/TP moved successfully for ${pair}`);
    return data;

  } catch (error) {
    console.error(`An error occurred during SL/TP adjustment for ${pair}:`, error);
    return { errorMessage: 'An unknown error occurred during moving SL/TP' };
  }
};
