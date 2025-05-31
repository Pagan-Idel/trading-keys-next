// src/utils/oanda/api/order.ts
import { logMessage } from "../../logger.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credentialsRaw = await fs.readFile(path.join(__dirname, '../../../credentials.json'), 'utf-8');
const credentials = JSON.parse(credentialsRaw);
import { calculalateRisk, getPrecision, normalizeOandaSymbol } from "../../shared.js";
import { loginMode } from '../../../runner/startRunner.js';
export var TYPE;
(function (TYPE) {
    TYPE["MARKET"] = "MARKET";
    TYPE["LIMIT"] = "LIMIT";
    TYPE["STOP"] = "STOP";
    TYPE["MARKET_IF_TOUCHED"] = "MARKET_IF_TOUCHED";
    TYPE["TAKE_PROFIT"] = "TAKE_PROFIT";
    TYPE["STOP_LOSS"] = "STOP_LOSS";
    TYPE["GUARANTEED_STOP_LOSS"] = "GUARANTEED_STOP_LOSS";
    TYPE["TRAILING_STOP_LOSS"] = "TRAILING_STOP_LOSS";
    TYPE["FIXED_PRICE"] = "FIXED_PRICE";
})(TYPE || (TYPE = {}));
export var ACTION;
(function (ACTION) {
    ACTION["SELL"] = "SELL";
    ACTION["BUY"] = "BUY";
    ACTION["SLatEntry"] = "SLatEntry";
    ACTION["MoveSL"] = "MoveSL";
    ACTION["MoveTP"] = "MoveTP";
    ACTION["PartialClose50"] = "PartialClose50";
    ACTION["PartialClose25"] = "PartialClose25";
    ACTION["CLOSE"] = "Close";
    ACTION["UP"] = "Up";
    ACTION["DOWN"] = "Down";
})(ACTION || (ACTION = {}));
const getLocalStorageItem = (key) => {
    if (typeof window !== "undefined") {
        return localStorage.getItem(key);
    }
    return null;
};
export const order = async (orderType) => {
    const pair = orderType.pair;
    if (!pair) {
        logMessage("❌ Pair is not specified in orderType.");
        return false;
    }
    const normalizedPair = normalizeOandaSymbol(pair);
    const precision = getPrecision(pair);
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
    if (!accountId || !hostname || !token) {
        logMessage("❌ Token or AccountId is not set.");
        return false;
    }
    let units;
    let stopLoss = orderType.stopLoss;
    let takeProfit = orderType.takeProfit;
    if (!stopLoss || !takeProfit) {
        const riskData = await calculalateRisk(orderType, pair);
        if (!riskData?.units || !riskData?.stopLoss || !riskData?.takeProfit) {
            logMessage("❌ Error Calculating Risk. No data found");
            return false;
        }
        units = riskData.units;
        stopLoss = stopLoss ?? riskData.stopLoss;
        takeProfit = takeProfit ?? riskData.takeProfit;
    }
    else {
        const conservative = { ...orderType, risk: 0.25 };
        const riskData = await calculalateRisk(conservative, pair);
        if (!riskData?.units) {
            logMessage("❌ Error calculating units");
            return false;
        }
        units = riskData.units;
    }
    const requestBody = {
        order: {
            type: TYPE.MARKET,
            instrument: normalizedPair,
            units: `${orderType.action === ACTION.SELL ? '-' : ''}${units}`,
            stopLossOnFill: {
                price: parseFloat(stopLoss).toFixed(precision)
            },
            takeProfitOnFill: {
                price: parseFloat(takeProfit).toFixed(precision)
            },
            timeInForce: "FOK"
        }
    };
    const apiUrl = `${hostname}/v3/accounts/${accountId}/orders`;
    const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "Accept-Datetime-Format": "RFC3339"
        },
        body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
        const errorText = await response.text();
        logMessage(`❌ HTTP error! Status: ${response.status}`, errorText);
        return false;
    }
    return true;
};
