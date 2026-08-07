import type {NextApiRequest,NextApiResponse} from 'next';
import {forexPairs} from '../../../utils/constants';
import {isAuthoritativeAutomationCandlePage} from '../../../utils/automationChartContract';

const supportedTimeframes=['M1','M5','M15','H1'] as const;

export default async function handler(req:NextApiRequest,res:NextApiResponse){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const pair=String(req.query.pair??'').toUpperCase();
  const timeframe=String(req.query.timeframe??'').toUpperCase();
  if(!forexPairs.includes(pair))return res.status(400).json({error:'Unsupported pair'});
  if(!supportedTimeframes.includes(timeframe as typeof supportedTimeframes[number]))return res.status(400).json({error:'Unsupported timeframe'});
  const before=Number(req.query.before),after=Number(req.query.after);
  if(Number.isFinite(before)&&Number.isFinite(after))return res.status(400).json({error:'Choose before or after, not both'});
  const base=(process.env.PI_PULSE_URL??'http://127.0.0.1:4080').replace(/\/$/,'');
  const token=process.env.PI_PULSE_CONTROL_TOKEN??process.env.PULSE_CONTROL_TOKEN;
  const params=new URLSearchParams({pair,timeframe});
  if(Number.isFinite(before))params.set('before',String(before));
  if(Number.isFinite(after))params.set('after',String(after));
  if(req.query.limit!==undefined)params.set('limit',String(req.query.limit));
  try{
    const response=await fetch(`${base}/api/zone-candles?${params}`,{
      headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store',signal:AbortSignal.timeout(5_000),
    });
    const payload=await response.json();
    if(response.ok&&!isAuthoritativeAutomationCandlePage(payload))return res.status(502).json({error:'Pi returned an incomplete authoritative candle page.'});
    res.setHeader('Cache-Control','no-store');
    return res.status(response.status).json(payload);
  }catch(error){return res.status(502).json({error:`Pi candle bridge unavailable: ${error instanceof Error?error.message:String(error)}`})}
}
