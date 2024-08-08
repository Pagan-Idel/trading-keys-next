// pages/api/login.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { OpenPostionResponseMT } from '../../../utils/match-trader/api/open';
import redisClient from '../../../redisClient';

export interface ErrorResponse {
  errorMessage: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }
  if (!req.url?.includes('/open')) {
    res.status(404).end(`Path ${req.url} Not Found`);
    return;
  }
  const coAuth = await redisClient.get('co-auth');
  const hostname = "https://mtr.gooeytrade.com";
  const api: string = `/mtr-api/${req.headers.system_uuid}/position/open`;

  console.log(req.body);
  try {
    const response = await fetch(hostname + api, {
      method: 'POST',
      headers: {
        'Cookie': `co-auth=${coAuth};`,
        'Auth-trading-api': `${req.headers.trading_api_token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: req.body
    });

    if (!response.ok) {
      const errorResponse: ErrorResponse = await response.json();
      console.log(`HTTP error! Status: ${response.status}`, errorResponse);
      res.status(response.status).json({ errorMessage: `HTTP error! Status: ${response.status}`, details: errorResponse });
      return;
    }
    
    const responseData: OpenPostionResponseMT = await response.json();
    redisClient.set('recentTrade-openVolume', req.body.volume);
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