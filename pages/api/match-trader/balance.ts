import { NextApiRequest, NextApiResponse } from 'next';
import redisClient from '../../../redisClient';
import { BalanceResponseMT } from '../../../utils/match-trader/api/balance';

export interface ErrorResponse {
  errorMessage: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }
  if (!req.url?.includes('balance')) {
    res.status(404).end(`Path ${req.url} Not Found`);
    return;
  }

  try {
    // Retrieve tokens from Redis
    const coAuth = await redisClient.get('co-auth');
    const tradingApiToken = await redisClient.get('TRADING_API_TOKEN');
    const systemUuid = await redisClient.get('SYSTEM_UUID');

    if (!tradingApiToken || !systemUuid) {
      res.status(400).json({ errorMessage: 'Missing TRADING_API_TOKEN or SYSTEM_UUID from Redis' });
      return;
    }

    const hostname = `${req.headers.hostname}`;
    const api = `/mtr-api/${systemUuid}/balance`;

    const response = await fetch(hostname + api, {
      method: 'GET',
      headers: {
        'Cookie': `co-auth=${coAuth};`,
        'Auth-trading-api': tradingApiToken,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorResponse: ErrorResponse = await response.json();
      console.log(`HTTP error! Status: ${response.status}`, errorResponse);
      res.status(response.status).json({ errorMessage: `HTTP error! Status: ${response.status}`, details: errorResponse });
      return;
    }

    const responseData: BalanceResponseMT = await response.json();
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
