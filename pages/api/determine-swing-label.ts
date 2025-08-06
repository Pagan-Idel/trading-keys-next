import type { NextApiRequest, NextApiResponse } from 'next';
import { fetchCandles } from '../../utils/oanda/api/fetchCandles';
import { determineSwingPoints } from '../../utils/swingLabeler';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { symbol, interval } = req.query;
  if (typeof symbol !== 'string' || typeof interval !== 'string') {
    return res.status(400).json({ error: 'Invalid params' });
  }
  try {
    const candles = await fetchCandles(symbol, interval, 5000);
    if (!candles || candles.length < 2) {
      return res.status(200).json({ swingPoints: [] });
    }
    const swingPoints = determineSwingPoints(candles);
    const currentPrice = candles[candles.length - 1].close;
    res.status(200).json({ swingPoints, currentPrice });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch swing points' });
  }
}
