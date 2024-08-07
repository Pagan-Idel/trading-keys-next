import { ACTION } from "../../oanda/api";
import { calculateSLTPMT, calculateVolumeMT, SLTPMT } from "../../shared";
import { editPositionMT, EditPositionRequestMT } from "./edit-position";
import { openPositionsMT, PositionsResponseMT } from "./open-positions";

  export interface OpenResponseMT {
    status: 'OK' | 'REJECTED' | 'PARTIAL_SUCCESS';
    nativeCode: string | null;
    errorMessage: string | null;
  }

  export interface OpenRequestMT {
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
  
  export const openMT = async (risk: number, orderSide: ACTION.BUY | ACTION.SELL): Promise<OpenResponseMT | ErrorMTResponse> => {

    const apiEndpoint = '/api/match-trader/open';
    let requestBody: OpenRequestMT = {
      instrument: "EURUSD",  // shortcut name of the instrument
      orderSide,  // side of trade: BUY or SELL
      volume : await calculateVolumeMT(risk) as number,  // amount of trade
      slPrice : 0,  // stop-loss price: 0 if not set
      tpPrice : 0,  // take-profit price: 0 if not set
      isMobile: false  // request source: true if mobile, false if desktop};
    };
    try {
        // Check if the result is an error message
        if (typeof requestBody.volume != 'number') {
          console.error(requestBody.volume);
        }

      } catch (error) {
        console.error('An error occurred:', error);
      }

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'TRADING_API_TOKEN': `${localStorage.getItem('TRADING_API_TOKEN')}`,
          'SYSTEM_UUID': `${localStorage.getItem('SYSTEM_UUID')}`,
          'Accept': 'application/json'
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
  
      let data: OpenResponseMT;
      try {
        data = JSON.parse(rawResponseText);
      } catch (e) {
        console.error('Error parsing success response as JSON:', e);
        throw new Error(`Error: ${rawResponseText}`);
      }
  
      console.log('Open Trade Successful');

        // Call openPositions to get the openPrice and id
      let positionResponse : PositionsResponseMT | ErrorMTResponse = await openPositionsMT();
      if ('errorMessage' in positionResponse ) {
        console.error('Error fetching positions:', positionResponse .errorMessage);
        return positionResponse ;
      }

      const positionsResponse = positionResponse as PositionsResponseMT;
      const latestPosition = positionsResponse.positions[positionsResponse.positions.length - 1];
      const sltpPrices: SLTPMT = calculateSLTPMT(latestPosition.openPrice, latestPosition.side);

      try {
        // Call editPosition with the id and sltpPrices
        let requestEditBody: EditPositionRequestMT = {
          id: latestPosition.id,
          instrument: latestPosition.symbol,  // shortcut name of the instrument
          orderSide,  // side of trade: BUY or SELL
          volume : parseFloat(latestPosition.volume),  // amount of trade
          slPrice : sltpPrices.slPrice,  // stop-loss price: 0 if not set
          tpPrice : sltpPrices.tpPrice,  // take-profit price: 0 if not set
          isMobile: false  // request source: true if mobile, false if desktop};
        };
        await editPositionMT(requestEditBody);
       } catch (e) {
         console.error('Error editing position', e);
       }

      return { ...data }; // Merging the openMT response with editPosition response
    
    } catch (error) {
      console.error('An error occurred during opening postion:', error);
      return { errorMessage: 'An unknown error occurred during opening postion' } as ErrorMTResponse;
    }
  };
  