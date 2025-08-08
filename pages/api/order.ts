import type { NextApiRequest, NextApiResponse } from 'next';
import { order } from '../../utils/oanda/api/order';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { orderType, mode } = req.body;
    if (!orderType) {
      return res.status(400).json({ error: 'Missing orderType' });
    }
  const result = await order(orderType, mode);
  res.status(200).json(result);
  } catch (error: any) {
    console.error('[API][order] Error:', error);
    res.status(500).json({ error: error.message || 'Order failed' });
  }
}
