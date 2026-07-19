import type { NextApiRequest,NextApiResponse } from 'next';
import { getAutoResearchDashboard,getAutoResearchTrial } from '../../../utils/autoResearchStore.ts';
import { pauseAutoResearch,resumeAutoResearch,startAutoResearch,stopAutoResearch } from '../../../utils/autoResearchRunner.ts';
import { getCandleArchiveStorageUsage } from '../../../utils/candleArchive.ts';
import { GOLDILOCKS_RESEARCH_VERSION,GOLDILOCKS_TIMEFRAME_PROFILES } from '../../../utils/goldilocksConfig.ts';
import { getActiveBacktestRun,getBacktestStatusSnapshot,getBacktestTradeAudits } from '../../../utils/backtestStore.ts';

const isProcessAlive=(pid:unknown)=>{
  const processId=Number(pid);
  if(!Number.isInteger(processId)||processId<=0)return false;
  try{process.kill(processId,0);return true}catch{return false}
};

const activeBacktestStatus=()=>{
  const active=getActiveBacktestRun();
  if(!active)return null;
  return getBacktestStatusSnapshot(active.id)??{id:active.id};
};

export default function handler(req:NextApiRequest,res:NextApiResponse){
  try{
    if(req.method==='GET'){
      if(typeof req.query.trialId==='string'){
        const trial=getAutoResearchTrial(req.query.trialId);
        if(!trial)return res.status(404).json({error:'Research trial was not found.'});
        return res.status(200).json({trial,tradeAudits:trial.backtestRunId?getBacktestTradeAudits(String(trial.backtestRunId)):[]});
      }
      const dashboard=getAutoResearchDashboard(typeof req.query.campaignId==='string'?req.query.campaignId:undefined);
      const selected=dashboard.campaigns.find(item=>item.id===dashboard.selectedCampaignId)??dashboard.campaigns[0];
      return res.status(200).json({
        ...dashboard,archive:getCandleArchiveStorageUsage(),
        researchVersion:GOLDILOCKS_RESEARCH_VERSION,timeframeProfiles:GOLDILOCKS_TIMEFRAME_PROFILES,
        workerAlive:isProcessAlive(selected?.workerPid),activeBacktest:activeBacktestStatus(),serverTime:new Date().toISOString(),
      });
    }
    if(req.method==='POST')return res.status(202).json(startAutoResearch(req.body??{}));
    const id=typeof req.query.campaignId==='string'?req.query.campaignId:String(req.body?.campaignId??'');
    if(!id)throw new Error('A campaign ID is required.');
    if(req.method==='PATCH'){
      const action=String(req.body?.action??'');
      if(action==='pause')return res.status(200).json(pauseAutoResearch(id));
      if(action==='resume')return res.status(200).json(resumeAutoResearch(id));
      throw new Error('Research action must be pause or resume.');
    }
    if(req.method==='DELETE')return res.status(200).json(stopAutoResearch(id));
    res.setHeader('Allow','GET, POST, PATCH, DELETE');
    return res.status(405).json({error:'Method not allowed'});
  }catch(error){return res.status(409).json({error:error instanceof Error?error.message:String(error)})}
}
