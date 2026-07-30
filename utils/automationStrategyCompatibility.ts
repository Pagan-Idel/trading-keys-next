import type { BacktestRunConfig } from './backtestStore';
import {
  GOLDILOCKS_BACKTEST_GATE_DEFAULTS,GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS,
  GOLDILOCKS_SCORE_WEIGHTS,GOLDILOCKS_STRATEGY_VERSION,
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
