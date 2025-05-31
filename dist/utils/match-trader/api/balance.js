import { logToFileAsync } from "../../logger.js";
export const balanceMT = async (pair) => {
    if (typeof window === 'undefined') {
        return { errorMessage: 'localStorage is not available in the current environment.' };
    }
    const accountType = localStorage.getItem('accountType');
    const apiEndpoint = '/api/match-trader/balance';
    try {
        const response = await fetch(apiEndpoint, {
            method: 'GET',
            headers: {
                'TRADING_API_TOKEN': localStorage.getItem('TRADING_API_TOKEN') || '',
                'SYSTEM_UUID': localStorage.getItem('SYSTEM_UUID') || '',
                'Accept': 'application/json',
                'Hostname': accountType === 'demo' ? "https://demo.match-trader.com" : "https://mtr.gooeytrade.com"
                // 'Symbol': pair || '' // Uncomment if backend expects pair
            },
            credentials: 'include'
        });
        const rawResponseText = await response.text();
        if (!response.ok) {
            try {
                const errorResponse = JSON.parse(rawResponseText);
                console.error('Balance fetch failed:', errorResponse.errorMessage);
                return errorResponse;
            }
            catch (e) {
                throw new Error(`Error parsing error response: ${rawResponseText}`);
            }
        }
        const data = JSON.parse(rawResponseText);
        logToFileAsync(`✅ Balance fetch successful${pair ? ` for ${pair}` : ''}`);
        return data;
    }
    catch (error) {
        console.error(`❌ An error occurred while fetching balance${pair ? ` for ${pair}` : ''}:`, error);
        return { errorMessage: 'An unknown error occurred while fetching balance.' };
    }
};
