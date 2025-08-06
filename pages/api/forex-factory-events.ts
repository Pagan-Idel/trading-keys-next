import type { NextApiRequest, NextApiResponse } from 'next';
import { fetchForexFactoryEvents } from '../../utils/forexFactoryScraper';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { date } = req.query;
    const events = await fetchForexFactoryEvents(typeof date === 'string' ? date : undefined);
    res.status(200).json({ events });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch events' });
  }
}
