// src/utils/trade-manager.ts
import { logMessage } from "./automationLogger.ts";
import { modifyTrade } from "./oanda/api/modifyTrade.ts";
import { openNow } from "./oanda/api/openNow.ts";
import { ACTION } from "./oanda/api/order.ts";
import { wait, getPipIncrement, normalizePairKeyUnderscore } from "./shared.ts";
import { fetchPriceOnce } from "./oanda/api/priceStreamManager.ts";

export class TradeManager {
  private static instance: TradeManager;
  public tradeIntervals: Map<string, NodeJS.Timeout> = new Map();
  private trades: Map<string, {
    slPrice?: number;
    tpPrice?: number;
    tpPriceOriginal?: number;
    orderSide?: "BUY" | "SELL";
    openPrice?: number;
    lastPrice?: number;
    inTrailing?: boolean;
    pair: string;
    tradeId?: string;
    farthestPriceRecorded?: number;
    lastTPMoveRequest?: number;
  }> = new Map();

  private constructor() {
    logMessage("TradeManager instance created.", undefined, { fileName: "logs" });
  }

  public static getInstance(): TradeManager {
    if (!TradeManager.instance) {
      TradeManager.instance = new TradeManager();
    }
    return TradeManager.instance;
  }

  public start(
    slPrice: number,
    tpPrice: number,
    orderSide: "BUY" | "SELL",
    openPrice: number,
    pair: string,
    tradeId?: string
  ) {
    if (this.tradeIntervals.has(pair)) return;

    this.trades.set(pair, {
      slPrice,
      tpPrice,
      tpPriceOriginal: tpPrice,
      orderSide,
      openPrice,
      inTrailing: false,
      lastPrice: 0,
      pair,
      tradeId,
      farthestPriceRecorded: openPrice
    });

    this.monitorUntilOriginalTP(pair);
  }

  public async resumeFromOpenTrades(pair: string) {
    logMessage("Resuming trade from OANDA", { pair }, { fileName: "logs" });

    const open = await openNow(pair);
    const tradeData = open?.trades?.find(t => Boolean(t.instrument) && normalizePairKeyUnderscore(t.instrument!) === normalizePairKeyUnderscore(pair));
    if (!tradeData) return;

    const slPrice = parseFloat(tradeData.stopLossOrder?.price || "0");
    const tpPrice = parseFloat(tradeData.takeProfitOrder?.price || "0");
    const openPrice = parseFloat(tradeData.price || "0");
    const orderSide = parseFloat(tradeData.currentUnits || "0") > 0 ? "BUY" : "SELL";

    this.trades.set(pair, {
      slPrice,
      tpPrice,
      tpPriceOriginal: tpPrice,
      orderSide,
      openPrice,
      inTrailing: false,
      lastPrice: 0,
      pair,
      tradeId: tradeData.id,
      farthestPriceRecorded: openPrice
    });

    this.monitorUntilOriginalTP(pair);
  }

  public async stop(pair: string) {
    for (const suffix of ["", "_tp_watch", "_sl_migrate", "_wait_breakaway", "_active_trailing"]) {
      const key = `${pair}${suffix}`;
      const interval = this.tradeIntervals.get(key);
      if (interval) clearInterval(interval);
      this.tradeIntervals.delete(key);
    }

    this.trades.delete(pair);
  }

  private monitorUntilOriginalTP(pair: string) {
    const intervalKey = `${pair}_tp_watch`;
    if (this.tradeIntervals.has(intervalKey)) return;

    const intervalId = setInterval(async () => {
      const trade = this.trades.get(pair);
      if (!trade) {
        logMessage("â›” No trade found in map", { pair }, { fileName: `manager_${pair.replace("/", "_")}` });
        return this.stop(pair);
      }

      const { orderSide, tpPriceOriginal } = trade;
      const pip = getPipIncrement(pair);

      const open = await openNow(pair);
      const liveTrade = open?.trades?.[0];
      if (!liveTrade) {
        logMessage("â›” No live trade from broker", { pair }, { fileName: `manager_${pair.replace("/", "_")}` });
        return this.stop(pair);
      }

      const actualTP = parseFloat(liveTrade.takeProfitOrder?.price || "0");
      logMessage("ðŸ“Š Live TP value from broker:", { pair, actualTP }, {
        fileName: `manager_${pair.replace("/", "_")}`
      });

      // Save original TP if not yet initialized
      if (!tpPriceOriginal) {
        this.trades.set(pair, {
          ...trade,
          tpPriceOriginal: actualTP,
          tpPrice: actualTP,
        });
        return;
      }

      const targetTP = orderSide === "BUY"
        ? tpPriceOriginal + pip * 10
        : tpPriceOriginal - pip * 10;

      const tpExtendedEnough = orderSide === "BUY"
        ? actualTP >= targetTP
        : actualTP <= targetTP;

      logMessage("ðŸ“¡ Checking TP extension status...", {
        pair,
        tpPriceOriginal,
        currentTP: trade.tpPrice,
        targetTP
      }, {
        fileName: `manager_${pair.replace("/", "_")}`
      });

      if (!tpExtendedEnough) {
        const remainingDistance = Math.abs(targetTP - actualTP);
        const pipsRemaining = Math.round(remainingDistance / pip);

        if (pipsRemaining > 0) {
          logMessage(`âž¡ï¸ Moving TP by 1 pip toward target (${pipsRemaining} pips remaining)`, {
            pair, actualTP, targetTP
          }, {
            fileName: `manager_${pair.replace("/", "_")}`
          });

          await modifyTrade({
            action: ACTION.MoveTP,
            action2: orderSide === "BUY" ? ACTION.UP : ACTION.DOWN,
            pair,
          }, pair);

          this.trades.set(pair, {
            ...trade,
            tpPrice: actualTP,
          });
        }
      } else {
        this.trades.set(pair, {
          ...trade,
          tpPrice: actualTP,
        });
      }

      // âœ… Check if we've hit the original TP
      const market = await fetchPriceOnce(pair);
      if (!market) return;

      const price = parseFloat(orderSide === "BUY" ? market.bid : market.ask);
      const hitTP = orderSide === "BUY"
        ? price >= tpPriceOriginal
        : price <= tpPriceOriginal;

      logMessage("ðŸŽ¯ Checking if price has hit original TP", {
        pair, currentPrice: price, originalTP: tpPriceOriginal, hitTP
      }, { fileName: `manager_${pair.replace("/", "_")}` });

      if (hitTP) {
        logMessage("ðŸŽ¯ Hit original TP, begin SL migration", { pair }, {
          fileName: `manager_${pair.replace("/", "_")}`
        });
        clearInterval(intervalId);
        this.tradeIntervals.delete(intervalKey);
        this.slowlyMoveSLToTP(pair, tpPriceOriginal);
      }
    }, 3000);

    this.tradeIntervals.set(intervalKey, intervalId);
  }

  private slowlyMoveSLToTP(pair: string, targetSL: number) {
    const intervalKey = `${pair}_sl_migrate`;
    if (this.tradeIntervals.has(intervalKey)) return;

    const intervalId = setInterval(async () => {
      const trade = this.trades.get(pair);
      if (!trade) {
        logMessage("â›” No trade found in map", { pair }, { fileName: `manager_${pair.replace("/", "_")}` });
        return this.stop(pair);
      }

      const { orderSide } = trade;
      const pip = getPipIncrement(pair);

      const stillExists = await this.checkIfPositionExists(pair);
      if (!stillExists) {
        logMessage("âŒ Trade no longer exists. Stopping SL migration.", { pair }, { fileName: `manager_${pair.replace("/", "_")}` });
        clearInterval(intervalId);
        this.tradeIntervals.delete(intervalKey);
        return this.stop(pair);
      }

      const open = await openNow(pair);
      const tradeInfo = open?.trades?.[0];
      const actualSL = parseFloat(tradeInfo?.stopLossOrder?.price || "0");

      const slReachedTarget = orderSide === "BUY"
        ? actualSL >= targetSL
        : actualSL <= targetSL;

      logMessage("ðŸ“‰ Live SL value from broker:", { pair, actualSL }, {
        fileName: `manager_${pair.replace("/", "_")}`
      });

      logMessage("ðŸ“¡ Checking SL migration status...", {
        pair,
        currentSL: actualSL,
        targetSL
      }, {
        fileName: `manager_${pair.replace("/", "_")}`
      });

      if (!slReachedTarget) {
        const remainingDistance = Math.abs(targetSL - actualSL);
        const pipsRemaining = Math.round(remainingDistance / pip);

        if (pipsRemaining > 0) {
          logMessage(`âž¡ï¸ Moving SL by 1 pip toward TP (${pipsRemaining} pips remaining)`, {
            pair, actualSL, targetSL
          }, {
            fileName: `manager_${pair.replace("/", "_")}`
          });

          await modifyTrade({
            action: ACTION.MoveSL,
            action2: orderSide === "BUY" ? ACTION.UP : ACTION.DOWN,
            pair,
          }, pair);
        }
      } else {
        logMessage("âœ… SL reached original TP. Awaiting breakaway.", { pair }, {
          fileName: `manager_${pair.replace("/", "_")}`
        });

        clearInterval(intervalId);
        this.tradeIntervals.delete(intervalKey);
        this.waitForBreakawayAndStartTrailing(pair);
      }
    }, 3000);

    this.tradeIntervals.set(intervalKey, intervalId);
  }

  private waitForBreakawayAndStartTrailing(pair: string) {
    const intervalKey = `${pair}_wait_breakaway`;
    if (this.tradeIntervals.has(intervalKey)) return;

    const trade = this.trades.get(pair);
    if (!trade) return;

    const { tpPriceOriginal, orderSide } = trade;
    const pip = getPipIncrement(pair);

    const intervalId = setInterval(async () => {
      logMessage("â³ Waiting for breakaway...", { pair }, {
        fileName: `manager_${pair.replace("/", "_")}`
      });

      const stillExists = await this.checkIfPositionExists(pair);
      if (!stillExists) {
        logMessage("âŒ Trade no longer exists. Exiting breakaway wait.", { pair }, {
          fileName: `manager_${pair.replace("/", "_")}`
        });
        clearInterval(intervalId);
        this.tradeIntervals.delete(intervalKey);
        return this.stop(pair);
      }

      const market = await fetchPriceOnce(pair);
      if (!market) return;

      const price = parseFloat(orderSide === "BUY" ? market.bid : market.ask);
      const target = orderSide === "BUY"
        ? tpPriceOriginal! + pip * 5
        : tpPriceOriginal! - pip * 5;

      const breakout = orderSide === "BUY" ? price >= target : price <= target;

      logMessage("ðŸ“ˆ Breakaway status check", {
        pair, currentPrice: price, targetBreakoutPrice: target, breakout
      }, {
        fileName: `manager_${pair.replace("/", "_")}`
      });

      if (breakout) {
        logMessage("ðŸš€ Breakaway confirmed. Start active trailing.", { pair }, {
          fileName: `manager_${pair.replace("/", "_")}`
        });
        clearInterval(intervalId);
        this.tradeIntervals.delete(intervalKey);
        this.startActiveTrailing(pair, price);
      }
    }, 3000);

    this.tradeIntervals.set(intervalKey, intervalId);
  }

  private startActiveTrailing(pair: string, initialPrice: number) {
    const intervalKey = `${pair}_active_trailing`;
    if (this.tradeIntervals.has(intervalKey)) return;

    const trade = this.trades.get(pair);
    if (!trade) return;

    const { orderSide } = trade;
    const pip = getPipIncrement(pair);
    let lastPrice = initialPrice;

    const intervalId = setInterval(async () => {
      logMessage("ðŸ”„ Active Trailing in progress...", { pair }, {
        fileName: `manager_${pair.replace("/", "_")}`
      });

      const stillExists = await this.checkIfPositionExists(pair);
      if (!stillExists) {
        logMessage("âŒ Trade closed during active trailing. Stopping.", { pair }, {
          fileName: `manager_${pair.replace("/", "_")}`
        });
        clearInterval(intervalId);
        this.tradeIntervals.delete(intervalKey);
        return this.stop(pair);
      }

      const market = await fetchPriceOnce(pair);
      if (!market) return;

      const price = parseFloat(orderSide === "BUY" ? market.bid : market.ask);
      const priceMoved = Math.abs(price - lastPrice);

      if (priceMoved >= pip) {
        logMessage("ðŸ“Š Trailing update triggered", {
          pair, oldPrice: lastPrice, newPrice: price, priceMoved
        }, {
          fileName: `manager_${pair.replace("/", "_")}`
        });

        await modifyTrade({ action: ACTION.MoveSL, action2: orderSide === "BUY" ? ACTION.UP : ACTION.DOWN, pair }, pair);
        await modifyTrade({ action: ACTION.MoveTP, action2: orderSide === "BUY" ? ACTION.UP : ACTION.DOWN, pair }, pair);

        logMessage("ðŸ” Trailed SL/TP by 1 pip.", { pair, updatedPrice: price }, {
          fileName: `manager_${pair.replace("/", "_")}`
        });

        lastPrice = price;
      }
    }, 3000);

    this.tradeIntervals.set(intervalKey, intervalId);
  }

  private async checkIfPositionExists(pair: string): Promise<boolean> {
    const response = await openNow(pair);
    if (!response || !response.trades) return false;

    return response.trades.some(
      (t) => Boolean(t.instrument) && normalizePairKeyUnderscore(t.instrument!) === normalizePairKeyUnderscore(pair)
    );
  }
}
