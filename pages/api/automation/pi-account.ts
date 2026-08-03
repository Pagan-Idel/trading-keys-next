import type {NextApiRequest,NextApiResponse} from 'next';

export default async function handler(req:NextApiRequest,res:NextApiResponse){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const base=(process.env.PI_PULSE_URL??'http://127.0.0.1:4080').replace(/\/$/,'');
  const token=process.env.PI_PULSE_CONTROL_TOKEN??process.env.PULSE_CONTROL_TOKEN;
  try{
    const response=await fetch(`${base}/api/account`,{
      headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store',signal:AbortSignal.timeout(10000),
    });
    const payload=await response.json();
    return res.status(response.status).json(payload);
  }catch(error){
    return res.status(502).json({error:`Pi OANDA account bridge unavailable: ${error instanceof Error?error.message:String(error)}`});
  }
}
