import { logToFileAsync } from "../../logger";

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

export const editPositionMT = async (
  requestBody?: EditPositionRequestMT
): Promise<EditPositionRequestMT | ErrorMTResponse> => {
  if (typeof window === 'undefined') {
    return { errorMessage: 'localStorage is not available in the current environment.' };
  }

  const accountType = localStorage.getItem('accountType');
  const apiEndpoint = '/api/match-trader/edit-position';

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
        console.error('Edit Position Failed:', errorResponse.errorMessage);
        return errorResponse;
      } catch (e) {
        throw new Error(`Error parsing error response: ${rawResponseText}`);
      }
    }

    const data: EditPositionRequestMT = JSON.parse(rawResponseText);

    logToFileAsync(
      `✅ Edit Position Successful${requestBody?.instrument ? ` for ${requestBody.instrument}` : ''}`
    );

    return data;

  } catch (error) {
    console.error(
      `❌ Error editing position${requestBody?.instrument ? ` for ${requestBody.instrument}` : ''}:`,
      error
    );
    return { errorMessage: 'An unknown error occurred during editing position' };
  }
};
