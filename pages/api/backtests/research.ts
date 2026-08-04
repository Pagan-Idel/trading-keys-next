import type { NextApiRequest,NextApiResponse } from 'next';
import { getAutoResearchDashboard,getAutoResearchTrial,getTopAutoResearchResults,moveQueuedResearchTrial,removeQueuedResearchTrial,updateQueuedResearchTrial } from '../../../utils/autoResearchStore.ts';
import { pauseAutoResearch,recoverOrStartAutoResearch,resumeAutoResearch,startAutoResearch,stopAutoResearch } from '../../../utils/autoResearchRunner.ts';
import { normalizeBacktestConfig } from '../../../utils/backtestRunner.ts';
import { getCandleArchiveStorageUsage } from '../../../utils/candleArchive.ts';
import { GOLDILOCKS_RESEARCH_VERSION,GOLDILOCKS_TIMEFRAME_PROFILES } from '../../../utils/goldilocksConfig.ts';
import { getActiveBacktestRun,getBacktestDashboard,getBacktestStatusSnapshot,getBacktestTradeAudits } from '../../../utils/backtestStore.ts';
import { getAutomationCompatibility } from '../../../utils/automationStrategyCompatibility.ts';
import { getAppliedAutomationStrategy } from '../../../utils/automationStore.ts';

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
      const allTimeRecords=getTopAutoResearchResults(3).map(record=>{
        const run=(getBacktestDashboard(record.backtestRunId) as any).runs?.find((item:any)=>item.id===record.backtestRunId);
        return {...record,runUid:run?.runUid??null,compatibility:getAutomationCompatibility(record.config)};
      });
      return res.status(200).json({
        ...dashboard,archive:getCandleArchiveStorageUsage(),
        allTimeRecords,globalLeader:allTimeRecords[0]??null,
        appliedStrategy:getAppliedAutomationStrategy(),
        researchVersion:GOLDILOCKS_RESEARCH_VERSION,timeframeProfiles:GOLDILOCKS_TIMEFRAME_PROFILES,
        workerAlive:isProcessAlive(selected?.workerPid),activeBacktest:activeBacktestStatus(),serverTime:new Date().toISOString(),
      });
    }
    if(req.method==='POST'){
      if(req.body?.action==='recover')return res.status(202).json(recoverOrStartAutoResearch(req.body??{}));
      return res.status(202).json(startAutoResearch(req.body??{}));
    }
    const id=typeof req.query.campaignId==='string'?req.query.campaignId:String(req.body?.campaignId??'');
    if(!id)throw new Error('A campaign ID is required.');
    if(req.method==='PATCH'){
      const action=String(req.body?.action??'');
      if(action==='pause')return res.status(200).json(pauseAutoResearch(id));
      if(action==='resume')return res.status(200).json(resumeAutoResearch(id));
      const trialId=String(req.body?.trialId??'');
      if(action==='move'&&trialId)return res.status(200).json(moveQueuedResearchTrial(id,trialId,req.body?.direction==='up'?'up':'down'));
      if(action==='edit'&&trialId)return res.status(200).json(updateQueuedResearchTrial(id,trialId,normalizeBacktestConfig(req.body?.config??{})));
      if(action==='remove'&&trialId)return res.status(200).json(removeQueuedResearchTrial(id,trialId));
      throw new Error('Unknown research action.');
    }
    if(req.method==='DELETE')return res.status(200).json(stopAutoResearch(id));
    res.setHeader('Allow','GET, POST, PATCH, DELETE');
    return res.status(405).json({error:'Method not allowed'});
  }catch(error){return res.status(409).json({error:error instanceof Error?error.message:String(error)})}
}
