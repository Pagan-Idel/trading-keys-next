import { logMessage  } from "../../logger.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credentialsRaw = await fs.readFile(path.join(__dirname, '../../../credentials.json'), 'utf-8');
const credentials = JSON.parse(credentialsRaw);

import { Candle } from "../../swingLabeler.js";
import { normalizeOandaSymbol } from "../../shared.js";
import { loginMode } from "../../../runner/startRunner.js";
export const fetchCandles = async (
  symbol: string,
  interval: string,
  count: number = 300
): Promise<Candle[]> => {
  try {
    let accountType = '';
    let hostname = '';
    let accountId = '';
    let token = '';

    if (typeof window !== "undefined") {
      accountType = localStorage.getItem("accountType") || loginMode;
      hostname =
        accountType === "live"
          ? "https://api-fxtrade.oanda.com"
          : "https://api-fxpractice.oanda.com";

      accountId =
        accountType === "live"
          ? credentials.OANDA_LIVE_ACCOUNT_ID
          : credentials.OANDA_DEMO_ACCOUNT_ID;

      token =
        accountType === "live"
          ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
          : credentials.OANDA_DEMO_ACCOUNT_TOKEN;
    }

    if (!accountId || !hostname || !token) {
      throw new Error("❌ Missing OANDA credentials or hostname.");
    }
    const instrument = normalizeOandaSymbol(symbol);
    const granularity = interval.toUpperCase();
    const url = `${hostname}/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}`;

    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      logMessage ("❌ Failed to fetch candles", errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.candles;
  } catch (error) {
    logMessage ("🚫 fetchCandles failed:", (error as Error).message);
    throw error;
  }
};
