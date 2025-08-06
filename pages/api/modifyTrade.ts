import type { NextApiRequest, NextApiResponse } from 'next';
import { modifyTrade } from '../../utils/oanda/api/modifyTrade';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { orderType, pairOrTradeId, mode } = req.body;
    if (!orderType || !pairOrTradeId) {
      return res.status(400).json({ error: 'Missing orderType or pairOrTradeId' });
    }
    const result = await modifyTrade(orderType, pairOrTradeId, mode);
    res.status(200).json({ success: true, result });
  } catch (error: any) {
    console.error('[API][modifyTrade] Error:', error);
    res.status(500).json({ error: error.message || 'Modify trade failed' });
  }
}
