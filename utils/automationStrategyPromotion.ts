import { getPromotedResearchRunIds } from './automationPromotionEvidence';
import { getBacktestLeaderboard, type BacktestRunConfig } from './backtestStore';
export {getAutomationCompatibility} from './automationStrategyCompatibility';
import {getAutomationCompatibility} from './automationStrategyCompatibility';

export const getLatestAutomationRecommendation=()=>{
  const promoted=getPromotedResearchRunIds();
  const records=getBacktestLeaderboard() as unknown as Array<{
    runUid:string;sourceRunId:string;config:BacktestRunConfig;netR:number;
    completedAt:string;label:string;
  }>;
  const sealed=records.filter(record=>
    promoted.has(record.sourceRunId)&&
    Number.isFinite(Number(record.config.datasetEndTime))&&
    Boolean(record.config.datasetKey),
  );
  const latest=sealed[0]??null;
  return {
    latest,
    compatibility:latest?getAutomationCompatibility(latest.config):{
      compatible:false,
      blockers:['No sealed promoted leaderboard result is available yet.'],
    },
  };
};
