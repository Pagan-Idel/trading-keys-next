import { logMessage } from "../../logger.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credentialsRaw = await fs.readFile(path.join(__dirname, '../../../credentials.json'), 'utf-8');
const credentials = JSON.parse(credentialsRaw);
import { loginMode } from '../../../runner/startRunner.js';
const getLocalStorageItem = (key) => {
    if (typeof window !== "undefined") {
        return localStorage.getItem(key);
    }
    return null;
};
export const openNow = async (pair) => {
    const accountType = getLocalStorageItem("accountType") || loginMode;
    const hostname = accountType === "live"
        ? "https://api-fxtrade.oanda.com"
        : "https://api-fxpractice.oanda.com";
    const accountId = accountType === "live"
        ? credentials.OANDA_LIVE_ACCOUNT_ID
        : credentials.OANDA_DEMO_ACCOUNT_ID;
    const token = accountType === "live"
        ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
        : credentials.OANDA_DEMO_ACCOUNT_TOKEN;
    if (!accountId || !token || !hostname) {
        logMessage("❌ Token or AccountId is not set.");
        return undefined;
    }
    const apiUrl = `${hostname}/v3/accounts/${accountId}/openTrades`;
    try {
        const response = await fetch(apiUrl, {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
        });
        if (!response.ok) {
            console.error(`❌ Error: ${response.status} - ${response.statusText}`);
            return undefined;
        }
        const responseData = await response.json();
        // ✅ If pair specified, filter the trades array
        if (pair) {
            const filteredTrades = responseData.trades.filter((t) => t.instrument === pair);
            return {
                lastTransactionID: responseData.lastTransactionID,
                trades: filteredTrades,
            };
        }
        return responseData;
    }
    catch (error) {
        console.error("❌ Error fetching open trades:", error);
        return undefined;
    }
};
