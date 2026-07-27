// src/utils/oanda/api/order.ts

import type { OrderParameters } from "../../shared";
import { logMessage } from "../../logger";
import credentials from "../../../credentials.json";
import { type RISK, calculateRisk, getPrecision, normalizeOandaSymbol } from "../../shared";
import { getLoginMode } from "../../loginState";
import { estimateMarginFromStopRisk } from "../../portfolioMargin";
import { PortfolioRiskCoordinator } from "../../portfolioRiskCoordinator";
import { ACTION, TYPE } from "../orderTypes";

export { ACTION, TYPE } from "../orderTypes";
export type { ACTION as OrderAction } from "../orderTypes";

export interface ActionOnFill {
  price: string;
}

export interface MarketOrderRequest {
  type?: keyof typeof TYPE;
  instrument?: string;
  units?: string;
  price?: string;
  tradeID?: string;
  stopLossOnFill?: ActionOnFill;
  takeProfitOnFill?: ActionOnFill;
  timeInForce: string;
  positionFill?: "OPEN_ONLY" | "REDUCE_FIRST" | "REDUCE_ONLY" | "DEFAULT";
}

export interface OrderRequest {
  order: MarketOrderRequest;
}

export const order = async (orderType: OrderParameters, mode: 'live' | 'demo' = getLoginMode()): Promise<{ success: boolean; reason: string; raw: any }> => {
  const fileName = "order";
  logMessage("Placing order", orderType, { fileName });

  const pair = orderType.pair;
  if (!pair) {
    logMessage("❌ Pair is not specified in orderType", orderType, { level: "error", fileName });
    return { success: false, reason: 'Pair not specified', raw: orderType };
  }

  const normalizedPair = normalizeOandaSymbol(pair);
  const accountType = mode;
  const hostname = accountType === "live"
    ? "https://api-fxtrade.oanda.com"
    : "https://api-fxpractice.oanda.com";
  const accountId = accountType === "live"
    ? credentials.OANDA_LIVE_ACCOUNT_ID
    : credentials.OANDA_DEMO_ACCOUNT_ID;
  const token = accountType === "live"
    ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
    : credentials.OANDA_DEMO_ACCOUNT_TOKEN;

  if (!accountId || !hostname || !token) {
    logMessage("❌ Missing accountId, token, or hostname", { accountType, accountId, token, hostname }, { level: "error", fileName });
    return { success: false, reason: 'Missing accountId, token, or hostname', raw: { accountType, accountId, token, hostname } };
  }

  // Always use calculated SL/TP prices from calculateRisk
  const riskData: RISK | undefined = await calculateRisk(orderType, pair, mode);
  if (!riskData?.units || !riskData?.stopLoss || !riskData?.takeProfit) {
    logMessage("❌ Error Calculating Risk — incomplete data", riskData, { level: "error", fileName });
    return { success: false, reason: 'Error Calculating Risk — incomplete data', raw: riskData };
  }

  const units = riskData.units;
  const stopLoss = riskData.stopLoss;
  const takeProfit = riskData.takeProfit;
  const signedUnits = `${orderType.action === ACTION.SELL ? '-' : ''}${units}`;
  const marginEstimate = estimateMarginFromStopRisk({
    pair,
    entry: riskData.entryPrice,
    stopLoss: Number(stopLoss),
    riskAmount: riskData.riskAmount,
    accountMarginRate: riskData.accountMarginRate,
  });
  const marginCoordinator = new PortfolioRiskCoordinator();
  const marginReservation = marginCoordinator.reserve({
    pair,
    mode,
    proposedMargin: marginEstimate.requiredMargin,
    proposedRiskAmount: riskData.riskAmount,
    account: {
      nav: riskData.accountNav,
      marginAvailable: riskData.marginAvailable,
      marginUsed: riskData.marginUsed,
      marginCloseoutNav: riskData.marginCloseoutNav,
      marginCloseoutPercent: riskData.marginCloseoutPercent,
      openTradeCount: riskData.openTradeCount,
    },
  });
  if (!marginReservation.allowed || !marginReservation.reservationId) {
    marginCoordinator.close();
    logMessage(
      `Portfolio margin rejected ${pair}: ${marginReservation.reason}`,
      { marginEstimate, marginReservation },
      { level: "warn", fileName },
    );
    return {
      success: false,
      reason: marginReservation.reason,
      raw: { marginEstimate, marginReservation },
    };
  }
  const reservationId = marginReservation.reservationId;
  logMessage(
    "Portfolio margin reserved",
    { pair, signedUnits, stopLoss, takeProfit, marginEstimate, marginReservation },
    { level: "info", fileName },
  );

  const requestBody: OrderRequest = {
    order: {
      type: TYPE.MARKET,
      instrument: normalizedPair,
      units: signedUnits,
      stopLossOnFill: {
        price: stopLoss
      },
      takeProfitOnFill: {
        price: takeProfit
      },
      timeInForce: "FOK",
      positionFill: "OPEN_ONLY",
    }
  };

  const apiUrl = `${hostname}/v3/accounts/${accountId}/orders`;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "Accept-Datetime-Format": "RFC3339"
      },
      body: JSON.stringify(requestBody)
    });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = text;
    }

    if (!response.ok) {
      marginCoordinator.release(reservationId);
      marginCoordinator.close();
      logMessage("❌ HTTP error placing order", { status: response.status, errorText: json }, { level: "error", fileName });
      return { success: false, reason: json?.orderCancelTransaction?.reason || json?.errorMessage || 'HTTP error', raw: json };
    }

    // Extract reason from OANDA response
    let reason = 'UNKNOWN';
    if (json?.orderFillTransaction?.reason) {
      reason = json.orderFillTransaction.reason;
    } else if (json?.orderCancelTransaction?.reason) {
      reason = json.orderCancelTransaction.reason;
    } else if (json?.orderCreateTransaction?.reason) {
      reason = json.orderCreateTransaction.reason;
    }

    logMessage("✅ Order placed response", json, { level: "info", fileName });
    const openedTradeId =
      json?.orderFillTransaction?.tradeOpened?.tradeID ??
      json?.orderFillTransaction?.tradeOpenedID;
    if (json?.orderFillTransaction) {
      marginCoordinator.markFilled(
        reservationId,
        openedTradeId ? String(openedTradeId) : undefined,
      );
    } else {
      marginCoordinator.release(reservationId);
    }
    marginCoordinator.close();
    return { success: !!json?.orderFillTransaction, reason, raw: json };

  } catch (err: any) {
    marginCoordinator.release(reservationId);
    marginCoordinator.close();
    logMessage("❌ Fetch threw an error", err, { level: "error", fileName });
    return { success: false, reason: err?.message || 'Fetch error', raw: err };
  }
}
// ...existing code up to the correct order function implementation...
