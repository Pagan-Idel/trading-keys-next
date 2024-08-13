import { logToFileAsync } from "./logger";
import { closePartiallyMT } from "./match-trader/api/close-partially";
import { marketWatchMT, MarketWatchResponseMT, ErrorMTResponse } from "./match-trader/api/market-watch";
import { moveTPSLMT } from "./match-trader/api/move-TPSL";
import { openedPositionsMT, OpenedPositionsResponseMT, Position } from "./match-trader/api/opened-positions";
import { ACTION } from "./oanda/api";

export class TradeManager {
  private static instance: TradeManager;
  private tradeIntervals: Map<string, NodeJS.Timeout> = new Map();
  private trades: Map<string, { slPrice: number; tpPrice: number; orderSide: 'BUY' | 'SELL'; openPrice: number; inTrailing: boolean }> = new Map();

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
      console.warn(`Trade with ID ${tradeId} is already being managed. Skipping start.`);
      return;
    }

    this.trades.set(tradeId, { slPrice, tpPrice, orderSide, openPrice, inTrailing: false });

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
      console.warn(`No active trade found with ID ${tradeId}. Cannot stop monitoring.`);
    }
  }

  private startTake50PercentProfit(tradeId: string) {
    const intervalId = setInterval(async () => {
      try {
        logToFileAsync(`Monitoring Price to take 50 percent profit.`);
        const positionExists = await this.checkIfPositionExists(tradeId);
        if (!positionExists) {
          logToFileAsync(`Position with ID ${tradeId} is no longer open. Stopping monitoring.`);
          this.stop(tradeId);
          return;
        }    
        const trade = this.trades.get(tradeId);
        if (!trade) {
          console.warn(`No trade data found for ID: ${tradeId}. Skipping price check.`);
          this.stop(tradeId);
          return;
        }

        const { slPrice, tpPrice, orderSide, openPrice } = trade;

        logToFileAsync(`Fetching market data for trade ID: ${tradeId}`);
        const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT();

        if ('errorMessage' in marketData) {
          console.error("Error fetching market data:", marketData.errorMessage);
          return;
        }

        const latestData = marketData[marketData.length - 1];
        const currentPrice: string = orderSide === 'BUY' ? latestData.bid : latestData.ask;
        const currentPriceNum = parseFloat(currentPrice);

        logToFileAsync(`Current price for trade ID ${tradeId}: ${currentPriceNum}`);
        if (
          (orderSide === 'BUY' && currentPriceNum >= ((tpPrice + openPrice) / 2) && currentPriceNum <= openPrice + 0.9 * (tpPrice - openPrice)) ||
          (orderSide === 'SELL' && currentPriceNum <= ((tpPrice + openPrice) / 2) && currentPriceNum >= Math.abs(openPrice - 0.9 * (openPrice - tpPrice)))
        ) {
          logToFileAsync(`Taking 50% profit for trade ID ${tradeId} at price: ${currentPriceNum}`);
          this.take50PercentProfit(tradeId, currentPriceNum);
          
          clearInterval(intervalId);
          this.tradeIntervals.delete(tradeId);
          
          // Proceed to the next step
          this.startTakeAdditionalProfitAndTightenSL(tradeId);
        }
      } catch (error) {
        console.error("Error during 50% profit interval:", error);
      }
    }, 5000);

    this.tradeIntervals.set(tradeId, intervalId);
    logToFileAsync(`Started 50% profit interval for trade ID: ${tradeId} with interval ID: ${intervalId}`);
  }

  private async take50PercentProfit(tradeId: string, currentPrice: number) {
    try {
      logToFileAsync(`Taking 50% profit for trade ID ${tradeId} at price: ${currentPrice}`);
      await closePartiallyMT(0.499999999);
      logToFileAsync("50% of the position closed successfully.");

      const trade = this.trades.get(tradeId);
      if (trade) {
        const { slPrice, openPrice, orderSide } = trade;
        const newSLPrice = (trade.openPrice - (orderSide === 'BUY' ? -0.0001 : 0.0001));
        trade.slPrice = parseFloat(newSLPrice.toFixed(5));
        logToFileAsync(`New SL set at 50% between initial SL and open price: ${newSLPrice}`);

        const slMoveCount = Math.abs(newSLPrice - slPrice) * 10000;
        for (let i = 0; i < slMoveCount; i++) {
          await moveTPSLMT(ACTION.MoveSL, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN);
        }
      }
    } catch (error) {
      console.error(`Error taking 50% profit for trade ID ${tradeId}:`, error);
    }
  }

  private startTakeAdditionalProfitAndTightenSL(tradeId: string) {
    const intervalId = setInterval(async () => {
      try {
        logToFileAsync(`Monitoring Price to take 40 percent profit when profit reaches 90%`);
        const positionExists = await this.checkIfPositionExists(tradeId);
        if (!positionExists) {
          logToFileAsync(`Position with ID ${tradeId} is no longer open. Stopping monitoring.`);
          this.stop(tradeId);
          return;
        }    
        const trade = this.trades.get(tradeId);
        if (!trade) {
          console.warn(`No trade data found for ID: ${tradeId}. Skipping price check.`);
          return;
        }
        const { slPrice, tpPrice, orderSide, openPrice, inTrailing } = trade;
        logToFileAsync(`Fetching market data for trade ID: ${tradeId}`);
        const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT();

        if ('errorMessage' in marketData) {
          console.error("Error fetching market data:", marketData.errorMessage);
          return;
        }

        const latestData = marketData[marketData.length - 1];
        const currentPrice: string = orderSide === 'BUY' ? latestData.bid : latestData.ask;
        const currentPriceNum = parseFloat(currentPrice);

        logToFileAsync(`Current price for trade ID ${tradeId}: ${currentPriceNum}`);
        if (orderSide === 'SELL' && currentPriceNum <= Math.abs((openPrice - (0.9 * (openPrice - tpPrice))))) {
          logToFileAsync(`Taking additional profit and tightening SL for trade ID ${tradeId} at price: ${currentPriceNum}`);
          this.takeAdditionalProfitAndTightenSL(tradeId, currentPriceNum);
          clearInterval(intervalId);
          // Proceed to the final step
          this.startContinueTrailing(tradeId, currentPriceNum);
          this.tradeIntervals.delete(tradeId);
        } else if (orderSide === 'BUY' && currentPriceNum >= openPrice + (0.9 * (tpPrice - openPrice))) {
          logToFileAsync(`Taking additional profit and tightening SL for trade ID ${tradeId} at price: ${currentPriceNum}`);
          this.takeAdditionalProfitAndTightenSL(tradeId, currentPriceNum);
          clearInterval(intervalId);
          this.tradeIntervals.delete(tradeId);
          this.startContinueTrailing(tradeId, currentPriceNum)
        }
      } catch (error) {
        console.error("Error during additional profit and SL tightening interval:", error);
      }
    }, 5000);

    this.tradeIntervals.set(tradeId, intervalId);
    logToFileAsync(`Started additional profit and SL tightening interval for trade ID: ${tradeId} with interval ID: ${intervalId}`);
  }

  private async takeAdditionalProfitAndTightenSL(tradeId: string, currentPrice: number) {
    try {
      logToFileAsync(`Taking additional 40% profit for trade ID: ${tradeId} at price: ${currentPrice}`);
      await closePartiallyMT(0.399999999);
      logToFileAsync("40% of the position closed successfully.");

      const trade = this.trades.get(tradeId);
      if (trade) {
        const { orderSide } = trade;
        const currentSLPrice = trade.slPrice;

        // Dynamically move SL to 3 pips behind current price
        const newSLPrice = currentPrice - (orderSide === 'BUY' ? 0.0003 : -0.0003);
        const slMoveCount = Math.abs(newSLPrice - currentSLPrice) * 10000;

        for (let i = 0; i < slMoveCount; i++) {
          await moveTPSLMT(ACTION.MoveSL, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN);
        }

        logToFileAsync(`New SL set at 3 pips behind the current price: ${newSLPrice}`);
      }
    } catch (error) {
      console.error(`Error during additional profit and SL tightening for trade ID ${tradeId}:`, error);
    }
  }

  private startContinueTrailing(tradeId: string, currentPrice: number) {
    const intervalId = setInterval(async () => {
      try {
        logToFileAsync(`Monitoring Price to Continue Trailing.`);
        const positionExists = await this.checkIfPositionExists(tradeId);
        if (!positionExists) {
          logToFileAsync(`Position with ID ${tradeId} is no longer open. Stopping monitoring.`);
          this.stop(tradeId);
          return;
        }    
        const trade = this.trades.get(tradeId);
        if (!trade) {
          console.warn(`No trade data found for ID ${tradeId}. Skipping trailing.`);
          this.stop(tradeId);
          return;
        }

        const { orderSide } = trade;

        logToFileAsync(`Trailing update for trade ID ${tradeId}. Checking market data.`);
        const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT();
        if ('errorMessage' in marketData) {
          console.error("Error fetching market data:", marketData.errorMessage);
          return;
        }

        const latestData = marketData[marketData.length - 1];
        const latestPrice: string = orderSide === 'BUY' ? latestData.bid : latestData.ask;
        const latestPriceNum = parseFloat(latestPrice);

        logToFileAsync(`Latest price for trade ID ${tradeId}: ${latestPriceNum}`);

        if (orderSide === 'BUY' && latestPriceNum > currentPrice) {
          logToFileAsync(`Moving SL and TP up for trade ID ${tradeId}`);
          await moveTPSLMT(ACTION.MoveSL, ACTION.UP);
          await moveTPSLMT(ACTION.MoveTP, ACTION.UP);
        } else if (orderSide === 'SELL' && latestPriceNum < currentPrice) {
          logToFileAsync(`Moving SL and TP down for trade ID ${tradeId}`);
          await moveTPSLMT(ACTION.MoveSL, ACTION.DOWN);
          await moveTPSLMT(ACTION.MoveTP, ACTION.DOWN);
        }
      } catch (error) {
        console.error(`Error during trailing for trade ID ${tradeId}:`, error);
      }
    }, 5000);

    this.tradeIntervals.set(tradeId, intervalId);
    logToFileAsync(`Started trailing interval for trade ID: ${tradeId} with interval ID: ${intervalId}`);
  }

  private async checkIfPositionExists(tradeId: string): Promise<boolean> {
    try {
      const positionsResponse: OpenedPositionsResponseMT | ErrorMTResponse = await openedPositionsMT();
      if ('errorMessage' in positionsResponse) {
        console.error("Error fetching open positions:", positionsResponse.errorMessage);
        return false;
      }
  
      // Access the positions array and use `some` method
      return positionsResponse.positions.some((position: Position) => position.id === tradeId);
    } catch (error) {
      console.error(`Error checking if position exists for trade ID ${tradeId}:`, error);
      return false;
    }
  }
}