import type { NextApiRequest, NextApiResponse } from 'next';
import { applyAutomationStrategy,getAutomationDashboard,rollbackAutomationStrategy,setRiskProfile } from '../../../utils/automationStore';
import { isRiskProfile } from '../../../utils/dynamicRisk';
import { getAutomationRuntime } from '../../../utils/automationProcessManager';
import { getLatestAutomationRecommendation } from '../../../utils/automationStrategyPromotion';
import { getBestAutoResearchResult } from '../../../utils/autoResearchStore';
import { getBacktestRunUid } from '../../../utils/backtestStore';
import { getAutomationCompatibility } from '../../../utils/automationStrategyCompatibility';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'POST'].includes(req.method ?? '')) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestedLimit = Number(req.query.eventLimit ?? 120);
  const eventLimit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 20), 500)
    : 120;

  try {
    res.setHeader('Cache-Control', 'no-store');
    const getPiStatus=async()=>{
      const base=(process.env.PI_PULSE_URL??'http://127.0.0.1:4080').replace(/\/$/,'');
      const token=process.env.PI_PULSE_CONTROL_TOKEN??process.env.PULSE_CONTROL_TOKEN;
      const response=await fetch(`${base}/api/status`,{
        headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store',signal:AbortSignal.timeout(10000),
      });
      const payload=await response.json();
      if(!response.ok)throw new Error(payload?.error??'Pi status check failed.');
      return payload;
    };
    if(req.method==='GET'){
      const payload=await getPiStatus();
      const effectiveRiskProfile=payload.dashboard?.appliedStrategy?.config?.riskProfile
        ??payload.dashboard?.riskConfig?.selected
        ??null;
      return res.status(200).json({
        ...payload.dashboard,
        effectiveRiskProfile,
        strategyRecommendation:getLatestAutomationRecommendation(),
        generatedAt:new Date().toISOString(),
      });
    }
    if (req.method === 'POST') {
      if(req.body?.action==='move-global-leader'){
        const pi=await getPiStatus();
        if(pi.runtime?.running)return res.status(409).json({error:'Stop Pi automation before changing its strategy configuration.'});
        if((pi.dashboard?.activeTrades??[]).length)return res.status(409).json({error:'Strategy configuration cannot change while the Pi ledger has an open trade.'});
        const leader=getBestAutoResearchResult();
        if(!leader)return res.status(409).json({error:'No all-time research leader is available.'});
        const compatibility=getAutomationCompatibility(leader.config);
        if(!compatibility.compatible)return res.status(409).json({error:compatibility.blockers.join(' ')});
        const runUid=getBacktestRunUid(leader.backtestRunId);
        if(!runUid)return res.status(409).json({error:'The all-time leader has no immutable public run ID.'});
        applyAutomationStrategy(runUid,leader.config);
      }else if(req.body?.action==='move-to-latest'){
        const runtime=getAutomationRuntime(),dashboard=getAutomationDashboard(20);
        if(runtime.running)return res.status(409).json({error:'Stop automation before changing its strategy configuration.'});
        if(dashboard.activeTrades.length)return res.status(409).json({error:'Strategy configuration cannot change while the automation ledger has an open trade.'});
        const recommendation=getLatestAutomationRecommendation();
        if(!recommendation.latest||!recommendation.compatibility.compatible)
          return res.status(409).json({error:recommendation.compatibility.blockers.join(' ')});
        applyAutomationStrategy(recommendation.latest.runUid,recommendation.latest.config);
      }else if(req.body?.action==='rollback-strategy'){
        if(getAutomationRuntime().running)return res.status(409).json({error:'Stop automation before rolling back its strategy configuration.'});
        rollbackAutomationStrategy();
      }else{
        if (!isRiskProfile(req.body?.riskProfile)) return res.status(400).json({ error: 'Risk profile must be easy, default, or aggressive.' });
        setRiskProfile(req.body.riskProfile);
      }
    }
    return res.status(200).json({
      ...getAutomationDashboard(eventLimit),
      strategyRecommendation:getLatestAutomationRecommendation(),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[automation/dashboard]', error);
    return res.status(500).json({ error: 'Failed to load automation dashboard' });
  }
}
