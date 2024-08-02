// pages/api/login.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { MarketWatchResponseMT } from '../../../utils/match-trader/api/market-watch';

export interface ErrorResponse {
  errorMessage: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }
  if (!req.url?.includes('market-watch')) {
    res.status(404).end(`Path ${req.url} Not Found`);
    return;
  }
  const hostname = "https://mtr.gooeytrade.com";
  const api: string = `/platformUrl/mtr-api/${req.headers.SYSTEM_UUID}/quotations`;
  const parameters: string = req.headers.currency as string;
  try {
    const response = await fetch(hostname + api + '?symbols=' + parameters, {
      method: 'GET',
      headers: {
        'Auth-trading-api': `${req.headers.TRADING_API_TOKEN}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'co-auth': `${req.headers.coauth}`
      }
    });

    console.log(req.headers);

    if (!response.ok) {
      const errorResponse: ErrorResponse = await response.json();
      console.log(`HTTP error! Status: ${response.status}`, errorResponse);
      res.status(response.status).json({ errorMessage: `HTTP error! Status: ${response.status}`, details: errorResponse });
      return;

    }

    const responseData: MarketWatchResponseMT = await response.json();

    res.status(200).json(responseData);
  } catch (error: unknown) {
    let errorMessage = 'An unknown error occurred';

    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    }

    console.log(`Error: ${errorMessage}`);
    res.status(500).json({ errorMessage: `Error: ${errorMessage}` });
  }
}