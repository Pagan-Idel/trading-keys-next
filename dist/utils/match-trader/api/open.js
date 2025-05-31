import { logToFileAsync } from "../../logger.js";
import { calculateSLTPMT, calculateVolumeMT } from "../../shared.js";
import { TradeManager } from "../../trade-managerMT.js";
import { editPositionMT } from "./edit-position.js";
import { openedPositionsMT } from "./opened-positions.js";
export const openPostionMT = async (risk, orderSide, pair) => {
    let accountType = '';
    let tradingApiToken = '';
    let systemUuid = '';
    if (typeof window !== 'undefined') {
        accountType = localStorage.getItem('accountType') || '';
        tradingApiToken = localStorage.getItem('TRADING_API_TOKEN') || '';
        systemUuid = localStorage.getItem('SYSTEM_UUID') || '';
    }
    const apiEndpoint = '/api/match-trader/open';
    const volume = await calculateVolumeMT(risk, pair);
    if (typeof volume !== 'number' || volume <= 0) {
        console.error(`Invalid volume: ${volume}`);
        return { errorMessage: 'Invalid volume' };
    }
    const requestBody = {
        instrument: pair,
        orderSide,
        volume,
        slPrice: 0,
        tpPrice: 0,
        isMobile: false
    };
    if (typeof window !== 'undefined') {
        localStorage.setItem('openVolume', volume.toString());
    }
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
                const errorResponse = JSON.parse(rawResponseText);
                console.error('Open Trade Failed:', errorResponse.errorMessage);
                return errorResponse;
            }
            catch (e) {
                throw new Error(`Error parsing error response: ${rawResponseText}`);
            }
        }
        const data = JSON.parse(rawResponseText);
        logToFileAsync(`✅ Open Trade Successful for ${pair}`);
        const positionResponse = await openedPositionsMT();
        if ('errorMessage' in positionResponse) {
            console.error('Error getting positions:', positionResponse.errorMessage);
            return positionResponse;
        }
        const matchedPosition = positionResponse.positions.find(p => p.symbol === pair);
        if (!matchedPosition) {
            return { errorMessage: `Could not find open position for ${pair}` };
        }
        const sltpPrices = calculateSLTPMT(matchedPosition.openPrice, matchedPosition.side, pair);
        try {
            const requestEditBody = {
                id: matchedPosition.id,
                instrument: matchedPosition.symbol,
                orderSide,
                volume: parseFloat(matchedPosition.volume),
                slPrice: sltpPrices.slPrice,
                tpPrice: sltpPrices.tpPrice,
                isMobile: false
            };
            await editPositionMT(requestEditBody);
            const tradeManager = TradeManager.getInstance();
            tradeManager.start(matchedPosition.id, sltpPrices.slPrice, sltpPrices.tpPrice, matchedPosition.side, parseFloat(matchedPosition.openPrice), pair);
        }
        catch (e) {
            console.error('Error editing position:', e);
        }
        return data;
    }
    catch (error) {
        console.error(`❌ An error occurred during opening position for ${pair}:`, error);
        return { errorMessage: 'An unknown error occurred during opening position' };
    }
};
