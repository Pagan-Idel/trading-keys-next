export interface BodyItem {
  symbol: string;
  alias: string;
  bid: string;
  ask: string;
  change: string;
  high: string;
  low: string;
  timestampSec: number;
  timestampMs: number;
}

export type MarketWatchResponseMT = BodyItem[];

export interface ErrorMTResponse {
  errorMessage: string;
}

export const marketWatchMT = async (
  currency: string = "EURUSD"
): Promise<MarketWatchResponseMT | ErrorMTResponse> => {
  // Ensure localStorage is only accessed on the client-side
  let accountType = "";
  let tradingApiToken = "";
  let systemUuid = "";

  if (typeof window !== "undefined") {
    accountType = localStorage.getItem("accountType") || "";
    tradingApiToken = localStorage.getItem("TRADING_API_TOKEN") || "";
    systemUuid = localStorage.getItem("SYSTEM_UUID") || "";
  }

  const apiEndpoint = "/api/match-trader/market-watch";

  try {
    const response = await fetch(apiEndpoint, {
      method: "GET",
      headers: {
        TRADING_API_TOKEN: tradingApiToken,
        SYSTEM_UUID: systemUuid,
        Accept: "application/json",
        Hostname:
          accountType === "demo"
            ? "https://demo.match-trader.com"
            : "https://mtr.gooeytrade.com",
      },
      credentials: "include",
    });

    const rawResponseText = await response.text();
    if (!response.ok) {
      let errorResponse: ErrorMTResponse;
      try {
        errorResponse = JSON.parse(rawResponseText);
      } catch (e) {
        console.error("Error parsing error response as JSON:", e);
        throw new Error(`Error: ${rawResponseText}`);
      }
      console.error("Market Watch failed:", errorResponse.errorMessage);
      return errorResponse;
    }

    let data: MarketWatchResponseMT;
    try {
      data = JSON.parse(rawResponseText);
    } catch (e) {
      console.error("Error parsing success response as JSON:", e);
      throw new Error(`Error: ${rawResponseText}`);
    }

    return data;
  } catch (error) {
    console.error("An error occurred during market watch:", error);
    return {
      errorMessage: "An unknown error occurred during market watch",
    } as ErrorMTResponse;
  }
};
