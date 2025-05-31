// src/utils/TradeManager.ts
import { logMessage } from "./logger.js";
import { closeTradePartial } from "./oanda/api/close-partial.js";
import { currentPrice } from "./oanda/api/currentPrice.js";
import { modifyTrade } from "./oanda/api/modifyTrade.js";
import { openNow } from "./oanda/api/openNow.js";
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
            const market = await currentPrice(pair);
            if (!market)
                return;
            const price = parseFloat(orderSide === 'BUY' ? market.bid : market.ask);
            const midpoint = (tpPrice + openPrice) / 2;
            const nearTarget = orderSide === 'BUY'
                ? price >= midpoint && price <= openPrice + 0.9 * (tpPrice - openPrice)
                : price <= midpoint && price >= openPrice - 0.9 * (openPrice - tpPrice);
            if (nearTarget) {
                await closeTradePartial(0.30, pair);
                await modifyTrade({
                    action: ACTION.SLatEntry,
                    pair
                }, pair);
                ;
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
            const market = await currentPrice(pair);
            if (!market)
                return;
            const price = parseFloat(orderSide === 'BUY' ? market.bid : market.ask);
            const targetHit = orderSide === 'BUY'
                ? price >= openPrice + 0.9 * (tpPrice - openPrice)
                : price <= openPrice - 0.9 * (openPrice - tpPrice);
            if (targetHit) {
                await closeTradePartial(0.6, pair);
                const newSL = orderSide === 'BUY' ? price - pip * 3 : price + pip * 3;
                const newTP = orderSide === 'BUY' ? price + pip * 2 : price - pip * 2;
                const slMoves = Math.round(Math.abs(newSL - trade.slPrice) / pip);
                const tpMoves = Math.round(Math.abs(newTP - trade.tpPrice) / pip);
                for (let i = 0; i < tpMoves; i++) {
                    await modifyTrade({
                        action: ACTION.MoveTP,
                        action2: orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN,
                        pair
                    }, pair);
                    await wait(2000);
                }
                for (let i = 0; i < slMoves; i++) {
                    await modifyTrade({
                        action: ACTION.MoveSL,
                        action2: orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN,
                        pair
                    }, pair);
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
            const market = await currentPrice(pair);
            if (!market)
                return;
            const newPrice = parseFloat(orderSide === 'BUY' ? market.bid : market.ask);
            const improved = orderSide === 'BUY'
                ? newPrice > trade.lastPrice
                : newPrice < trade.lastPrice;
            if (improved) {
                const newSL = orderSide === 'BUY' ? newPrice - pip * 3 : newPrice + pip * 3;
                const newTP = orderSide === 'BUY' ? newPrice + pip * 2 : newPrice - pip * 2;
                const slMoves = Math.round(Math.abs(newSL - newPrice) / pip);
                const tpMoves = Math.round(Math.abs(newTP - newPrice) / pip);
                for (let i = 0; i < slMoves; i++) {
                    await modifyTrade({
                        action: ACTION.MoveSL,
                        action2: orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN,
                        pair
                    }, pair);
                    await wait(2000);
                }
                for (let i = 0; i < tpMoves; i++) {
                    await modifyTrade({
                        action: ACTION.MoveTP,
                        action2: orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN,
                        pair
                    }, pair);
                    await wait(2000);
                }
                this.trades.set(tradeId, { ...trade, lastPrice: newPrice });
            }
        }, 3000);
        this.tradeIntervals.set(tradeId, intervalId);
    }
    async checkIfPositionExists(tradeId) {
        const response = await openNow();
        if (!response || !response.trades)
            return false;
        return response.trades.some((t) => t.id === tradeId);
    }
}
