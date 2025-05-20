import { OrderParameters } from "../../../components/Keyboard";
import { logToFileAsync } from "../../logger";
import credentials from "../../../credentials.json";
import { getPipIncrement, recentTrade } from "../../shared";
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
    logToFileAsync("Token or AccountId is not set.");
    return false;
  }

  const mostRecentTrade: Trade | undefined = await recentTrade(pair);
  if (!mostRecentTrade) {
    logToFileAsync(`No recent trade found${pair ? ` for ${pair}` : ""}`);
    return false;
  }

  const pipIncrement = getPipIncrement(pair || mostRecentTrade.instrument || "EURUSD");

  if (orderType.action === ACTION.SLatEntry) {
    const requestBody: ModifyRequest = {
      stopLoss: {
        price: mostRecentTrade.price!,
        timeInForce: "GTC",
      },
    };

    const apiUrl = `${hostname}/v3/accounts/${accountId}/trades/${mostRecentTrade.id}/orders`;

    const response = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Accept-Datetime-Format": "RFC3339",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      logToFileAsync(`HTTP error! Status: ${response.status}`);
      return false;
    }

    return true;
  }

  if (orderType.action === ACTION.MoveSL || orderType.action === ACTION.MoveTP) {
    const apiUrl1 = `${hostname}/v3/accounts/${accountId}/trades/${mostRecentTrade.id}`;

    const response1 = await fetch(apiUrl1, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response1.ok) {
      logToFileAsync(`HTTP error! Status: ${response1.status}`);
      return false;
    }

    const response1Object: TradeById = await response1.json();

    let requestBody: ModifyRequest = {};

    if (orderType.action === ACTION.MoveSL) {
      const oldSL = parseFloat(response1Object.trade.stopLossOrder?.price || "0");
      if (!oldSL) {
        logToFileAsync(`No Stop Loss Detected`);
        return false;
      }

      requestBody = {
        stopLoss: {
          price: orderType.action2 === ACTION.DOWN
            ? (oldSL - pipIncrement).toFixed(5)
            : (oldSL + pipIncrement).toFixed(5),
          timeInForce: "GTC",
        },
      };
    } else if (orderType.action === ACTION.MoveTP) {
      const oldTP = parseFloat(response1Object.trade.takeProfitOrder?.price || "0");
      if (!oldTP) {
        logToFileAsync(`No Take Profit Detected`);
        return false;
      }

      requestBody = {
        takeProfit: {
          price: orderType.action2 === ACTION.DOWN
            ? (oldTP - pipIncrement).toFixed(5)
            : (oldTP + pipIncrement).toFixed(5),
          timeInForce: "GTC",
        },
      };
    }

    const apiUrl2 = `${hostname}/v3/accounts/${accountId}/trades/${mostRecentTrade.id}/orders`;

    const response2 = await fetch(apiUrl2, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Accept-Datetime-Format": "RFC3339",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response2.ok) {
      logToFileAsync(`HTTP error! Status: ${response2.status}`);
      return false;
    }

    return true;
  }

  return false;
};
