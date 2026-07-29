import { getPromotedResearchRunIds } from './automationPromotionEvidence';
import { getBacktestLeaderboard, type BacktestRunConfig } from './backtestStore';
import {
  GOLDILOCKS_BACKTEST_GATE_DEFAULTS,
  GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS,
  GOLDILOCKS_SCORE_WEIGHTS,
  GOLDILOCKS_STRATEGY_VERSION,
} from './goldilocksConfig';
import { GOLDILOCKS_DEFAULT_MANAGEMENT } from './goldilocksTradeManagement';

const sameNumbers=(left:Record<string,number>|undefined,right:Record<string,number>)=>
  Object.entries(right).every(([key,value])=>Number(left?.[key])===Number(value));
const sameBooleans=(left:Record<string,boolean>|undefined,right:Record<string,boolean>)=>
  Object.entries(right).every(([key,value])=>(left?.[key]??value)===value);

export const getAutomationCompatibility=(config:BacktestRunConfig)=>{
  const blockers:string[]=[];
  if(config.timeframeProfile!=='intraday')blockers.push('Automation currently executes only the H1/M15/M5 intraday stack.');
  if(config.strategyVersion!==GOLDILOCKS_STRATEGY_VERSION)blockers.push(`Strategy version must be ${GOLDILOCKS_STRATEGY_VERSION}.`);
  if(config.confirmationMode!=='close-through')blockers.push('Automation requires causal close-through confirmation; touch-entry execution is not implemented.');
  if(config.tradeManager!==GOLDILOCKS_DEFAULT_MANAGEMENT.policyId)blockers.push(`Automation manager must be ${GOLDILOCKS_DEFAULT_MANAGEMENT.policyId}.`);
  if(config.closeTradesBeforeWeekend===false)blockers.push('Automation always retains the Friday liquidation safety rule.');
  if(!sameNumbers(config.strategyTweaks as Record<string,number>|undefined,GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS))blockers.push('Research-only numeric strategy tweaks do not match the automation contract.');
  if(!sameBooleans(config.gateSettings as Record<string,boolean>|undefined,GOLDILOCKS_BACKTEST_GATE_DEFAULTS))blockers.push('Research gates do not match the automation safety contract.');
  if(!sameNumbers(config.scoreWeights as Record<string,number>|undefined,GOLDILOCKS_SCORE_WEIGHTS))blockers.push('Research score weights do not match the automation score contract.');
  return {compatible:blockers.length===0,blockers};
};

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
