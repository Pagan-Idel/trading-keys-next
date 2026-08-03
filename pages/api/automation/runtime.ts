import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET','POST','DELETE'].includes(req.method??'')) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const base=(process.env.PI_PULSE_URL??'http://127.0.0.1:4080').replace(/\/$/,'');
  const token=process.env.PI_PULSE_CONTROL_TOKEN??process.env.PULSE_CONTROL_TOKEN;
  try {
    if(req.method!=='GET'&&!token)return res.status(503).json({error:'Pi control credentials are unavailable on this PC.'});
    const path=req.method==='GET'?'/api/status':req.method==='POST'?'/api/start':'/api/stop';
    const response=await fetch(`${base}${path}`,{
      method:req.method==='GET'?'GET':'POST',headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store',signal:AbortSignal.timeout(15000),
    });
    const payload=await response.json();
    return res.status(response.status).json(req.method==='GET'?(payload.runtime??payload):payload);
  } catch (error) {
    return res.status(502).json({ error: `Pi runtime bridge unavailable: ${error instanceof Error?error.message:String(error)}` });
  }
}
