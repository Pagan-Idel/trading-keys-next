import type { NextApiRequest, NextApiResponse } from 'next';
import { applyAutomationStrategy,getAutomationDashboard,rollbackAutomationStrategy,setRiskProfile } from '../../../utils/automationStore';
import { isRiskProfile } from '../../../utils/dynamicRisk';
import { getAutomationRuntime } from '../../../utils/automationProcessManager';
import { getLatestAutomationRecommendation } from '../../../utils/automationStrategyPromotion';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
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
    if (req.method === 'POST') {
      if(req.body?.action==='move-to-latest'){
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
