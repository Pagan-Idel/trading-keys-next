import { logMessage } from "../../logger.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credentialsRaw = await fs.readFile(path.join(__dirname, '../../../credentials.json'), 'utf-8');
const credentials = JSON.parse(credentialsRaw);
// Import credentials.json at the top
import { loginMode } from "../../../runner/startRunner.js";
const getLocalStorageItem = (key) => {
    if (typeof window !== "undefined") {
        return localStorage.getItem(key);
    }
    return null;
};
export const handleOandaLogin = async (pair) => {
    const accountType = getLocalStorageItem('accountType') || loginMode || 'demo';
    const hostname = accountType === 'live'
        ? 'https://api-fxtrade.oanda.com'
        : 'https://api-fxpractice.oanda.com';
    const accountId = accountType === 'live'
        ? credentials.OANDA_LIVE_ACCOUNT_ID
        : credentials.OANDA_DEMO_ACCOUNT_ID;
    const token = accountType === 'live'
        ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
        : credentials.OANDA_DEMO_ACCOUNT_TOKEN;
    if (!token || !accountId) {
        logMessage("❌ Token or AccountId is not set.");
        throw new Error("Token or AccountId is not set.");
    }
    const accountListUrl = `${hostname}/v3/accounts`;
    const response2 = await fetch(accountListUrl, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    const responseData2 = await response2.json();
    logMessage("✅ /accounts list response", responseData2);
    const accountDetailsUrl = `${hostname}/v3/accounts/${accountId}`;
    const response = await fetch(accountDetailsUrl, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    if (!response.ok) {
        logMessage(`❌ HTTP error! Status: ${response.status}`);
        throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const responseData = await response.json();
    logMessage(`✅ Account details${pair ? ` for ${pair}` : ""}`, responseData);
    return responseData;
};
