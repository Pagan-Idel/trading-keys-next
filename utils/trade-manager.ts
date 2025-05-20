import { logToFileAsync } from "./logger";
import { closePartiallyMT } from "./match-trader/api/close-partially";
import { marketWatchMT, MarketWatchResponseMT, ErrorMTResponse } from "./match-trader/api/market-watch";
import { moveTPSLMT } from "./match-trader/api/move-TPSL";
import { openedPositionsMT, OpenedPositionsResponseMT, Position } from "./match-trader/api/opened-positions";
import { stopAtEntryMT } from "./match-trader/api/stop-at-entry";
import { ACTION } from "./oanda/api";
import { wait } from "./shared";

export class TradeManager {
  private static instance: TradeManager;
  private tradeIntervals: Map<string, NodeJS.Timeout> = new Map();
  private trades: Map<string, {
    pair: string;
    slPrice?: number;
    tpPrice?: number;
    orderSide?: 'BUY' | 'SELL';
    openPrice?: number;
    inTrailing?: boolean;
    lastPrice?: number;
  }> = new Map();

  private constructor() {
    logToFileAsync("TradeManager instance created.");
  }

  public static getInstance(): TradeManager {
    if (!TradeManager.instance) {
      logToFileAsync("No existing TradeManager instance found. Creating a new one.");
      TradeManager.instance = new TradeManager();
    } else {
      logToFileAsync("Using existing TradeManager instance.");
    }
    return TradeManager.instance;
  }

  public start(
    tradeId: string,
    slPrice: number,
    tpPrice: number,
    orderSide: 'BUY' | 'SELL',
    openPrice: number,
    pair: string
  ) {
    if (this.tradeIntervals.has(tradeId)) {
      logToFileAsync(`Trade with ID ${tradeId} is already being managed. Skipping start.`);
      return;
    }

    this.trades.set(tradeId, { slPrice, tpPrice, orderSide, openPrice, inTrailing: false, lastPrice: 0, pair });
    this.startTake50PercentProfit(tradeId);
  }

  public stop(tradeId: string) {
    const intervalId = this.tradeIntervals.get(tradeId);
    if (intervalId) {
      clearInterval(intervalId);
      this.tradeIntervals.delete(tradeId);
      this.trades.delete(tradeId);
      logToFileAsync(`Stopped managing trade with ID: ${tradeId}. Interval ID: ${intervalId} cleared.`);
    } else {
      logToFileAsync(`No active trade found with ID ${tradeId}. Cannot stop monitoring.`);
    }
  }

  private startTake50PercentProfit(tradeId: string) {
    logToFileAsync(`Monitoring Price to move SL @ Entry after 30% profit (BE)`);
    const intervalId = setInterval(async () => {
      try {
        const trade = this.trades.get(tradeId);
        if (!trade) {
          logToFileAsync(`No trade data found for ID: ${tradeId}. Skipping price check.`);
          this.stop(tradeId);
          return;
        }

        const positionExists = await this.checkIfPositionExists(tradeId);
        if (!positionExists) {
          await logToFileAsync(`Position with ID ${tradeId} is no longer open. Stopping monitoring.`);
          this.stop(tradeId);
          return;
        }

        const { tpPrice, orderSide, openPrice, pair } = trade;
        const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT(pair);
        if ('errorMessage' in marketData) {
          logToFileAsync("Error fetching market data:", marketData.errorMessage);
          return;
        }

        const latestData = marketData[marketData.length - 1];
        const currentPrice: string = orderSide === 'BUY' ? latestData.bid : latestData.ask;
        const currentPriceNum = parseFloat(currentPrice);

        if (
          (orderSide === 'BUY' && currentPriceNum >= ((tpPrice! + openPrice!) / 2) && currentPriceNum <= openPrice! + 0.9 * (tpPrice! - openPrice!)) ||
          (orderSide === 'SELL' && currentPriceNum <= ((tpPrice! + openPrice!) / 2) && currentPriceNum >= openPrice! - 0.9 * (openPrice! - tpPrice!))
        ) {
          await logToFileAsync(`Taking 30% profit for trade ID ${tradeId} at price: ${currentPriceNum}`);
          this.take50PercentProfit(tradeId);
          clearInterval(intervalId);
          this.tradeIntervals.delete(tradeId);
          this.startTakeAdditionalProfitAndTightenSL(tradeId);
        }
      } catch (error) {
        logToFileAsync("Error during 30% profit interval:", error);
      }
    }, 3000);

    this.tradeIntervals.set(tradeId, intervalId);
  }

  private async take50PercentProfit(tradeId: string) {
    const trade = this.trades.get(tradeId);
    if (!trade) return;
    try {
      await closePartiallyMT(0.30, trade.pair);
      await logToFileAsync("30% of the position closed successfully. Changing SL to Entry");
      await stopAtEntryMT(trade.pair);
    } catch (error) {
      logToFileAsync(`Error taking 30% profit for trade ID ${tradeId}:`, error);
    }
  }

  private startTakeAdditionalProfitAndTightenSL(tradeId: string) {
    const trade = this.trades.get(tradeId);
    if (!trade) return;
    const { pair } = trade;

    const intervalId = setInterval(async () => {
      try {
        const trade = this.trades.get(tradeId);
        if (!trade) return;

        const { tpPrice, orderSide, openPrice } = trade;
        const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT(pair);
        if ('errorMessage' in marketData) return;

        const latestData = marketData[marketData.length - 1];
        const currentPrice: string = orderSide === 'BUY' ? latestData.bid : latestData.ask;
        const currentPriceNum = parseFloat(currentPrice);

        const reachedTarget =
          orderSide === 'BUY'
            ? currentPriceNum >= openPrice! + (0.90 * (tpPrice! - openPrice!))
            : currentPriceNum <= openPrice! - (0.90 * (openPrice! - tpPrice!));

        if (reachedTarget) {
          await logToFileAsync(`Taking additional profit for trade ID ${tradeId} at price: ${currentPriceNum}`);
          this.takeAdditionalProfitAndTightenSL(tradeId, currentPriceNum);
          clearInterval(intervalId);
          this.tradeIntervals.delete(tradeId);
          this.startContinueTrailing(tradeId, currentPriceNum);
        }
      } catch (error) {
        logToFileAsync("Error during additional profit interval:", error);
      }
    }, 3000);

    this.tradeIntervals.set(tradeId, intervalId);
  }

  private async takeAdditionalProfitAndTightenSL(tradeId: string, currentPrice: number) {
    const trade = this.trades.get(tradeId);
    if (!trade) return;
    const { orderSide, slPrice, tpPrice, pair } = trade;

    try {
      await closePartiallyMT(0.5999999999, pair);
      await logToFileAsync("60% closed. Moving SL/TP");

      const newSLPrice = currentPrice - (orderSide === 'BUY' ? 0.0003 : -0.0003);
      const newTPPrice = currentPrice - (orderSide === 'BUY' ? 0.0002 : -0.0002);
      const slMoveCount = Math.abs(newSLPrice - slPrice!) * 10000;
      const tpMoveCount = Math.abs(newTPPrice - tpPrice!) * 10000;

      for (let i = 0; i < tpMoveCount; i++) {
        await moveTPSLMT(ACTION.MoveTP, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN, pair);
        await wait(2000);
      }
      for (let i = 0; i < slMoveCount; i++) {
        await moveTPSLMT(ACTION.MoveSL, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN, pair);
        await wait(2000);
      }

      logToFileAsync(`New SL/TP set around ${currentPrice} for trade ID: ${tradeId}`);
    } catch (error) {
      logToFileAsync(`Error in tightening SL/TP for ${tradeId}`, error);
    }
  }

  private startContinueTrailing(tradeId: string, currentPrice: number) {
    const trade = this.trades.get(tradeId);
    if (!trade) return;
    const { pair, orderSide } = trade;

    trade.lastPrice = currentPrice;
    const intervalId = setInterval(async () => {
      const trade = this.trades.get(tradeId);
      if (!trade) return;

      const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT(pair);
      if ('errorMessage' in marketData) return;

      const latestData = marketData[marketData.length - 1];
      const latestPriceNum = parseFloat(orderSide === 'BUY' ? latestData.bid : latestData.ask);

      const hasImproved =
        (orderSide === 'BUY' && latestPriceNum > trade.lastPrice!) ||
        (orderSide === 'SELL' && latestPriceNum < trade.lastPrice!);

      if (hasImproved) {
        const newSL = orderSide === 'BUY' ? latestPriceNum - 0.0003 : latestPriceNum + 0.0003;
        const newTP = orderSide === 'BUY' ? latestPriceNum + 0.0002 : latestPriceNum - 0.0002;
        const slMoves = Math.abs(newSL - latestPriceNum) * 10000;
        const tpMoves = Math.abs(newTP - latestPriceNum) * 10000;

        for (let i = 0; i < slMoves; i++) {
          await moveTPSLMT(ACTION.MoveSL, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN, pair);
          await wait(2000);
        }

        for (let i = 0; i < tpMoves; i++) {
          await moveTPSLMT(ACTION.MoveTP, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN, pair);
          await wait(2000);
        }

        this.trades.set(tradeId, { ...trade, lastPrice: latestPriceNum });
      }
    }, 3000);

    this.tradeIntervals.set(tradeId, intervalId);
  }

  private async checkIfPositionExists(tradeId: string): Promise<boolean> {
    try {
      const response = await openedPositionsMT();
      if ('errorMessage' in response) return false;
      return response.positions.some((pos: Position) => pos.id === tradeId);
    } catch (e) {
      return false;
    }
  }
}
