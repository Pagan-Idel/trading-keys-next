// import { closePartiallyMT } from "./match-trader/api/close-partially";
// import { marketWatchMT, MarketWatchResponseMT, ErrorMTResponse } from "./match-trader/api/market-watch";
// import { moveTPSLMT } from "./match-trader/api/move-TPSL";
// import { openedPositionsMT, OpenedPositionsResponseMT, Position } from "./match-trader/api/opened-positions";
// import { ACTION } from "./oanda/api";

// export class TradeManager {
//   private static instance: TradeManager;
//   private tradeIntervals: Map<string, NodeJS.Timeout> = new Map();
//   private trades: Map<string, { slPrice: number; tpPrice: number; orderSide: 'BUY' | 'SELL'; openPrice: number; inTrailing: boolean }> = new Map();

//   private constructor() {
//     console.log("TradeManager instance created.");
//   }

//   public static getInstance(): TradeManager {
//     if (!TradeManager.instance) {
//       console.log("No existing TradeManager instance found. Creating a new one.");
//       TradeManager.instance = new TradeManager();
//     } else {
//       console.log("Using existing TradeManager instance.");
//     }
//     return TradeManager.instance;
//   }

//   public start(tradeId: string, slPrice: number, tpPrice: number, orderSide: 'BUY' | 'SELL', openPrice: number) {
//     if (this.tradeIntervals.has(tradeId)) {
//       console.warn(`Trade with ID ${tradeId} is already being managed. Skipping start.`);
//       return;
//     }

//     this.trades.set(tradeId, { slPrice, tpPrice, orderSide, openPrice, inTrailing: false });

//     const intervalId = setInterval(() => this.checkPrice(tradeId), 5000);
//     this.tradeIntervals.set(tradeId, intervalId);
//     console.log(`Price monitoring started for trade ID: ${tradeId} with interval ID: ${intervalId}`);
//   }

//   public stop(tradeId: string) {
//     const intervalId = this.tradeIntervals.get(tradeId);
//     if (intervalId) {
//       clearInterval(intervalId);
//       this.tradeIntervals.delete(tradeId);
//       this.trades.delete(tradeId);
//       console.log(`Stopped managing trade with ID: ${tradeId}. Interval ID: ${intervalId} cleared.`);
//     } else {
//       console.warn(`No active trade found with ID ${tradeId}. Cannot stop monitoring.`);
//     }
//   }

//   private async checkPrice(tradeId: string) {
//     try {
//       const trade = this.trades.get(tradeId);
//       if (!trade) {
//         console.warn(`No trade data found for ID: ${tradeId}. Skipping price check.`);
//         return;
//       }
  
//       const { slPrice, tpPrice, orderSide, openPrice, inTrailing } = trade;
  
//       if (!inTrailing) {
//         console.log(`Checking if position with ID ${tradeId} is still open.`);
//         const positionExists = await this.checkIfPositionExists(tradeId);
//         if (!positionExists) {
//           console.log(`Position with ID ${tradeId} is no longer open. Stopping monitoring.`);
//           this.stop(tradeId);
//           return;
//         }
//         console.log(`Fetching market data for trade ID: ${tradeId}`);
//         const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT();

//         if ('errorMessage' in marketData) {
//           console.error("Error fetching market data:", marketData.errorMessage);
//           return;
//         }
//         const latestData = marketData[marketData.length - 1];
//         const currentPrice: string = orderSide === 'BUY' ? latestData.bid : latestData.ask;
//         const currentPriceNum = parseFloat(currentPrice);

//         console.log(`Current price for trade ID ${tradeId}: ${currentPriceNum}`);
//         if (orderSide === 'BUY' && currentPriceNum >= ((tpPrice + openPrice) / 2) && currentPriceNum <= openPrice + 0.9 * (tpPrice - openPrice)) {
//           console.log(`Taking 50% profit for trade ID ${tradeId} at price: ${currentPriceNum}`);
//           await this.take50PercentProfit(tradeId, currentPriceNum);
//         } else if (orderSide === 'SELL' && currentPriceNum <= ((tpPrice + openPrice) / 2) && currentPriceNum >= openPrice - 0.9 * (openPrice - tpPrice)) {
//           console.log(`Taking 50% profit for trade ID ${tradeId} at price: ${currentPriceNum}`);
//           await this.take50PercentProfit(tradeId, currentPriceNum);
//         }

//         if (orderSide === 'BUY' && currentPriceNum >= openPrice + 0.9 * (tpPrice - openPrice)) {
//           console.log(`Taking additional profit and tightening SL for trade ID ${tradeId} at price: ${currentPriceNum}`);
//           await this.takeAdditionalProfitAndTightenSL(tradeId, currentPriceNum);
//           this.updateTradeState(tradeId, { inTrailing: true });
//           console.log(`Continuing trailing for trade ID ${tradeId}`);
//           await this.continueTrailing(tradeId, currentPriceNum);
//         } else if (orderSide === 'SELL' && currentPriceNum <= openPrice - 0.9 * (openPrice - tpPrice)) {
//           console.log(`Taking additional profit and tightening SL for trade ID ${tradeId} at price: ${currentPriceNum}`);
//           await this.takeAdditionalProfitAndTightenSL(tradeId, currentPriceNum);
//           this.updateTradeState(tradeId, { inTrailing: true });
//           console.log(`Continuing trailing for trade ID ${tradeId}`);
//           await this.continueTrailing(tradeId, currentPriceNum);
//         }
//       }
//     } catch (error) {
//       console.error("Error checking price:", error);
//     }
//   }

//   private async continueTrailing(tradeId: string, currentPrice: number) {
//     try {
//       const trade = this.trades.get(tradeId);
//       if (!trade) {
//         console.warn(`No trade data found for ID ${tradeId}. Skipping trailing.`);
//         return;
//       }
//       const { orderSide } = trade;

//       console.log(`Setting up trailing for trade ID ${tradeId}. Current price: ${currentPrice}`);

//       const newIntervalId = setInterval(async () => {
//         try {
//           console.log(`Checking if position with ID ${tradeId} is still open.`);
//           const positionExists = await this.checkIfPositionExists(tradeId);
//           if (!positionExists) {
//             console.log(`Position with ID ${tradeId} is no longer open. Stopping monitoring.`);
//             this.stop(tradeId);
//             return;
//           }    
//           console.log(`Trailing update for trade ID ${tradeId}. Checking market data.`);
//           const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT();
//           if ('errorMessage' in marketData) {
//             console.error("Error fetching market data:", marketData.errorMessage);
//             return;
//           }

//           const latestData = marketData[marketData.length - 1];
//           const latestPrice: string = orderSide === 'BUY' ? latestData.bid : latestData.ask;
//           const latestPriceNum = parseFloat(latestPrice);

//           console.log(`Latest price for trade ID ${tradeId}: ${latestPriceNum}`);

//           if (orderSide === 'BUY' && latestPriceNum > currentPrice) {
//             console.log(`Moving SL and TP up for trade ID ${tradeId}`);
//             await moveTPSLMT(ACTION.MoveSL, ACTION.UP);
//             await moveTPSLMT(ACTION.MoveTP, ACTION.UP);
//           } else if (orderSide === 'SELL' && latestPriceNum < currentPrice) {
//             console.log(`Moving SL and TP down for trade ID ${tradeId}`);
//             await moveTPSLMT(ACTION.MoveSL, ACTION.DOWN);
//             await moveTPSLMT(ACTION.MoveTP, ACTION.DOWN);
//           }
//         } catch (error) {
//           console.error(`Error during trailing for trade ID ${tradeId}:`, error);
//         }
//       }, 5000);

//       this.tradeIntervals.set(tradeId, newIntervalId);
//       console.log(`Started trailing interval for trade ID: ${tradeId} with interval ID: ${newIntervalId}`);
//     } catch (error) {
//       console.error(`Error during trailing setup for trade ID ${tradeId}:`, error);
//     }
//   }

//   private async take50PercentProfit(tradeId: string, currentPrice: number) {
//     try {
//       console.log(`Taking 50% profit for trade ID ${tradeId} at price: ${currentPrice}`);
//       await closePartiallyMT(0.499999999);
//       console.log("50% of the position closed successfully.");

//       const trade = this.trades.get(tradeId);
//       if (trade) {
//         const { slPrice, openPrice, orderSide } = trade;
//         const newSLPrice = slPrice + ((openPrice - slPrice) / 2);
//         trade.slPrice = parseFloat(newSLPrice.toFixed(5));
//         console.log(`New SL set at 50% between initial SL and open price: ${newSLPrice}`);

//         const slMoveCount = Math.abs(newSLPrice - slPrice) * 10000;
//         for (let i = 0; i < slMoveCount; i++) {
//           await moveTPSLMT(ACTION.MoveSL, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN);
//         }
//       }
//     } catch (error) {
//       console.error(`Error taking 50% profit for trade ID ${tradeId}:`, error);
//     }
//   }

//   private updateTradeState(tradeId: string, state: Partial<{ slPrice: number; tpPrice: number; inTrailing: boolean }>) {
//     const trade = this.trades.get(tradeId);
//     if (trade) {
//       Object.assign(trade, state);
//       console.log(`Updated trade state for ID ${tradeId}:`, trade);
//     } else {
//       console.warn(`No trade data found for ID ${tradeId}. Cannot update state.`);
//     }
//   }

//   private async takeAdditionalProfitAndTightenSL(tradeId: string, currentPrice: number) {
//     try {
//       console.log(`Taking additional 40% profit for trade ID: ${tradeId} at price: ${currentPrice}`);
//       await closePartiallyMT(0.399999999);
//       console.log("40% of the position closed successfully.");

//       const trade = this.trades.get(tradeId);
//       if (trade) {
//         const { orderSide } = trade;
//         const currentSLPrice = trade.slPrice;

//         // Dynamically move SL to 3 pips behind current price
//         const newSLPrice = currentPrice - (orderSide === 'BUY' ? 0.0003 : -0.0003);
//         const slMoveCount = Math.abs(newSLPrice - currentSLPrice) * 10000;
//         for (let i = 0; i < slMoveCount; i++) {
//           await moveTPSLMT(ACTION.MoveSL, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN);
//         }

//         // Dynamically move TP 2 pips away from current price
//         const newTPPrice = currentPrice + (orderSide === 'BUY' ? 0.0002 : -0.0002);
//         const tpMoveCount = Math.abs(newTPPrice - trade.tpPrice) * 10000;
//         for (let i = 0; i < tpMoveCount; i++) {
//           await moveTPSLMT(ACTION.MoveTP, orderSide === 'BUY' ? ACTION.UP : ACTION.DOWN);
//         }

//         // Update the trade object with the new TP and SL prices
//         trade.slPrice = newSLPrice;
//         trade.tpPrice = newTPPrice;

//       }
//     } catch (error) {
//       console.error(`Error taking additional profit and tightening SL for trade ID ${tradeId}:`, error);
//     }
//   }

//   private async checkIfPositionExists(tradeId: string): Promise<boolean> {
//     try {
//       const positionsResponse: OpenedPositionsResponseMT | ErrorMTResponse = await openedPositionsMT();
//       if ('errorMessage' in positionsResponse) {
//         console.error("Error fetching open positions:", positionsResponse.errorMessage);
//         return false;
//       }
  
//       // Access the positions array and use `some` method
//       return positionsResponse.positions.some((position: Position) => position.id === tradeId);
//     } catch (error) {
//       console.error(`Error checking if position exists for trade ID ${tradeId}:`, error);
//       return false;
//     }
//   }
  
// }







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
    console.log("TradeManager instance created.");
  }

  public static getInstance(): TradeManager {
    if (!TradeManager.instance) {
      console.log("No existing TradeManager instance found. Creating a new one.");
      TradeManager.instance = new TradeManager();
    } else {
      console.log("Using existing TradeManager instance.");
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
      console.log(`Stopped managing trade with ID: ${tradeId}. Interval ID: ${intervalId} cleared.`);
    } else {
      console.warn(`No active trade found with ID ${tradeId}. Cannot stop monitoring.`);
    }
  }

  private startTake50PercentProfit(tradeId: string) {
    const intervalId = setInterval(async () => {
      try {
        console.log(`Monitoring Price to take 50 percent profit.`);
        const positionExists = await this.checkIfPositionExists(tradeId);
        if (!positionExists) {
          console.log(`Position with ID ${tradeId} is no longer open. Stopping monitoring.`);
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

        console.log(`Fetching market data for trade ID: ${tradeId}`);
        const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT();

        if ('errorMessage' in marketData) {
          console.error("Error fetching market data:", marketData.errorMessage);
          return;
        }

        const latestData = marketData[marketData.length - 1];
        const currentPrice: string = orderSide === 'BUY' ? latestData.bid : latestData.ask;
        const currentPriceNum = parseFloat(currentPrice);

        console.log(`Current price for trade ID ${tradeId}: ${currentPriceNum}`);
        if (
          (orderSide === 'BUY' && currentPriceNum >= ((tpPrice + openPrice) / 2) && currentPriceNum <= openPrice + 0.9 * (tpPrice - openPrice)) ||
          (orderSide === 'SELL' && currentPriceNum <= ((tpPrice + openPrice) / 2) && currentPriceNum >= openPrice - 0.9 * (openPrice - tpPrice))
        ) {
          console.log(`Taking 50% profit for trade ID ${tradeId} at price: ${currentPriceNum}`);
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
    console.log(`Started 50% profit interval for trade ID: ${tradeId} with interval ID: ${intervalId}`);
  }

  private async take50PercentProfit(tradeId: string, currentPrice: number) {
    try {
      console.log(`Taking 50% profit for trade ID ${tradeId} at price: ${currentPrice}`);
      await closePartiallyMT(0.499999999);
      console.log("50% of the position closed successfully.");

      const trade = this.trades.get(tradeId);
      if (trade) {
        const { slPrice, openPrice, orderSide } = trade;
        const newSLPrice = slPrice + ((openPrice - slPrice) / 2);
        trade.slPrice = parseFloat(newSLPrice.toFixed(5));
        console.log(`New SL set at 50% between initial SL and open price: ${newSLPrice}`);

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
        console.log(`Monitoring Price to take 40 percent profit when profit reaches 90%`);
        const positionExists = await this.checkIfPositionExists(tradeId);
        if (!positionExists) {
          console.log(`Position with ID ${tradeId} is no longer open. Stopping monitoring.`);
          this.stop(tradeId);
          return;
        }    
        const trade = this.trades.get(tradeId);
        if (!trade) {
          console.warn(`No trade data found for ID: ${tradeId}. Skipping price check.`);
          return;
        }
        const { slPrice, tpPrice, orderSide, openPrice, inTrailing } = trade;
        console.log(`Fetching market data for trade ID: ${tradeId}`);
        const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT();

        if ('errorMessage' in marketData) {
          console.error("Error fetching market data:", marketData.errorMessage);
          return;
        }

        const latestData = marketData[marketData.length - 1];
        const currentPrice: string = orderSide === 'BUY' ? latestData.bid : latestData.ask;
        const currentPriceNum = parseFloat(currentPrice);

        console.log(`Current price for trade ID ${tradeId}: ${currentPriceNum}`);
        if (orderSide === 'SELL' && currentPriceNum <= openPrice - (0.9 * (openPrice - tpPrice))) {
          console.log(`Taking additional profit and tightening SL for trade ID ${tradeId} at price: ${currentPriceNum}`);
          this.takeAdditionalProfitAndTightenSL(tradeId, currentPriceNum);
          clearInterval(intervalId);
          // Proceed to the final step
          this.startContinueTrailing(tradeId, currentPriceNum);
          this.tradeIntervals.delete(tradeId);
        } else if (orderSide === 'BUY' && currentPriceNum >= openPrice + (0.9 * (tpPrice - openPrice))) {
          console.log(`Taking additional profit and tightening SL for trade ID ${tradeId} at price: ${currentPriceNum}`);
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
    console.log(`Started additional profit and SL tightening interval for trade ID: ${tradeId} with interval ID: ${intervalId}`);
  }

  private async takeAdditionalProfitAndTightenSL(tradeId: string, currentPrice: number) {
    try {
      console.log(`Taking additional 40% profit for trade ID: ${tradeId} at price: ${currentPrice}`);
      await closePartiallyMT(0.399999999);
      console.log("40% of the position closed successfully.");

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

        console.log(`New SL set at 3 pips behind the current price: ${newSLPrice}`);
      }
    } catch (error) {
      console.error(`Error during additional profit and SL tightening for trade ID ${tradeId}:`, error);
    }
  }

  private startContinueTrailing(tradeId: string, currentPrice: number) {
    const intervalId = setInterval(async () => {
      try {
        console.log(`Monitoring Price to Continue Trailing.`);
        const positionExists = await this.checkIfPositionExists(tradeId);
        if (!positionExists) {
          console.log(`Position with ID ${tradeId} is no longer open. Stopping monitoring.`);
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

        console.log(`Trailing update for trade ID ${tradeId}. Checking market data.`);
        const marketData: MarketWatchResponseMT | ErrorMTResponse = await marketWatchMT();
        if ('errorMessage' in marketData) {
          console.error("Error fetching market data:", marketData.errorMessage);
          return;
        }

        const latestData = marketData[marketData.length - 1];
        const latestPrice: string = orderSide === 'BUY' ? latestData.bid : latestData.ask;
        const latestPriceNum = parseFloat(latestPrice);

        console.log(`Latest price for trade ID ${tradeId}: ${latestPriceNum}`);

        if (orderSide === 'BUY' && latestPriceNum > currentPrice) {
          console.log(`Moving SL and TP up for trade ID ${tradeId}`);
          await moveTPSLMT(ACTION.MoveSL, ACTION.UP);
          await moveTPSLMT(ACTION.MoveTP, ACTION.UP);
        } else if (orderSide === 'SELL' && latestPriceNum < currentPrice) {
          console.log(`Moving SL and TP down for trade ID ${tradeId}`);
          await moveTPSLMT(ACTION.MoveSL, ACTION.DOWN);
          await moveTPSLMT(ACTION.MoveTP, ACTION.DOWN);
        }
      } catch (error) {
        console.error(`Error during trailing for trade ID ${tradeId}:`, error);
      }
    }, 5000);

    this.tradeIntervals.set(tradeId, intervalId);
    console.log(`Started trailing interval for trade ID: ${tradeId} with interval ID: ${intervalId}`);
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