import { closePartiallyMT } from "./match-trader/api/close-partially";
import { marketWatchMT, MarketWatchResponseMT, ErrorMTResponse } from "./match-trader/api/market-watch";
import { stopAtEntryMT } from "./match-trader/api/stop-at-entry";

export class TradeManager {
  private static instance: TradeManager;
  private tradeIntervals: Map<string, NodeJS.Timeout> = new Map();
  private trades: Map<string, { slPrice: number; tpPrice: number; orderSide: 'BUY' | 'SELL'; openPrice: number }> = new Map();

  // Private constructor to prevent direct instantiation
  private constructor() {
    console.log("TradeManager instance created.");
  }

  // Method to get the singleton instance
  public static getInstance(): TradeManager {
    if (!TradeManager.instance) {
      console.log("No existing TradeManager instance found. Creating a new one.");
      TradeManager.instance = new TradeManager();
    } else {
      console.log("Using existing TradeManager instance.");
    }
    return TradeManager.instance;
  }

  // Method to start managing a trade
  public start(tradeId: string, slPrice: number, tpPrice: number, orderSide: 'BUY' | 'SELL', openPrice: number) {
    if (this.tradeIntervals.has(tradeId)) {
      console.warn(`Trade with ID ${tradeId} is already being managed. Skipping start.`);
      return;
    }

    console.log(`Starting to manage trade with ID: ${tradeId}`);
    console.log(`Trade Details: SL Price = ${slPrice}, TP Price = ${tpPrice}, Order Side = ${orderSide}, Open Price = ${openPrice}`);

    // Save the trade details
    this.trades.set(tradeId, { slPrice, tpPrice, orderSide, openPrice });
    console.log(`Trade details saved for ID: ${tradeId}`);

    // Start monitoring the price for this trade every 10 seconds
    const intervalId = setInterval(() => this.checkPrice(tradeId), 10000);
    this.tradeIntervals.set(tradeId, intervalId);
    console.log(`Price monitoring started for trade ID: ${tradeId} with interval ID: ${intervalId}`);
  }

  // Method to stop managing a trade
  public stop(tradeId: string) {
    const intervalId = this.tradeIntervals.get(tradeId);
    if (intervalId) {
      clearInterval(intervalId);
      this.tradeIntervals.delete(tradeId);
      this.trades.delete(tradeId);
      console.log(`Stopped managing trade with ID: ${tradeId}. Interval ID: ${intervalId} cleared.`);
    } else {
      console.warn(`No active trade found with ID ${tradeId}. Cannot stop monitoring.`);
    }
  }

  // Private method to check the price for a specific trade
  private async checkPrice(tradeId: string) {
    console.log(`Checking price for trade ID: ${tradeId}`);
    const trade = this.trades.get(tradeId);
    if (!trade) {
      console.warn(`No trade data found for ID: ${tradeId}. Skipping price check.`);
      return;
    }
    // We could later implement slPrice if we want to tradeManage when price is in drawdown for too long.
    const { slPrice, tpPrice, orderSide, openPrice } = trade;

    try {
      console.log("Fetching market data...");
      const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT();

      if ('errorMessage' in marketData) {
        console.error("Error fetching market data:", marketData.errorMessage);
        return;
      }

      const latestData = marketData[marketData.length - 1];
      const currentPrice: string = orderSide === 'BUY' ? latestData.bid : latestData.ask;
      const currentPriceNum = parseFloat(currentPrice);
      console.log(`Current market price for ${orderSide} position: ${currentPriceNum}`);

      if (orderSide === 'BUY' && currentPriceNum >= ((tpPrice + openPrice) / 2)) {
        console.log(`Price condition met for BUY position. Executing trade actions for trade ID: ${tradeId}`);
        await this.executeTradeActions(tradeId, currentPriceNum);
      } else if (orderSide === 'SELL' && currentPriceNum <= ((tpPrice + openPrice) / 2)) {
        console.log(`Price condition met for SELL position. Executing trade actions for trade ID: ${tradeId}`);
        await this.executeTradeActions(tradeId, currentPriceNum);
      } else {
        console.log(`Price condition not met for trade ID: ${tradeId}. Continuing monitoring.`);
      }
    } catch (error) {
      console.error("Error checking price:", error);
    }
  }

  // Private method to execute trade actions for a specific trade
  private async executeTradeActions(tradeId: string, currentPrice: number) {
    try {
      console.log(`Executing trade actions for trade ID: ${tradeId} at price: ${currentPrice}`);

      // Close 50% of the position
      console.log("Closing 50% of the position...");
      await closePartiallyMT(0.499999999);
      console.log("50% of the position closed successfully.");

      // Set SL at entry
      console.log("Setting SL at entry...");
      await stopAtEntryMT();
      console.log("SL at entry set successfully.");

      console.log(`Actions executed successfully for trade ID: ${tradeId} at price: ${currentPrice}`);

      // Stop monitoring after actions are executed
      this.stop(tradeId);
    } catch (error) {
      console.error(`Error executing trade actions for trade ID ${tradeId}:`, error);
    }
  }
}
