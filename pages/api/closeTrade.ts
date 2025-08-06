import type { NextApiRequest, NextApiResponse } from 'next';
import { closeTrade } from '../../utils/oanda/api/closeTrade';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { orderType, pair, unitsOverride, mode } = req.body;
    if (!orderType) {
      return res.status(400).json({ error: 'Missing orderType' });
    }
    const result = await closeTrade(orderType, pair, unitsOverride, mode);
    res.status(200).json({ success: true, result });
  } catch (error: any) {
    console.error('[API][closeTrade] Error:', error);
    res.status(500).json({ error: error.message || 'Close trade failed' });
  }
}
