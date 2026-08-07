import type { NextApiRequest,NextApiResponse } from 'next';
import { clearAllBacktestData,clearBacktestLeaderboard,deleteBacktestRun,getBacktestDashboard,getBacktestRunUid,getBacktestTradeById,getBacktestTrainingData,resolveBacktestRunId } from '../../../utils/backtestStore';
import { cancelBacktest, startBacktest } from '../../../utils/backtestRunner';
import {findAutoResearchCampaignSearch,getBestAutoResearchConfiguration} from '../../../utils/autoResearchStore.ts';
import {manualBacktestDefaultsFromLeader} from '../../../utils/backtestDefaults.ts';
import {selectCampaignRun} from '../../../utils/campaignSearch.ts';

export default function handler(req:NextApiRequest,res:NextApiResponse){
  try{
    if(req.method==='GET'){
      if(req.query.training==='true')return res.status(200).json({rows:getBacktestTrainingData(typeof req.query.runId==='string'?req.query.runId:undefined),images:'deferred'});
      if(typeof req.query.tradeId==='string'){
        const trade=getBacktestTradeById(req.query.tradeId);
        if(!trade)return res.status(404).json({error:'Trade ID was not found.'});
        return res.status(200).json({trade});
      }
      const leader=getBestAutoResearchConfiguration();
      if(typeof req.query.campaignId==='string'){
        const query=req.query.campaignId.trim();
        const resolvedRunId=resolveBacktestRunId(query);
        const research=findAutoResearchCampaignSearch(query,resolvedRunId);
        if(research){
          const campaignRuns=research.runs.map(run=>({...run,runUid:run.backtestRunId?getBacktestRunUid(run.backtestRunId)??null:null}));
          const matched=selectCampaignRun(campaignRuns,research.matchedTrialId);
          const dashboard=getBacktestDashboard(matched?.backtestRunId??'__campaign_without_run__');
          return res.status(200).json({...dashboard,defaultConfig:leader?manualBacktestDefaultsFromLeader(leader):null,campaignSearch:{...research,runs:campaignRuns}});
        }
        if(!resolvedRunId)return res.status(404).json({error:`Campaign ${query} was not found.`});
        const dashboard=getBacktestDashboard(resolvedRunId);
        const selected=(dashboard.runResults as Array<any>).find(run=>run.id===dashboard.selectedRunId);
        return res.status(200).json({...dashboard,defaultConfig:leader?manualBacktestDefaultsFromLeader(leader):null,campaignSearch:{kind:'manual-campaign',id:getBacktestRunUid(resolvedRunId)??resolvedRunId,label:selected?.label??'Manual campaign',status:selected?.status??'unknown',runs:[{backtestRunId:resolvedRunId,runUid:getBacktestRunUid(resolvedRunId)??null,label:selected?.label??'Manual campaign',status:selected?.status??'unknown'}]}});
      }
      return res.status(200).json({...getBacktestDashboard(typeof req.query.runId==='string'?req.query.runId:undefined),defaultConfig:leader?manualBacktestDefaultsFromLeader(leader):null});
    }
    if(req.method==='POST')return res.status(202).json(startBacktest({...manualBacktestDefaultsFromLeader(getBestAutoResearchConfiguration()),...(req.body??{})}));
    if(req.method==='DELETE'){
      if(req.query.leaderboard==='true'&&req.query.permanent==='true')return res.status(200).json(clearBacktestLeaderboard());
      if(req.query.all==='true'&&req.query.permanent==='true')return res.status(200).json(clearAllBacktestData());
      const id=typeof req.query.runId==='string'?req.query.runId:String(req.body?.runId??'');
      if(!id)throw new Error('A backtest run ID is required.');
      if(req.query.permanent==='true')return res.status(200).json(deleteBacktestRun(id));
      return res.status(200).json(cancelBacktest(id));
    }
    res.setHeader('Allow','GET, POST, DELETE');
    return res.status(405).json({error:'Method not allowed'});
  }catch(error){return res.status(409).json({error:error instanceof Error?error.message:String(error)})}
}
