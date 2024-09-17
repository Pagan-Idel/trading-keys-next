// src/utils/api/currentPrice.ts
import { logToFileAsync } from "../../logger";
import credentials from "../../../credentials.json";

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
  // Check if we're in a browser environment for accessing localStorage
  let accountType = '';
  let hostname = '';
  let accountId = '';
  let token = '';

  if (typeof window !== 'undefined') {
    accountType = localStorage.getItem('accountType') || '';
    hostname = accountType === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
    accountId = accountType === 'live' ? credentials.NEXT_PUBLIC_OANDA_LIVE_ACCOUNT_ID : credentials.NEXT_PUBLIC_OANDA_DEMO_ACCOUNT_ID;
    token = accountType === 'live' ? credentials.NEXT_PUBLIC_OANDA_LIVE_ACCOUNT_TOKEN : credentials.NEXT_PUBLIC_OANDA_DEMO_ACCOUNT_TOKEN;
  }
  // Check if the environment variable is set
  if (!accountId || !token || !hostname) {
    logToFileAsync("Token or AccountId is not set.");
  }
 if (hostname?.includes("practice")) {
    hostname = "https://stream-fxpractice.oanda.com";
 } else {
    hostname = "https://stream-fxtrade.oanda.com";
 }
  const apiUrl = `${hostname}/v3/accounts/${accountId}/pricing/stream?instruments=${symbol}`;
  const response = await fetch(apiUrl, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const reader = response.body?.getReader(); // Use optional chaining here
  if (!reader) {
    throw new Error('Response body is null or undefined');
  }

  let result = '';
  let chunk;
  while (!(chunk = await reader.read()).done) {
    const chunkText = new TextDecoder().decode(chunk.value);
    result += chunkText;
    const lines = result.split('\n');
    result = lines.pop() || ''; // Save the incomplete line for the next iteration

    for (const line of lines) {
      try {
        const priceData: PriceStreamResponse = JSON.parse(line);
        if (priceData && priceData.asks && priceData.bids) {
          // Extract the most recent ask and bid prices
          const mostRecentAsk = priceData.asks[priceData.asks.length - 1]?.price || '';
          const mostRecentBid = priceData.bids[priceData.bids.length - 1]?.price || '';
          logToFileAsync("mostRecentBid", mostRecentBid);
          logToFileAsync("mostRecentAsk", mostRecentAsk);
          return { bid: mostRecentBid, ask: mostRecentAsk };
        }
      } catch (error) {
        console.error('Error parsing JSON:', error);
      }
    }
  }

  throw new Error('No valid price data received');
};