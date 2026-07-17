import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getAutomationRuntime,
  startDemoAutomation,
  stopAutomation,
} from '../../../utils/automationProcessManager';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return res.status(200).json(getAutomationRuntime());
    if (req.method === 'POST') return res.status(200).json(startDemoAutomation());
    if (req.method === 'DELETE') return res.status(200).json(stopAutomation());
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[automation/runtime]', error);
    return res.status(500).json({ error: (error as Error).message });
  }
}

