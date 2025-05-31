// src/strategy/logic/determineStrategySignal.ts
import { fetchCandles } from '../utils/oanda/api/fetchCandles.js';
import { determineSwingPoints } from '../utils/swingLabeler.js';
import { ACTION } from '../utils/oanda/api/order.js';
export const determineStrategySignal = async (pair) => {
    try {
        const dailyCandles = await fetchCandles(pair, 'D');
        const dailySwings = determineSwingPoints(dailyCandles);
        const lastThree = dailySwings.slice(-3).map(s => s.swing);
        const isValidPattern = (lastThree.join('-') === 'HH-BOS-LL' || lastThree.join('-') === 'LL-BOS-HH');
        if (!isValidPattern)
            return null;
        const dailyHigh = Math.max(...dailySwings.slice(-3).map(s => s.price));
        const dailyLow = Math.min(...dailySwings.slice(-3).map(s => s.price));
        const fib72 = dailyLow + (dailyHigh - dailyLow) * 0.72;
        const candles4H = await fetchCandles(pair, '4H');
        const swings4H = determineSwingPoints(candles4H);
        const pattern4H = swings4H.slice(-3).map(s => s.swing).join('-');
        const sameDirection = lastThree[2] === 'LL' ? 'LL-BOS-HH' : 'HH-BOS-LL';
        const priceNow = candles4H.at(-1)?.close ?? 0;
        if (pattern4H !== sameDirection)
            return null;
        const conditionMet = (sameDirection === 'LL-BOS-HH' && priceNow < fib72) ||
            (sameDirection === 'HH-BOS-LL' && priceNow > fib72);
        if (!conditionMet)
            return null;
        const candles1H = await fetchCandles(pair, '1H');
        const swings1H = determineSwingPoints(candles1H);
        const pattern1H = swings1H.slice(-3).map(s => s.swing).join('-');
        if (pattern1H !== sameDirection)
            return null;
        const oneHHigh = Math.max(...swings1H.slice(-3).map(s => s.price));
        const oneHLow = Math.min(...swings1H.slice(-3).map(s => s.price));
        const fib72_1H = oneHLow + (oneHHigh - oneHLow) * 0.72;
        const condition1H = (sameDirection === 'LL-BOS-HH' && priceNow < fib72_1H) ||
            (sameDirection === 'HH-BOS-LL' && priceNow > fib72_1H);
        if (!condition1H)
            return null;
        const candles15M = await fetchCandles(pair, '15M');
        const latest = candles15M.at(-1);
        const prev = candles15M.at(-2);
        if (!latest || !prev)
            return null;
        const isEngulfing = sameDirection === 'LL-BOS-HH'
            ? latest.close > prev.high
            : latest.close < prev.low;
        if (!isEngulfing)
            return null;
        const entryPrice = latest.close;
        const stopLoss = sameDirection === 'LL-BOS-HH' ? oneHLow : oneHHigh;
        const takeProfit = sameDirection === 'LL-BOS-HH' ? oneHHigh : oneHLow;
        const rr = Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss);
        if (rr < 3)
            return null;
        const action = sameDirection === 'LL-BOS-HH' ? ACTION.BUY : ACTION.SELL;
        return {
            pair,
            action,
            entryPrice,
            stopLoss,
            takeProfit,
        };
    }
    catch (err) {
        console.error(`❌ Strategy error for ${pair}:`, err);
        return null;
    }
};
