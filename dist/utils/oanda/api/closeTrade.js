import { ACTION } from ".";
import { logMessage } from "../../logger.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credentialsRaw = await fs.readFile(path.join(__dirname, '../../../credentials.json'), 'utf-8');
const credentials = JSON.parse(credentialsRaw);
import { recentTrade } from "../../shared.js";
import { loginMode } from '../../../runner/startRunner.js';
export const closeTrade = async (orderType, pair) => {
    let accountType = '';
    let accountId = '';
    let token = '';
    let hostname = '';
    if (typeof window !== 'undefined') {
        accountType = localStorage.getItem('accountType') || loginMode;
        hostname = accountType === 'live'
            ? 'https://api-fxtrade.oanda.com'
            : 'https://api-fxpractice.oanda.com';
        accountId = accountType === 'live'
            ? credentials.OANDA_LIVE_ACCOUNT_ID
            : credentials.OANDA_DEMO_ACCOUNT_ID;
        token = accountType === 'live'
            ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
            : credentials.OANDA_DEMO_ACCOUNT_TOKEN;
    }
    if (!accountId || !token) {
        logMessage("❌ Token or AccountId is not set.");
        return false;
    }
    const mostRecentTrade = await recentTrade(pair);
    if (!mostRecentTrade) {
        logMessage(`⚠️ No recent trade found${pair ? ` for ${pair}` : ""}.`);
        return false;
    }
    const partialClose = orderType.action === ACTION.PartialClose25 ? 0.24999999999 :
        orderType.action === ACTION.PartialClose50 ? 0.4999999999 :
            1;
    const initialUnitsString = mostRecentTrade.initialUnits;
    const initialUnitsWithoutNegative = initialUnitsString.replace('-', '');
    const partialUnits = (parseFloat(initialUnitsWithoutNegative) * partialClose).toFixed(0);
    const requestBody = orderType.action === ACTION.PartialClose25 || orderType.action === ACTION.PartialClose50
        ? { units: partialUnits }
        : {};
    const api = `${hostname}/v3/accounts/${accountId}/trades/${mostRecentTrade.id}/close`;
    try {
        const response = await fetch(api, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(requestBody),
        });
        const responseData = await response.json();
        if (!response.ok) {
            logMessage(`❌ HTTP error! Status: ${response.status}`);
            return false;
        }
        logMessage(`✅ Trade closed${pair ? ` for ${pair}` : ''}`, responseData);
        return responseData;
    }
    catch (error) {
        logMessage(`❌ Exception closing trade${pair ? ` for ${pair}` : ''}:`, error);
        return false;
    }
};
