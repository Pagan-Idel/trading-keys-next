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
    // Success if any fill or order transaction exists, failure if any reject or error
    let isGood = false;
    let reason = undefined;
    let errorMsg = undefined;
    if (result && typeof result === 'object') {
      const raw = result.raw || result;
      if (
        raw.takeProfitOrderTransaction ||
        raw.stopLossOrderTransaction ||
        raw.takeProfitOrderFillTransaction ||
        raw.stopLossOrderFillTransaction
      ) {
        isGood = true;
        reason = 'Order modified';
      }
      if (
        raw.takeProfitOrderRejectTransaction ||
        raw.stopLossOrderRejectTransaction ||
        raw.errorMessage ||
        raw.errorCode
      ) {
        isGood = false;
        reason = 'Order modification rejected';
        errorMsg = raw.errorMessage || 'Modification rejected';
      }
    }
    res.status(200).json({
      success: isGood,
      reason,
      raw: result,
      error: isGood ? undefined : errorMsg
    });
  } catch (error: any) {
    console.error('[API][modifyTrade] Error:', error);
    res.status(500).json({ error: error.message || 'Modify trade failed' });
  }
}
