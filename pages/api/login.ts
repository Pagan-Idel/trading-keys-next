import type { NextApiRequest, NextApiResponse } from 'next';
import { handleOandaLogin } from '../../utils/oanda/api/login';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { pair, mode } = req.body;
    const result = await handleOandaLogin(pair, mode);
    res.status(200).json({ success: true, result });
  } catch (error: any) {
    console.error('[API][login] Error:', error);
    res.status(500).json({ error: error.message || 'Login failed' });
  }
}
