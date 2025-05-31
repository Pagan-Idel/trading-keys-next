// src/utils/oanda/api/close-partial.ts
import { logMessage } from "../../logger.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credentialsRaw = await fs.readFile(path.join(__dirname, '../../../credentials.json'), 'utf-8');
const credentials = JSON.parse(credentialsRaw);
import { openNow } from "./openNow.js";
import { closeTrade } from "./closeTrade.js";
import { ACTION } from "./order.js";
export const closeTradePartial = async (partialAmount, pair) => {
    if (typeof window === "undefined") {
        return { errorMessage: "localStorage is not available in the current environment." };
    }
    const openTrades = await openNow(pair);
    if (!openTrades || openTrades.trades.length === 0) {
        return { errorMessage: `No open trade found for ${pair}` };
    }
    const trade = openTrades.trades[0]; // Assuming one open trade per pair
    const unitsStr = trade.currentUnits ?? trade.initialUnits;
    if (!unitsStr) {
        return { errorMessage: "Trade has no units defined." };
    }
    const direction = parseFloat(unitsStr) > 0 ? "BUY" : "SELL";
    const absUnits = Math.abs(parseFloat(unitsStr));
    const partialUnits = Math.floor(absUnits * partialAmount);
    if (partialUnits <= 0) {
        return { errorMessage: "Calculated partial units to close is zero." };
    }
    const action = {
        action: partialAmount >= 0.5 ? ACTION.PartialClose50 : ACTION.PartialClose25,
        pair
    };
    const result = await closeTrade(action, action.pair);
    if (!result || typeof result === "boolean") {
        return { errorMessage: "Failed to close partial trade." };
    }
    logMessage(`✅ Partial close (${partialAmount * 100}%) successful for ${pair}`);
    return result;
};
