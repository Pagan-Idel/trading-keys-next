import type {NextApiRequest,NextApiResponse} from 'next';

export default async function handler(req:NextApiRequest,res:NextApiResponse){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const pair=typeof req.query.pair==='string'?req.query.pair:'';
  if(!pair)return res.status(400).json({error:'Pair is required'});
  const base=(process.env.PI_PULSE_URL??'http://127.0.0.1:4080').replace(/\/$/,'');
  const token=process.env.PI_PULSE_CONTROL_TOKEN??process.env.PULSE_CONTROL_TOKEN;
  try{
    const response=await fetch(`${base}/api/zones?pair=${encodeURIComponent(pair)}`,{
      headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store',signal:AbortSignal.timeout(5000),
    });
    const payload=await response.json();
    return res.status(response.status).json(payload);
  }catch(error){return res.status(502).json({error:`Pi zone bridge unavailable: ${error instanceof Error?error.message:String(error)}`})}
}
