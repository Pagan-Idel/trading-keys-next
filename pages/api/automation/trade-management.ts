import type { NextApiRequest,NextApiResponse } from 'next';
import { getTradeManagementEvents } from '../../../utils/automationStore';

export default function handler(req:NextApiRequest,res:NextApiResponse){
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({error:'Method not allowed'});
  }
  const tradeId=typeof req.query.tradeId==='string'?req.query.tradeId.trim():'';
  if(!tradeId)return res.status(400).json({error:'tradeId is required'});
  res.setHeader('Cache-Control','no-store');
  return res.status(200).json({tradeId,events:getTradeManagementEvents(tradeId),images:'deferred'});
}
