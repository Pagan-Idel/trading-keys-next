import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Pi runtime is read-only from the local dashboard.' });
  }
  const base=(process.env.PI_PULSE_URL??'http://127.0.0.1:4080').replace(/\/$/,'');
  const token=process.env.PI_PULSE_CONTROL_TOKEN??process.env.PULSE_CONTROL_TOKEN;
  try {
    const response=await fetch(`${base}/api/status`,{
      headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store',signal:AbortSignal.timeout(5000),
    });
    const payload=await response.json();
    return res.status(response.status).json(payload.runtime??payload);
  } catch (error) {
    return res.status(502).json({ error: `Pi runtime bridge unavailable: ${error instanceof Error?error.message:String(error)}` });
  }
}
