import type { BacktestRunConfig } from './backtestStore';
import {
  GOLDILOCKS_BACKTEST_GATE_DEFAULTS,GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS,
  GOLDILOCKS_SCORE_WEIGHTS,getGoldilocksTimeframeProfile,isGoldilocksTimeframeProfileId,
} from './goldilocksConfig';
import { GOLDILOCKS_DEFAULT_MANAGEMENT,GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID } from './goldilocksTradeManagement';

const sameNumbers=(left:Record<string,number>|undefined,right:Record<string,number>)=>
  Object.entries(right).every(([key,value])=>Number(left?.[key])===Number(value));
const sameBooleans=(left:Record<string,boolean>|undefined,right:Record<string,boolean>)=>
  Object.entries(right).every(([key,value])=>(left?.[key]??value)===value);

export const getAutomationCompatibility=(config:BacktestRunConfig)=>{
  const blockers:string[]=[];
  if(!isGoldilocksTimeframeProfileId(config.timeframeProfile))blockers.push('Automation requires a recognized timeframe profile.');
  else if(config.strategyVersion!==getGoldilocksTimeframeProfile(config.timeframeProfile).strategyVersion)
    blockers.push('Strategy version does not match its timeframe profile.');
  if(!['close-through','touch-entry'].includes(String(config.confirmationMode)))blockers.push('Automation requires a recognized confirmation mode.');
  if(![GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID].includes(String(config.tradeManager) as typeof GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID))
    blockers.push('Automation currently supports secure-half and set-and-forget trade managers.');
  if(!sameNumbers(config.strategyTweaks as Record<string,number>|undefined,GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS))blockers.push('Research-only numeric strategy tweaks do not match the automation contract.');
  if(!sameBooleans(config.gateSettings as Record<string,boolean>|undefined,GOLDILOCKS_BACKTEST_GATE_DEFAULTS))blockers.push('Research gates do not match the automation safety contract.');
  if(!sameNumbers(config.scoreWeights as Record<string,number>|undefined,GOLDILOCKS_SCORE_WEIGHTS))blockers.push('Research score weights do not match the automation score contract.');
  return {compatible:blockers.length===0,blockers};
};
