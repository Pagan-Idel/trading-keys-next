import type { NextApiRequest, NextApiResponse } from 'next';
import { getAutomationDashboard } from '../../../utils/automationStore';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestedLimit = Number(req.query.eventLimit ?? 120);
  const eventLimit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 20), 500)
    : 120;

  try {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ...getAutomationDashboard(eventLimit),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[automation/dashboard]', error);
    return res.status(500).json({ error: 'Failed to load automation dashboard' });
  }
}

