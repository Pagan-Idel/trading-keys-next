import { logToFileAsync } from "../../logger";
import { ACTION } from "../../oanda/api";
import { calculateSLTPMT, calculateVolumeMT, SLTPMT } from "../../shared";
import { TradeManager } from "../../trade-manager3";
import { editPositionMT, EditPositionRequestMT } from "./edit-position";
import { openedPositionsMT, OpenedPositionsResponseMT } from "./opened-positions";

export interface OpenPostionResponseMT {
  status: 'OK' | 'REJECTED' | 'PARTIAL_SUCCESS';
  nativeCode: string | null;
  errorMessage: string | null;
}

export interface OpenPositionRequestMT {
  instrument: string;  // shortcut name of the instrument
  orderSide: 'BUY' | 'SELL';  // side of trade: BUY or SELL
  volume: number;  // amount of trade
  slPrice: number;  // stop-loss price: 0 if not set
  tpPrice: number;  // take-profit price: 0 if not set
  isMobile: boolean;  // request source: true if mobile, false if desktop
}

export interface ErrorMTResponse {
  errorMessage: string;
}

export const openPostionMT = async (risk: number, orderSide: ACTION.BUY | ACTION.SELL): Promise<OpenPostionResponseMT | ErrorMTResponse> => {
  let accountType = '';
  let tradingApiToken = '';
  let systemUuid = '';

  // Only access localStorage if on the client-side
  if (typeof window !== 'undefined') {
    accountType = localStorage.getItem('accountType') || '';
    tradingApiToken = localStorage.getItem('TRADING_API_TOKEN') || '';
    systemUuid = localStorage.getItem('SYSTEM_UUID') || '';
  }

  const apiEndpoint = '/api/match-trader/open';
  let requestBody: OpenPositionRequestMT = {
    instrument: "EURUSD",  // default instrument for the example
    orderSide,  // side of trade: BUY or SELL
    volume: await calculateVolumeMT(risk) as number,  // calculate trade volume
    slPrice: 0,  // stop-loss price, set later
    tpPrice: 0,  // take-profit price, set later
    isMobile: false  // request source: desktop in this case
  };

  if (typeof requestBody.volume !== 'number') {
    console.error(`Invalid volume: ${requestBody.volume}`);
    return { errorMessage: 'Invalid volume' } as ErrorMTResponse;
  }

  // Store open volume in localStorage on the client-side
  if (typeof window !== 'undefined') {
    localStorage.setItem('openVolume', requestBody.volume.toString());
  }

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
      console.error('Open Trade Failed:', errorResponse.errorMessage);
      return errorResponse;
    }

    let data: OpenPostionResponseMT;
    try {
      data = JSON.parse(rawResponseText);
    } catch (e) {
      console.error('Error parsing success response as JSON:', e);
      throw new Error(`Error: ${rawResponseText}`);
    }

    logToFileAsync('Open Trade Successful');

    // Call openPositions to get the openPrice and id
    let positionResponse: OpenedPositionsResponseMT | ErrorMTResponse = await openedPositionsMT();
    if ('errorMessage' in positionResponse) {
      console.error('Error getting positions:', positionResponse.errorMessage);
      return positionResponse;
    }

    const positionsResponse = positionResponse as OpenedPositionsResponseMT;
    const latestPosition = positionsResponse.positions[0];
    const sltpPrices: SLTPMT = calculateSLTPMT(latestPosition.openPrice, latestPosition.side);

    try {
      // Call editPosition with the id and sltpPrices
      let requestEditBody: EditPositionRequestMT = {
        id: latestPosition.id,
        instrument: latestPosition.symbol,
        orderSide,  // side of trade: BUY or SELL
        volume: parseFloat(latestPosition.volume),  // amount of trade
        slPrice: sltpPrices.slPrice,  // stop-loss price
        tpPrice: sltpPrices.tpPrice,  // take-profit price
        isMobile: false  // request source: desktop
      };
      await editPositionMT(requestEditBody);

      // Get the singleton instance of TradeManager and start managing the trade
      const tradeManager = TradeManager.getInstance();
      tradeManager.start(latestPosition.id, sltpPrices.slPrice, sltpPrices.tpPrice, latestPosition.side, parseFloat(latestPosition.openPrice));
    } catch (e) {
      console.error('Error editing position:', e);
    }

    return { ...data }; // Merging the openPostionMT response with the editPosition response

  } catch (error) {
    console.error('An error occurred during opening position:', error);
    return { errorMessage: 'An unknown error occurred during opening position' } as ErrorMTResponse;
  }
};
