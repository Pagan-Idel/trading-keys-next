import type {NextApiRequest,NextApiResponse} from 'next';
import {forexPairs} from '../../../utils/constants';
import {getArchivedCandleBounds,readArchivedCandlePage} from '../../../utils/candleArchive';

const supportedTimeframes=['M1','M5','M15','H1'] as const;

export default function handler(req:NextApiRequest,res:NextApiResponse){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const pair=String(req.query.pair??'').toUpperCase();
  const timeframe=String(req.query.timeframe??'').toUpperCase();
  if(!forexPairs.includes(pair))return res.status(400).json({error:'Unsupported pair'});
  if(!supportedTimeframes.includes(timeframe as typeof supportedTimeframes[number]))return res.status(400).json({error:'Unsupported timeframe'});
  const key={mode:'demo' as const,pair,timeframe};
  const bounds=getArchivedCandleBounds(key);
  const before=Number(req.query.before),after=Number(req.query.after);
  if(Number.isFinite(before)&&Number.isFinite(after))return res.status(400).json({error:'Choose before or after, not both'});
  const archived=readArchivedCandlePage(key,{
    before:Number.isFinite(before)?before:undefined,
    after:Number.isFinite(after)?after:undefined,
    limit:Number(req.query.limit)||1_000,
  });
  const candles=archived.map(candle=>({
    time:Math.floor(Date.parse(String(candle.time))/1_000),
    open:candle.open,high:candle.high,low:candle.low,close:candle.close,
  }));
  const first=candles[0]?.time,last=candles.at(-1)?.time;
  res.setHeader('Cache-Control','no-store');
  return res.status(200).json({
    pair,timeframe,candles,bounds,
    hasOlder:bounds.startTime!==null&&(first??(Number.isFinite(before)?before:bounds.endTime??0))>bounds.startTime,
    hasNewer:bounds.endTime!==null&&(last??(Number.isFinite(after)?after:bounds.startTime??0))<bounds.endTime,
  });
}
