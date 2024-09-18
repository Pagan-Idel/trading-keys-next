import { NextApiRequest, NextApiResponse } from 'next';
import redisClient from '../../redisClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  const { TRADING_API_TOKEN, SYSTEM_UUID } = req.body;

  if (!TRADING_API_TOKEN || !SYSTEM_UUID) {
    res.status(400).json({ errorMessage: 'Missing required fields: TRADING_API_TOKEN or SYSTEM_UUID' });
    return;
  }

  try {
    await redisClient.set('TRADING_API_TOKEN', TRADING_API_TOKEN);
    await redisClient.set('SYSTEM_UUID', SYSTEM_UUID);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error saving to Redis:', error);
    res.status(500).json({ errorMessage: 'Failed to save tokens to Redis' });
  }
}
