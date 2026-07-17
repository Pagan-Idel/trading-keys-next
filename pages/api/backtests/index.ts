import type { NextApiRequest,NextApiResponse } from 'next';
import { deleteBacktestRun,getBacktestDashboard } from '../../../utils/backtestStore';
import { cancelBacktest, startBacktest } from '../../../utils/backtestRunner';

export default function handler(req:NextApiRequest,res:NextApiResponse){
  try{
    if(req.method==='GET')return res.status(200).json(getBacktestDashboard(typeof req.query.runId==='string'?req.query.runId:undefined));
    if(req.method==='POST')return res.status(202).json(startBacktest(req.body??{}));
    if(req.method==='DELETE'){
      const id=typeof req.query.runId==='string'?req.query.runId:String(req.body?.runId??'');
      if(!id)throw new Error('A backtest run ID is required.');
      if(req.query.permanent==='true')return res.status(200).json(deleteBacktestRun(id));
      return res.status(200).json(cancelBacktest(id));
    }
    res.setHeader('Allow','GET, POST, DELETE');
    return res.status(405).json({error:'Method not allowed'});
  }catch(error){return res.status(409).json({error:error instanceof Error?error.message:String(error)})}
}
