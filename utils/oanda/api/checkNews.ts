// src/utils/api/checkNews.ts

import { logToFileAsync } from "../../logger";
import credentials from "../../../credentials.json";
import { forexPairs } from "../../shared";

// 🔁 Extract and dedupe currency codes (e.g. EUR, USD, JPY)
const getUniqueCurrencyCodes = (): string => {
  const codes = new Set<string>();
  forexPairs.forEach(pair => {
    const base = pair.slice(0, 3).toUpperCase();
    const quote = pair.slice(3).toUpperCase();
    codes.add(base);
    codes.add(quote);
  });
  return Array.from(codes).join(",");
};

// 🔑 FCS API Access Key
const FCS_API_KEY = credentials.FCS_API_KEY || process.env.FCS_API_KEY;

// 🧠 Main Function
export const checkNews = async (): Promise<any> => {
  const symbols = getUniqueCurrencyCodes(); // e.g., "EUR,USD,JPY,GBP,CHF,CAD,NZD,AUD"
  const url = `https://fcsapi.com/api-v3/forex/economy_cal?symbol=${symbols}&access_key=${FCS_API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`FCS API error: ${response.statusText}`);
    }

    const json = await response.json();

    if (!json || !json.response) {
      throw new Error("Invalid response structure from FCS API");
    }

    await logToFileAsync("✅ FCS Calendar Fetched", json.response);
    return json.response;

  } catch (error: any) {
    await logToFileAsync("❌ Error fetching economic calendar", error.message || error);
    return { error: true, message: error.message || "Unknown error" };
  }
};
