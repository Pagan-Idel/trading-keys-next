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
  private trades: Map<string, { slPrice?: number; tpPrice?: number; orderSide?: 'BUY' | 'SELL'; openPrice?: number; inTrailing?: boolean, lastPrice?: number }> = new Map();

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

  public start(tradeId: string, slPrice: number, tpPrice: number, orderSide: 'BUY' | 'SELL', openPrice: number) {
    if (this.tradeIntervals.has(tradeId)) {
      logToFileAsync(`Trade with ID ${tradeId} is already being managed. Skipping start.`);
      return;
    }

    this.trades.set(tradeId, { slPrice, tpPrice, orderSide, openPrice, inTrailing: false, lastPrice: 0 });

    // Start the first interval for taking 50% profit
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
    logToFileAsync(`Monitoring Price to move SL @ Entry after 10% profit (BE)`);
    const intervalId = setInterval(async () => {
      try {
        const positionExists = await this.checkIfPositionExists(tradeId);
        if (!positionExists) {
          await logToFileAsync(`Position with ID ${tradeId} is no longer open. Stopping monitoring.`);
          this.stop(tradeId);
          return;
        }    
        const trade = this.trades.get(tradeId);
        if (!trade) {
          logToFileAsync(`No trade data found for ID: ${tradeId}. Skipping price check.`);
          this.stop(tradeId);
          return;
        }
        const { tpPrice, orderSide, openPrice } = trade;
        const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT();
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
          await logToFileAsync(`Taking 50% profit for trade ID ${tradeId} at price: ${currentPriceNum}`);
          this.take50PercentProfit(tradeId, currentPriceNum);
          
          clearInterval(intervalId);
          this.tradeIntervals.delete(tradeId);
          
          // Proceed to the next step
          this.startTakeAdditionalProfitAndTightenSL(tradeId);
        }
      } catch (error) {
        logToFileAsync("Error during 50% profit interval:", error);
      }
    }, 3000);

    this.tradeIntervals.set(tradeId, intervalId);
    logToFileAsync(`Started 50% profit interval for trade ID: ${tradeId} with interval ID: ${intervalId}`);
  }

  private async take50PercentProfit(tradeId: string, currentPrice: number) {
    try {
      await closePartiallyMT(0.10);
      await logToFileAsync("10% of the position closed successfully. Changing SL to Entry");
      await stopAtEntryMT();
    } catch (error) {
      logToFileAsync(`Error taking 50% profit for trade ID ${tradeId}:`, error);
    }
  }

  private startTakeAdditionalProfitAndTightenSL(tradeId: string) {
    logToFileAsync(`Monitoring Price to take 80 percent profit when profit reaches 90%`);
    const intervalId = setInterval(async () => {
      try {
        const positionExists = await this.checkIfPositionExists(tradeId);
        if (!positionExists) {
          await logToFileAsync(`Position with ID ${tradeId} is no longer open. Stopping monitoring.`);
          this.stop(tradeId);
          return;
        }    
        const trade = this.trades.get(tradeId);
        if (!trade) {
          await logToFileAsync(`No trade data found for ID: ${tradeId}. Skipping price check.`);
          return;
        }
        const { tpPrice, orderSide, openPrice } = trade;
        const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT();

        if ('errorMessage' in marketData) {
          logToFileAsync("Error fetching market data:", marketData.errorMessage);
          return;
        }

        const latestData = marketData[marketData.length - 1];
        const currentPrice: string = orderSide === 'BUY' ? latestData.bid : latestData.ask;
        const currentPriceNum = parseFloat(currentPrice);

        if (orderSide === 'SELL' && currentPriceNum <= openPrice! - (0.90 * (openPrice! - tpPrice!))) {
          await logToFileAsync(`Taking additional profit and tightening SL for trade ID ${tradeId} at price: ${currentPriceNum}`);
          this.takeAdditionalProfitAndTightenSL(tradeId, currentPriceNum);
          clearInterval(intervalId);
          // Proceed to the final step
          this.startContinueTrailing(tradeId, currentPriceNum);
          this.tradeIntervals.delete(tradeId);
        } else if (orderSide === 'BUY' && currentPriceNum >= openPrice! + (0.90 * (tpPrice! - openPrice!))) {
          await logToFileAsync(`Taking additional profit and tightening SL for trade ID ${tradeId} at price: ${currentPriceNum}`);
          this.takeAdditionalProfitAndTightenSL(tradeId, currentPriceNum);
          clearInterval(intervalId);
          this.tradeIntervals.delete(tradeId);
          this.startContinueTrailing(tradeId, currentPriceNum)
        }
      } catch (error) {
        logToFileAsync("Error during additional profit and SL tightening interval:", error);
      }
    }, 3000);

    this.tradeIntervals.set(tradeId, intervalId);
  }

  private async takeAdditionalProfitAndTightenSL(tradeId: string, currentPrice: number) {
    try {
      await logToFileAsync(`Taking additional 80% profit for trade ID: ${tradeId} at price: ${currentPrice}`);
      await closePartiallyMT(0.7999999999);
      await logToFileAsync("80% of the position closed successfully. Moving SL to 3 Pips behind current price");

      const trade = this.trades.get(tradeId);
      if (trade) {
        const { orderSide } = trade;
        const currentSLPrice = trade.slPrice;
        const currentTPPrice = trade.tpPrice;
        // Dynamically move SL to 3 pips behind current price
        const newSLPrice = currentPrice - (orderSide === 'BUY' ? 0.0003 : -0.0003);
        const newTPPrice = currentPrice - (orderSide === 'BUY' ? 0.0002 : -0.0002);
        const slMoveCount = Math.abs(newSLPrice - currentSLPrice!) * 10000;
        const tpMoveCount = Math.abs(newTPPrice - currentTPPrice!) * 10000;
        await logToFileAsync(`Moving TP 2 pips away from current price for trade ID ${tradeId}`);
        for (let i = 0; i < tpMoveCount; i++) {
          await moveTPSLMT(ACTION.MoveTP, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN);
          await wait(2000);
          await logToFileAsync(`Take Profit moved.`);
        }
        await logToFileAsync(`Moving SL 3 pips away from current price for trade ID ${tradeId}`);
        for (let i = 0; i < slMoveCount; i++) {
          await moveTPSLMT(ACTION.MoveSL, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN);
          await wait(2000);
          await logToFileAsync(`Stop Loss moved.`);
        }

        await logToFileAsync(`New SL set at 3 pips behind the current price: ${newSLPrice}`);
      }
    } catch (error) {
      logToFileAsync(`Error during additional profit and SL tightening for trade ID ${tradeId}:`, error);
    }
  }

  private startContinueTrailing(tradeId: string, currentPrice: number) {
    logToFileAsync(`Monitoring Price to Continue Trailing.`);
    this.trades.set(tradeId, {
      lastPrice: currentPrice
    });
    const intervalId = setInterval(async () => {
      try {
        const positionExists = await this.checkIfPositionExists(tradeId);
        if (!positionExists) {
          await logToFileAsync(`Position with ID ${tradeId} is no longer open. Stopping monitoring.`);
          this.stop(tradeId);
          return;
        }    
        const trade = this.trades.get(tradeId);
        if (!trade) {
          logToFileAsync(`No trade data found for ID ${tradeId}. Skipping trailing.`);
          this.stop(tradeId);
          return;
        }

        const { orderSide, lastPrice } = trade;

        const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT();
        if ('errorMessage' in marketData) {
          logToFileAsync("Error fetching market data:", marketData.errorMessage);
          return;
        }

        const latestData = marketData[marketData.length - 1];
        const latestPrice: string = orderSide === 'BUY' ? latestData.bid : latestData.ask;
        const latestPriceNum = parseFloat(latestPrice);

        if (orderSide === 'BUY' && latestPriceNum > lastPrice!) {
          // Dynamically move SL to 3 pips behind and TP to 2 pips in front current price
          const newSLPrice = latestPriceNum - 0.0003;
          const newTPPrice = latestPriceNum + 0.0002;
          const slMoveCount = Math.abs(newSLPrice - latestPriceNum!) * 10000;
          const tpMoveCount = Math.abs(newTPPrice - latestPriceNum!) * 10000;
          await logToFileAsync(`Moving SL 3 pips away from current price for trade ID ${tradeId}`);
          for (let i = 0; i < slMoveCount; i++) {
            await moveTPSLMT(ACTION.MoveSL, ACTION.UP);
            await wait(2000);
            await logToFileAsync(`Stop Loss moved.`);
          }
          await logToFileAsync(`Moving TP 2 pips away from current price for trade ID ${tradeId}`);
          for (let i = 0; i < tpMoveCount; i++) {
            await moveTPSLMT(ACTION.MoveTP, ACTION.UP);
            await wait(2000);
            await logToFileAsync(`Take Profit moved.`);
          }
        } else if (orderSide === 'SELL' && latestPriceNum < lastPrice!) {
          // Dynamically move SL to 3 pips behind and TP to 2 pips in front current price
          const newSLPrice = latestPriceNum + 0.0003;
          const newTPPrice = latestPriceNum - 0.0002;
          const slMoveCount = Math.abs(newSLPrice - latestPriceNum!) * 10000;
          const tpMoveCount = Math.abs(newTPPrice - latestPriceNum!) * 10000;
          await logToFileAsync(`Moving SL 3 pips away from current price for trade ID ${tradeId}`);
          for (let i = 0; i < slMoveCount; i++) {
            await moveTPSLMT(ACTION.MoveSL, ACTION.DOWN);
            await wait(2000);
            await logToFileAsync(`Stop Loss moved.`);
          }
          await logToFileAsync(`Moving TP 2 pips away from current price for trade ID ${tradeId}`);
          for (let i = 0; i < tpMoveCount; i++) {
            await moveTPSLMT(ACTION.MoveTP, ACTION.DOWN);
            await wait(2000);
            await logToFileAsync(`Take Profit moved.`);
          }
        }
        this.trades.set(tradeId, {
          lastPrice: latestPriceNum
        });
      } catch (error) {
        logToFileAsync(`Error during trailing for trade ID ${tradeId}:`, error);
      }
    }, 3000);

    this.tradeIntervals.set(tradeId, intervalId);
    logToFileAsync(`Started trailing interval for trade ID: ${tradeId} with interval ID: ${intervalId}`);
  }

  private async checkIfPositionExists(tradeId: string): Promise<boolean> {
    try {
      const positionsResponse: OpenedPositionsResponseMT | ErrorMTResponse = await openedPositionsMT();
      if ('errorMessage' in positionsResponse) {
        logToFileAsync("Error fetching open positions:", positionsResponse.errorMessage);
        return false;
      }
  
      // Access the positions array and use `some` method
      return positionsResponse.positions.some((position: Position) => position.id === tradeId);
    } catch (error) {
      logToFileAsync(`Error checking if position exists for trade ID ${tradeId}:`, error);
      return false;
    }
  }
}