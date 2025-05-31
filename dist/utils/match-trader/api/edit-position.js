import { logToFileAsync } from "../../logger.js";
export const editPositionMT = async (requestBody) => {
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
                const errorResponse = JSON.parse(rawResponseText);
                console.error('Edit Position Failed:', errorResponse.errorMessage);
                return errorResponse;
            }
            catch (e) {
                throw new Error(`Error parsing error response: ${rawResponseText}`);
            }
        }
        const data = JSON.parse(rawResponseText);
        logToFileAsync(`✅ Edit Position Successful${requestBody?.instrument ? ` for ${requestBody.instrument}` : ''}`);
        return data;
    }
    catch (error) {
        console.error(`❌ Error editing position${requestBody?.instrument ? ` for ${requestBody.instrument}` : ''}:`, error);
        return { errorMessage: 'An unknown error occurred during editing position' };
    }
};
