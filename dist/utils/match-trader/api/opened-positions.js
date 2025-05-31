// Function to fetch all or a specific pair's open position
export const openedPositionsMT = async (pair) => {
    let accountType = '';
    let tradingApiToken = '';
    let systemUuid = '';
    if (typeof window !== 'undefined') {
        accountType = localStorage.getItem('accountType') || '';
        tradingApiToken = localStorage.getItem('TRADING_API_TOKEN') || '';
        systemUuid = localStorage.getItem('SYSTEM_UUID') || '';
    }
    const apiEndpoint = '/api/match-trader/opened-positions';
    try {
        const response = await fetch(apiEndpoint, {
            method: 'GET',
            headers: {
                'TRADING_API_TOKEN': tradingApiToken,
                'SYSTEM_UUID': systemUuid,
                'Accept': 'application/json',
                'Hostname': accountType === 'demo'
                    ? 'https://demo.match-trader.com'
                    : 'https://mtr.gooeytrade.com'
            },
            credentials: 'include'
        });
        const rawResponseText = await response.text();
        if (!response.ok) {
            try {
                const errorResponse = JSON.parse(rawResponseText);
                console.error('Opened Positions Failed:', errorResponse.errorMessage);
                return errorResponse;
            }
            catch (e) {
                throw new Error(`Error parsing error response: ${rawResponseText}`);
            }
        }
        const data = JSON.parse(rawResponseText);
        if (!data.positions || data.positions.length === 0) {
            return { errorMessage: "No Opened Positions" };
        }
        // ✅ Filter by pair if provided
        if (pair) {
            const filtered = data.positions.filter(p => p.symbol === pair);
            if (filtered.length === 0) {
                return { errorMessage: `No Opened Position found for ${pair}` };
            }
            return { positions: filtered };
        }
        return data;
    }
    catch (error) {
        console.error('An error occurred fetching opened positions:', error);
        return { errorMessage: 'An unknown error occurred fetching opened positions' };
    }
};
