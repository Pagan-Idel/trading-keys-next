import { fetchCandles } from './oanda/api/fetchCandles';
import { determineSwingPoints, Candle as SwingCandle } from './swingLabeler';
import { getPrecision, getPipIncrement } from '../utils/shared';
import { order, ACTION, TYPE } from '../utils/oanda/api/order';
import { OrderParameters } from '../components/Keyboard';
import { checkNews } from './oanda/api/checkNews';

export const evaluateStrategy = async (pair: string) => {
  try {
    // 1. Get 1D candles and swing labels
    const dailyCandles = await fetchCandles(pair, 'D');
    const dailySwings = determineSwingPoints(dailyCandles as SwingCandle[]);

    const lastThree = dailySwings.slice(-3).map(s => s.swing);
    const isValidPattern =
      (lastThree.join('-') === 'HH-BOS-LL' || lastThree.join('-') === 'LL-BOS-HH');

    if (!isValidPattern) return console.log("❌ No valid daily pattern found.");

    const dailyHigh = Math.max(...dailySwings.slice(-3).map(s => s.price));
    const dailyLow = Math.min(...dailySwings.slice(-3).map(s => s.price));

    const fib72 = dailyLow + (dailyHigh - dailyLow) * 0.72;

    // 2. Get 4H candles and wait for swing match in same direction
    const fourHCandles = await fetchCandles(pair, '4H');
    const fourHSwings = determineSwingPoints(fourHCandles as SwingCandle[]);
    const latestFourH = fourHSwings.slice(-3).map(s => s.swing).join('-');

    const sameDirection = lastThree[2] === 'LL' ? 'LL-BOS-HH' : 'HH-BOS-LL';
    const priceNow = parseFloat(fourHCandles.at(-1)?.close || '0');

    if (latestFourH !== sameDirection) return console.log("❌ 4H swing not in sync.");
    if (
      (sameDirection === 'LL-BOS-HH' && priceNow < fib72) ||
      (sameDirection === 'HH-BOS-LL' && priceNow > fib72)
    ) {
      // 3. Check 1H for same swing + fib zone
      const oneHCandles = await fetchCandles(pair, '1H');
      const oneHSwings = determineSwingPoints(oneHCandles as SwingCandle[]);
      const oneHPattern = oneHSwings.slice(-3).map(s => s.swing).join('-');

      if (oneHPattern !== sameDirection) return console.log("❌ 1H not aligned");

      const oneHHigh = Math.max(...oneHSwings.slice(-3).map(s => s.price));
      const oneHLow = Math.min(...oneHSwings.slice(-3).map(s => s.price));
      const fib72_1H = oneHLow + (oneHHigh - oneHLow) * 0.72;

      if (
        (sameDirection === 'LL-BOS-HH' && priceNow < fib72_1H) ||
        (sameDirection === 'HH-BOS-LL' && priceNow > fib72_1H)
      ) {
        // 4. Confirm engulfing 15M candle
        const fifteenCandles = await fetchCandles(pair, '15M');
        const latest = fifteenCandles.at(-1);
        const prev = fifteenCandles.at(-2);

        const isEngulfing =
          sameDirection === 'LL-BOS-HH'
            ? latest?.close > prev?.high
            : latest?.close < prev?.low;

        if (!isEngulfing) return console.log("❌ No 15m engulf");

        // 5. Check for red news
        const redNews = await checkNews(pair);
        if (redNews && redNews.some(n => n.time === latest?.time)) {
          return console.log("🚨 Red news within 1 hour, skipping trade.");
        }

        // 6. Check RR
        const entryPrice = parseFloat(latest.close);
        const sl = sameDirection === 'LL-BOS-HH' ? oneHLow : oneHHigh;
        const tp = sameDirection === 'LL-BOS-HH' ? oneHHigh : oneHLow;

        const slPips = Math.abs(entryPrice - sl);
        const tpPips = Math.abs(tp - entryPrice);
        if (tpPips / slPips < 3) return console.log("❌ RR not 1:3");

        // ✅ Place trade
        const orderType: OrderParameters = {
          action: sameDirection === 'LL-BOS-HH' ? ACTION.BUY : ACTION.SELL,
          risk: 1.0,
          orderType: TYPE.MARKET,
          pair
        };

        await order(orderType);
        console.log(`✅ Trade placed: ${orderType.action} ${pair}`);
      }
    }
  } catch (err) {
    console.error("🚫 Strategy execution failed:", err);
  }
};
