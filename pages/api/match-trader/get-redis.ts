import type { NextApiRequest, NextApiResponse } from 'next';
import redisClient from '../../../redisClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      // Example of getting a value from Redis
      const value = await redisClient.get(`${req.headers.rediskey}`);
      res.status(200).json({ value });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch data from Redis' });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}