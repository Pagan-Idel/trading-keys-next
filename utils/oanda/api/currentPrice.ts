// src/utils/api/currentPrice.ts
import { logMessage  } from "../../logger.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credentialsRaw = await fs.readFile(path.join(__dirname, '../../../credentials.json'), 'utf-8');
const credentials = JSON.parse(credentialsRaw);

import { normalizeOandaSymbol } from "../../shared.js";
import { loginMode } from "../../../runner/startRunner.js";

interface PriceTick {
  liquidity: number;
  price: string;
}

interface PriceStreamResponse {
  asks: PriceTick[];
  bids: PriceTick[];
  closeoutAsk: string;
  closeoutBid: string;
  instrument: string;
  status: string;
  time: string;
}

export const currentPrice = async (symbol: string): Promise<{ bid: string; ask: string }> => {
  let accountType = '';
  let hostname = '';
  let accountId = '';
  let token = '';

  if (typeof window !== 'undefined') {
    accountType = localStorage.getItem('accountType') || loginMode;
    hostname = accountType === 'live'
      ? 'https://api-fxtrade.oanda.com'
      : 'https://api-fxpractice.oanda.com';

    accountId = accountType === 'live'
      ? credentials.OANDA_LIVE_ACCOUNT_ID
      : credentials.OANDA_DEMO_ACCOUNT_ID;

    token = accountType === 'live'
      ? credentials.OANDA_LIVE_ACCOUNT_TOKEN
      : credentials.OANDA_DEMO_ACCOUNT_TOKEN;
  }

  if (!accountId || !token || !hostname) {
    logMessage ("❌ Token, AccountId, or Hostname is not set.");
    throw new Error("Missing credentials.");
  }

  hostname = hostname.includes("practice")
    ? "https://stream-fxpractice.oanda.com"
    : "https://stream-fxtrade.oanda.com";

  const instrument = normalizeOandaSymbol(symbol);
  const apiUrl = `${hostname}/v3/accounts/${accountId}/pricing/stream?instruments=${instrument}`;
  const response = await fetch(apiUrl, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is null or undefined');
  }

  let result = '';
  let chunk;
  while (!(chunk = await reader.read()).done) {
    const chunkText = new TextDecoder().decode(chunk.value);
    result += chunkText;
    const lines = result.split('\n');
    result = lines.pop() || '';

    for (const line of lines) {
      try {
        const priceData: PriceStreamResponse = JSON.parse(line);
        if (priceData && priceData.asks && priceData.bids) {
          const mostRecentAsk = priceData.asks.at(-1)?.price || '';
          const mostRecentBid = priceData.bids.at(-1)?.price || '';
          logMessage ("mostRecentBid", mostRecentBid);
          logMessage ("mostRecentAsk", mostRecentAsk);
          return { bid: mostRecentBid, ask: mostRecentAsk };
        }
      } catch (error) {
        console.error('Error parsing JSON:', error);
      }
    }
  }

  throw new Error('No valid price data received');
};
