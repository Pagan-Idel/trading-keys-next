// pages/api/set-login-mode.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import { setLoginMode, getLoginMode } from '../../utils/loginState';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mode } = req.body;

  if (mode !== 'live' && mode !== 'demo') {
    return res.status(400).json({ error: 'Invalid mode. Use "live" or "demo".' });
  }

  setLoginMode(mode);
  return res.status(200).json({ message: `Login mode set to ${mode}` });
}
