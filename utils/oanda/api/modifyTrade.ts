// src/utils/oanda/api/modifyTrade.ts

import { OrderParameters } from "../../../components/Keyboard";
import { logToFileAsync } from "../../logger";
import credentials from "../../../credentials.json";
import { getPipIncrement, getPrecision, recentTrade } from "../../shared";
import { Trade, TradeById } from "./openNow";
import { ACTION } from "./order";

interface ModifyRequest {
  takeProfit?: OrderDetails;
  stopLoss?: OrderDetails;
}

interface OrderDetails {
  timeInForce: string;
  price: string;
}

const getLocalStorageItem = (key: string): string | null => {
  if (typeof window !== "undefined") {
    return localStorage.getItem(key);
  }
  return null;
};

export const modifyTrade = async (
  orderType: OrderParameters,
  pair?: string
): Promise<boolean> => {
  const accountType = getLocalStorageItem("accountType");
  const hostname =
    accountType === "live"
      ? "https://api-fxtrade.oanda.com"
      : "https://api-fxpractice.oanda.com";

  const accountId =
    accountType === "live"
      ? credentials.OANDA_LIVE_ACCOUNT_ID
      : credentials.OANDA_DEMO_ACCOUNT_ID;

  const token =
    accountType === "live"
      ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
      : credentials.OANDA_DEMO_ACCOUNT_TOKEN;

  if (!accountId || !token) {
    logToFileAsync("❌ Token or AccountId is not set.");
    return false;
  }

  const mostRecentTrade: Trade | undefined = await recentTrade(pair);
  if (!mostRecentTrade) {
    logToFileAsync(`❌ No recent trade found${pair ? ` for ${pair}` : ""}`);
    return false;
  }

  const instrument = pair || mostRecentTrade.instrument || "EURUSD";
  console.log("Instrument:", instrument);
  const pipIncrement = getPipIncrement(instrument);
  const precision = getPrecision(instrument);
  console.log("Precision:", precision);
  // === SL AT ENTRY ===
  if (orderType.action === ACTION.SLatEntry) {
    const requestBody: ModifyRequest = {
      stopLoss: {
        price: parseFloat(mostRecentTrade.price!).toFixed(precision),
        timeInForce: "GTC"
      }
    };

    const apiUrl = `${hostname}/v3/accounts/${accountId}/trades/${mostRecentTrade.id}/orders`;
    const response = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Accept-Datetime-Format": "RFC3339"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      logToFileAsync(`❌ SL at Entry failed. HTTP ${response.status}`);
      return false;
    }

    return true;
  }

  // === MOVE SL/TP ===
  if (orderType.action === ACTION.MoveSL || orderType.action === ACTION.MoveTP) {
    const tradeUrl = `${hostname}/v3/accounts/${accountId}/trades/${mostRecentTrade.id}`;
    const tradeResponse = await fetch(tradeUrl, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    if (!tradeResponse.ok) {
      logToFileAsync(`❌ Failed to fetch trade details. HTTP ${tradeResponse.status}`);
      return false;
    }

    const response1Object: TradeById = await tradeResponse.json();
    let requestBody: ModifyRequest = {};

    if (orderType.action === ACTION.MoveSL) {
      const oldSL = parseFloat(response1Object.trade.stopLossOrder?.price || "0");
      if (!oldSL) {
        logToFileAsync(`⚠️ No Stop Loss Detected.`);
        return false;
      }

      requestBody = {
        stopLoss: {
          price: orderType.action2 === ACTION.DOWN
            ? (oldSL - pipIncrement).toFixed(precision)
            : (oldSL + pipIncrement).toFixed(precision),
          timeInForce: "GTC"
        }
      };
    } else if (orderType.action === ACTION.MoveTP) {
      const oldTP = parseFloat(response1Object.trade.takeProfitOrder?.price || "0");
      if (!oldTP) {
        logToFileAsync(`⚠️ No Take Profit Detected.`);
        return false;
      }

      requestBody = {
        takeProfit: {
          price: orderType.action2 === ACTION.DOWN
            ? (oldTP - pipIncrement).toFixed(precision)
            : (oldTP + pipIncrement).toFixed(precision),
          timeInForce: "GTC"
        }
      };
    }

    const updateUrl = `${hostname}/v3/accounts/${accountId}/trades/${mostRecentTrade.id}/orders`;
    const updateResponse = await fetch(updateUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Accept-Datetime-Format": "RFC3339"
      },
      body: JSON.stringify(requestBody)
    });

    if (!updateResponse.ok) {
      logToFileAsync(`❌ Failed to modify trade. HTTP ${updateResponse.status}`);
      return false;
    }

    return true;
  }

  return false;
};

