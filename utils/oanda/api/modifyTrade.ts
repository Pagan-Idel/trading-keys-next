// src/utils/oanda/api/modifyTrade.ts

import type { OrderParameters } from "../../shared";
import { logMessage } from "../../logger";
import credentials from "../../../credentials.json";
import { getPipIncrement, getPrecision, normalizePairKeyUnderscore } from "../../shared";
import type { Trade, TradeById } from "./openNow";
import { openNow } from "./openNow";
import { ACTION } from "./order";
import { getLoginMode } from "../../loginState";

interface ModifyRequest {
  takeProfit?: OrderDetails;
  stopLoss?: OrderDetails;
}

interface OrderDetails {
  timeInForce: string;
  price: string;
}

export const modifyTrade = async (
  orderType: OrderParameters,
  pairOrTradeId: string,
  mode: 'live' | 'demo' = 'demo'
): Promise<boolean> => {
  const hostname =
    mode === "live"
      ? "https://api-fxtrade.oanda.com"
      : "https://api-fxpractice.oanda.com";

  const accountId =
    mode === "live"
      ? credentials.OANDA_LIVE_ACCOUNT_ID
      : credentials.OANDA_DEMO_ACCOUNT_ID;

  const token =
    mode === "live"
      ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
      : credentials.OANDA_DEMO_ACCOUNT_TOKEN;

  if (!accountId || !token) {
    logMessage("❌ Token or AccountId is not set.", undefined, { fileName: "modifyTrade" });
    return false;
  }

  const openTrades = await openNow(pairOrTradeId, mode);
  const trade = openTrades?.trades.find(
    t =>
      t.id === pairOrTradeId ||
      t.clientExtensions?.id === pairOrTradeId ||
      normalizePairKeyUnderscore(t.instrument!) === normalizePairKeyUnderscore(pairOrTradeId)
  );

  if (!trade) {
    logMessage(`❌ Trade not found for ${pairOrTradeId}`, undefined, { fileName: "modifyTrade" });
    return false;
  }

  const instrument = trade.instrument!;
  const pipIncrement = getPipIncrement(instrument);
  const precision = getPrecision(instrument);

  // === SL AT ENTRY ===
  if (orderType.action === ACTION.SLatEntry) {
    const requestBody: ModifyRequest = {
      stopLoss: {
        price: parseFloat(trade.price!).toFixed(precision),
        timeInForce: "GTC"
      }
    };

    const apiUrl = `${hostname}/v3/accounts/${accountId}/trades/${trade.id}/orders`;
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
      logMessage(`❌ SL at Entry failed. HTTP ${response.status}`, undefined, {
        fileName: "modifyTrade",
        pair: instrument
      });
      return false;
    }

    logMessage(`✅ SL at Entry set to ${requestBody.stopLoss?.price}`, requestBody, {
      fileName: "modifyTrade",
      pair: instrument
    });

    return true;
  }

  // === MOVE SL/TP ===
  if (orderType.action === ACTION.MoveSL || orderType.action === ACTION.MoveTP) {
    const tradeUrl = `${hostname}/v3/accounts/${accountId}/trades/${trade.id}`;
    const tradeResponse = await fetch(tradeUrl, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    if (!tradeResponse.ok) {
      logMessage(`❌ Failed to fetch trade details. HTTP ${tradeResponse.status}`, undefined, {
        fileName: "modifyTrade",
        pair: instrument
      });
      return false;
    }

    const response1Object: TradeById = await tradeResponse.json();
    let requestBody: ModifyRequest = {};

    if (orderType.action === ACTION.MoveSL) {
      const oldSL = parseFloat(response1Object.trade.stopLossOrder?.price || "0");
      if (!oldSL) {
        logMessage(`⚠️ No Stop Loss Detected.`, undefined, {
          fileName: "modifyTrade",
          pair: instrument
        });
        return false;
      }

      const newSL =
        orderType.action2 === ACTION.DOWN
          ? oldSL - pipIncrement
          : oldSL + pipIncrement;

      requestBody = {
        stopLoss: {
          price: newSL.toFixed(precision),
          timeInForce: "GTC"
        }
      };
    } else if (orderType.action === ACTION.MoveTP) {
      const oldTP = parseFloat(response1Object.trade.takeProfitOrder?.price || "0");
      if (!oldTP) {
        logMessage(`⚠️ No Take Profit Detected.`, undefined, {
          fileName: "modifyTrade",
          pair: instrument
        });
        return false;
      }

      const newTP =
        orderType.action2 === ACTION.DOWN
          ? oldTP - pipIncrement
          : oldTP + pipIncrement;

      requestBody = {
        takeProfit: {
          price: newTP.toFixed(precision),
          timeInForce: "GTC"
        }
      };
    }

    const updateUrl = `${hostname}/v3/accounts/${accountId}/trades/${trade.id}/orders`;
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
      logMessage(`❌ Failed to modify trade. HTTP ${updateResponse.status}`, requestBody, {
        fileName: "modifyTrade",
        pair: instrument
      });
      return false;
    }

    logMessage(`✅ Successfully modified trade ${trade.id}`, requestBody, {
      fileName: "modifyTrade",
      pair: instrument
    });

    return true;
  }

  return false;
};
