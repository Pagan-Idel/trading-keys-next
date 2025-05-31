// src/utils/TradeManager.ts
import { logMessage } from "./logger.js";
import { closePartiallyMT } from "./match-trader/api/close-partially.js";
import { marketWatchMT } from "./match-trader/api/market-watch.js";
import { moveTPSLMT } from "./match-trader/api/move-TPSL.js";
import { openedPositionsMT } from "./match-trader/api/opened-positions.js";
import { stopAtEntryMT } from "./match-trader/api/stop-at-entry.js";
import { ACTION } from "./oanda/api/order.js";
import { wait, getPipIncrement, getPrecision } from "./shared.js";
export class TradeManager {
    constructor() {
        this.tradeIntervals = new Map();
        this.trades = new Map();
        logMessage("TradeManager instance created.");
    }
    static getInstance() {
        if (!TradeManager.instance) {
            TradeManager.instance = new TradeManager();
        }
        return TradeManager.instance;
    }
    start(tradeId, slPrice, tpPrice, orderSide, openPrice, pair) {
        if (this.tradeIntervals.has(tradeId))
            return;
        this.trades.set(tradeId, { slPrice, tpPrice, orderSide, openPrice, inTrailing: false, lastPrice: 0, pair });
        this.startTake50PercentProfit(tradeId);
    }
    stop(tradeId) {
        const intervalId = this.tradeIntervals.get(tradeId);
        if (intervalId) {
            clearInterval(intervalId);
            this.tradeIntervals.delete(tradeId);
            this.trades.delete(tradeId);
        }
    }
    startTake50PercentProfit(tradeId) {
        const intervalId = setInterval(async () => {
            const trade = this.trades.get(tradeId);
            if (!trade)
                return this.stop(tradeId);
            const positionExists = await this.checkIfPositionExists(tradeId);
            if (!positionExists)
                return this.stop(tradeId);
            const { tpPrice, orderSide, openPrice, pair } = trade;
            const market = await marketWatchMT(pair);
            if ('errorMessage' in market)
                return;
            const latest = market[market.length - 1];
            const price = parseFloat(orderSide === 'BUY' ? latest.bid : latest.ask);
            const midpoint = (tpPrice + openPrice) / 2;
            const nearTarget = orderSide === 'BUY'
                ? price >= midpoint && price <= openPrice + 0.9 * (tpPrice - openPrice)
                : price <= midpoint && price >= openPrice - 0.9 * (openPrice - tpPrice);
            if (nearTarget) {
                await closePartiallyMT(0.30, pair);
                await stopAtEntryMT(pair);
                this.startTakeAdditionalProfitAndTightenSL(tradeId);
                this.tradeIntervals.delete(tradeId);
                clearInterval(intervalId);
            }
        }, 3000);
        this.tradeIntervals.set(tradeId, intervalId);
    }
    startTakeAdditionalProfitAndTightenSL(tradeId) {
        const trade = this.trades.get(tradeId);
        if (!trade)
            return;
        const { pair, tpPrice, orderSide, openPrice } = trade;
        const pip = getPipIncrement(pair);
        const precision = getPrecision(pair);
        const intervalId = setInterval(async () => {
            const market = await marketWatchMT(pair);
            if ('errorMessage' in market)
                return;
            const latest = market[market.length - 1];
            const price = parseFloat(orderSide === 'BUY' ? latest.bid : latest.ask);
            const targetHit = orderSide === 'BUY'
                ? price >= openPrice + 0.9 * (tpPrice - openPrice)
                : price <= openPrice - 0.9 * (openPrice - tpPrice);
            if (targetHit) {
                await closePartiallyMT(0.6, pair);
                const newSL = orderSide === 'BUY' ? price - pip * 3 : price + pip * 3;
                const newTP = orderSide === 'BUY' ? price + pip * 2 : price - pip * 2;
                const slMoves = Math.round(Math.abs(newSL - trade.slPrice) / pip);
                const tpMoves = Math.round(Math.abs(newTP - trade.tpPrice) / pip);
                for (let i = 0; i < tpMoves; i++) {
                    await moveTPSLMT(ACTION.MoveTP, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN, pair);
                    await wait(2000);
                }
                for (let i = 0; i < slMoves; i++) {
                    await moveTPSLMT(ACTION.MoveSL, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN, pair);
                    await wait(2000);
                }
                this.startContinueTrailing(tradeId, price);
                this.tradeIntervals.delete(tradeId);
                clearInterval(intervalId);
            }
        }, 3000);
        this.tradeIntervals.set(tradeId, intervalId);
    }
    startContinueTrailing(tradeId, price) {
        const trade = this.trades.get(tradeId);
        if (!trade)
            return;
        const { pair, orderSide } = trade;
        const pip = getPipIncrement(pair);
        const precision = getPrecision(pair);
        trade.lastPrice = price;
        const intervalId = setInterval(async () => {
            const market = await marketWatchMT(pair);
            if ('errorMessage' in market)
                return;
            const latest = market[market.length - 1];
            const newPrice = parseFloat(orderSide === 'BUY' ? latest.bid : latest.ask);
            const improved = orderSide === 'BUY'
                ? newPrice > trade.lastPrice
                : newPrice < trade.lastPrice;
            if (improved) {
                const newSL = orderSide === 'BUY' ? newPrice - pip * 3 : newPrice + pip * 3;
                const newTP = orderSide === 'BUY' ? newPrice + pip * 2 : newPrice - pip * 2;
                const slMoves = Math.round(Math.abs(newSL - newPrice) / pip);
                const tpMoves = Math.round(Math.abs(newTP - newPrice) / pip);
                for (let i = 0; i < slMoves; i++) {
                    await moveTPSLMT(ACTION.MoveSL, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN, pair);
                    await wait(2000);
                }
                for (let i = 0; i < tpMoves; i++) {
                    await moveTPSLMT(ACTION.MoveTP, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN, pair);
                    await wait(2000);
                }
                this.trades.set(tradeId, { ...trade, lastPrice: newPrice });
            }
        }, 3000);
        this.tradeIntervals.set(tradeId, intervalId);
    }
    async checkIfPositionExists(tradeId) {
        const response = await openedPositionsMT();
        if ('errorMessage' in response)
            return false;
        return response.positions.some((p) => p.id === tradeId);
    }
}
