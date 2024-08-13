import { logToFileAsync } from "./logger";
import { closePartiallyMT } from "./match-trader/api/close-partially";
import { marketWatchMT, MarketWatchResponseMT, ErrorMTResponse } from "./match-trader/api/market-watch";
import { stopAtEntryMT } from "./match-trader/api/stop-at-entry";

export class TradeManager {
  private static instance: TradeManager;
  private tradeIntervals: Map<string, NodeJS.Timeout> = new Map();
  private trades: Map<string, { slPrice: number; tpPrice: number; orderSide: 'BUY' | 'SELL'; openPrice: number }> = new Map();

  // Private constructor to prevent direct instantiation
  private constructor() {
    logToFileAsync("TradeManager instance created.");
  }

  // Method to get the singleton instance
  public static getInstance(): TradeManager {
    if (!TradeManager.instance) {
      logToFileAsync("No existing TradeManager instance found. Creating a new one.");
      TradeManager.instance = new TradeManager();
    } else {
      logToFileAsync("Using existing TradeManager instance.");
    }
    return TradeManager.instance;
  }

  // Method to start managing a trade
  public start(tradeId: string, slPrice: number, tpPrice: number, orderSide: 'BUY' | 'SELL', openPrice: number) {
    if (this.tradeIntervals.has(tradeId)) {
      console.warn(`Trade with ID ${tradeId} is already being managed. Skipping start.`);
      return;
    }
    // Save the trade details
    this.trades.set(tradeId, { slPrice, tpPrice, orderSide, openPrice });

    // Start monitoring the price for this trade every 10 seconds
    const intervalId = setInterval(() => this.checkPrice(tradeId), 10000);
    this.tradeIntervals.set(tradeId, intervalId);
    logToFileAsync(`Price monitoring started for trade ID: ${tradeId} with interval ID: ${intervalId}`);
  }

  // Method to stop managing a trade
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

  // Private method to check the price for a specific trade
  private async checkPrice(tradeId: string) {
    const trade = this.trades.get(tradeId);
    if (!trade) {
      console.warn(`No trade data found for ID: ${tradeId}. Skipping price check.`);
      return;
    }
    // We could later implement slPrice if we want to tradeManage when price is in drawdown for too long.
    const { slPrice, tpPrice, orderSide, openPrice } = trade;

    try {
      const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT();

      if ('errorMessage' in marketData) {
        console.error("Error fetching market data:", marketData.errorMessage);
        return;
      }

      const latestData = marketData[marketData.length - 1];
      const currentPrice: string = orderSide === 'BUY' ? latestData.bid : latestData.ask;
      const currentPriceNum = parseFloat(currentPrice);

      if (orderSide === 'BUY' && currentPriceNum >= ((tpPrice + openPrice) / 2)) {
        await this.executeTradeActions(tradeId, currentPriceNum);
      } else if (orderSide === 'SELL' && currentPriceNum <= ((tpPrice + openPrice) / 2)) {
        await this.executeTradeActions(tradeId, currentPriceNum);
      } else {
      }
    } catch (error) {
      console.error("Error checking price:", error);
    }
  }

  // Private method to execute trade actions for a specific trade
  private async executeTradeActions(tradeId: string, currentPrice: number) {
    try {
      logToFileAsync(`Executing trade actions for trade ID: ${tradeId} at price: ${currentPrice}`);
      // Close 50% of the position
      await closePartiallyMT(0.499999999);
      logToFileAsync("50% of the position closed successfully.");

      // Set SL at entry
      await stopAtEntryMT();
      logToFileAsync("SL at entry set successfully.");

      // Stop monitoring after actions are executed
      this.stop(tradeId);
    } catch (error) {
      console.error(`Error executing trade actions for trade ID ${tradeId}:`, error);
    }
  }
}
