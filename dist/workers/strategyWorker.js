import { workerData } from "worker_threads";
import { fetchCandles } from "../utils/oanda/api/fetchCandles.js";
import { determineSwingPoints } from "../utils/swingLabeler.js";
import { placeTrade } from "../utils/oanda/placeTrade.js";
import { openNow } from "../utils/oanda/api/openNow.js";
import { logMessage } from "../utils/logger.js";
import { ACTION } from "../utils/oanda/api/order.js";
import { currentPrice } from "../utils/oanda/api/currentPrice.js";
import { wait } from "../utils/shared.js";
import { normalizeOandaSymbol } from "../utils/shared.js";
const runStrategyThread = async () => {
    const { pair } = workerData;
    const normalizedPair = normalizeOandaSymbol(pair);
    while (true) {
        try {
            // 1. Skip if trade already open for this pair
            const open = await openNow();
            const tradeAlreadyOpen = open?.trades?.some(t => normalizeOandaSymbol(t.instrument || '') === normalizedPair);
            if (tradeAlreadyOpen) {
                await logMessage(`🛑 Trade already open for ${pair}. Skipping.`);
                await wait(60 * 1000); // Wait 1 minute before rechecking
                continue;
            }
            // 2. Daily check
            await logMessage(`📆 Checking Daily structure for ${pair}`);
            const daily = await fetchCandles(pair, "D");
            const dailySwings = determineSwingPoints(daily);
            const lastThree = dailySwings.slice(-3);
            const lastPattern = lastThree.map(s => s.swing).join("-");
            if (lastPattern !== "LL-BOS-HH" && lastPattern !== "HH-BOS-LL") {
                await logMessage(`❌ No valid daily pattern for ${pair}`);
                await wait(60 * 60 * 1000); // Wait 1 hour before retrying
                continue;
            }
            const direction = lastPattern === "LL-BOS-HH" ? ACTION.BUY : ACTION.SELL;
            const dailyHigh = Math.max(...lastThree.map(s => s.price));
            const dailyLow = Math.min(...lastThree.map(s => s.price));
            const fib72 = dailyLow + (dailyHigh - dailyLow) * 0.72;
            // 3. Wait for 4H alignment
            let passed4H = false;
            while (!passed4H) {
                await logMessage(`⏳ Waiting for 4H setup for ${pair}`);
                const fourH = await fetchCandles(pair, "4H");
                const swings4H = determineSwingPoints(fourH);
                const last4H = swings4H.at(-1)?.swing;
                const match = direction === ACTION.BUY ? "LL" : "HH";
                if (last4H !== match) {
                    await wait(4 * 60 * 60 * 1000); // Wait 4 hours
                    continue;
                }
                const priceObj = await currentPrice(pair);
                const price = parseFloat(direction === ACTION.BUY ? priceObj.bid : priceObj.ask);
                if ((direction === ACTION.BUY && price < fib72) || (direction === ACTION.SELL && price > fib72)) {
                    passed4H = true;
                    break;
                }
                await wait(4 * 60 * 60 * 1000);
            }
            // 4. Wait for 1H alignment
            let passed1H = false;
            while (!passed1H) {
                await logMessage(`⏳ Waiting for 1H setup for ${pair}`);
                const oneH = await fetchCandles(pair, "1H");
                const swings1H = determineSwingPoints(oneH);
                const last1H = swings1H.at(-1)?.swing;
                const match = direction === ACTION.BUY ? "LL" : "HH";
                if (last1H !== match) {
                    await wait(60 * 60 * 1000); // Wait 1 hour
                    continue;
                }
                const priceObj = await currentPrice(pair);
                const price = parseFloat(direction === ACTION.BUY ? priceObj.bid : priceObj.ask);
                const oneHHigh = Math.max(...swings1H.slice(-3).map(s => s.price));
                const oneHLow = Math.min(...swings1H.slice(-3).map(s => s.price));
                const fib72_1H = oneHLow + (oneHHigh - oneHLow) * 0.72;
                if ((direction === ACTION.BUY && price < fib72_1H) || (direction === ACTION.SELL && price > fib72_1H)) {
                    passed1H = true;
                    break;
                }
                await wait(60 * 60 * 1000);
            }
            // 5. Wait for 15M engulf
            while (true) {
                await logMessage(`⏳ Waiting for 15M engulf for ${pair}`);
                const fifteen = await fetchCandles(pair, "15M");
                const prev = fifteen.at(-2);
                const latest = fifteen.at(-1);
                if (!prev || !latest) {
                    await wait(15 * 60 * 1000);
                    continue;
                }
                const engulf = direction === ACTION.BUY
                    ? latest.close > prev.high
                    : latest.close < prev.low;
                if (!engulf) {
                    await wait(15 * 60 * 1000);
                    continue;
                }
                // ✅ TRADE SIGNAL CONFIRMED
                const signal = {
                    pair,
                    action: direction,
                    entryPrice: latest.close,
                    stopLoss: direction === ACTION.BUY ? dailyLow : dailyHigh,
                    takeProfit: direction === ACTION.BUY ? dailyHigh : dailyLow
                };
                await logMessage(`🚀 Trade Signal Confirmed: ${JSON.stringify(signal)}`);
                await placeTrade(signal);
                return;
            }
        }
        catch (err) {
            await logMessage(`❌ Error in strategy thread for ${pair}: ${err.message}`);
            await wait(60 * 1000); // Recover after 1 min
        }
    }
};
runStrategyThread();
