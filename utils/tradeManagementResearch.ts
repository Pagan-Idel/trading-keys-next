import type { StrategyCandle } from './goldilocksStrategy.ts';

export const GOLDILOCKS_RESEARCH_SCHEMA_VERSION='goldilocks-ai-research-v1';

export interface TradeManagementPolicy {
  id:string;
  version:1;
  label:string;
  breakEvenAtR:number|null;
  primaryTargetR:number;
  primaryExitFraction:number;
  runnerTargetR:number|null;
  runnerStopR:number|null;
}

const targetId=(targetR:number)=>Number.isInteger(targetR)?`${targetR}r`:`${String(targetR).replace('.','p')}r`;

const setAndForgetTargets=[1,1.5,2,2.5,3,4,5] as const;
const breakEvenTargets=[1.5,2,2.5,3,4,5] as const;
const runnerFractions=[.25,.5,.75] as const;
const runnerTargets=[3,4,5] as const;

export const GOLDILOCKS_MANAGEMENT_POLICIES:TradeManagementPolicy[]=[
  ...setAndForgetTargets.map(primaryTargetR=>(
    {id:`set-forget-${targetId(primaryTargetR)}-v1`,version:1 as const,label:`Set and forget ${primaryTargetR}R`,breakEvenAtR:null,primaryTargetR,primaryExitFraction:1,runnerTargetR:null,runnerStopR:null}
  )),
  ...breakEvenTargets.map(primaryTargetR=>(
    {id:`be-at-1r-full-${targetId(primaryTargetR)}-v1`,version:1 as const,label:`Break-even at +1R, full exit at ${primaryTargetR}R`,breakEvenAtR:1,primaryTargetR,primaryExitFraction:1,runnerTargetR:null,runnerStopR:null}
  )),
  ...runnerFractions.flatMap(runnerFraction=>runnerTargets.map(runnerTargetR=>{
    const primaryExitFraction=1-runnerFraction;
    const runnerPercent=Math.round(runnerFraction*100);
    return {
      id:`partial-${runnerPercent}-runner-${targetId(runnerTargetR)}-v1`,version:1 as const,
      label:`${Math.round(primaryExitFraction*100)}% at 2R, ${runnerPercent}% runner to ${runnerTargetR}R`,
      breakEvenAtR:1,primaryTargetR:2,primaryExitFraction,runnerTargetR,runnerStopR:1,
    };
  })),
];

export interface TradePathSummary {
  coverageStartTime:number|null;
  coverageEndTime:number|null;
  candleCount:number;
  mfeR:number;
  maeR:number;
  endingR:number;
  firstReachedAt:Record<string,number>;
  ambiguousCandles:Array<{time:number;reason:string}>;
}

export interface TradeManagementResearchResult {
  policyId:string;
  policyVersion:number;
  policy:TradeManagementPolicy;
  status:'closed'|'open';
  exitTime:number|null;
  exitReason:'stop'|'break_even'|'target'|'runner_stop'|'runner_target'|'weekend_close'|'archive_end';
  realizedR:number|null;
  markToMarketR:number;
  breakEvenActivatedAt:number|null;
  partialExitAt:number|null;
  path:TradePathSummary;
}

const rAt=(direction:'BUY'|'SELL',price:number,entry:number,risk:number)=>(direction==='BUY'?price-entry:entry-price)/risk;
const thresholdPrice=(direction:'BUY'|'SELL',entry:number,risk:number,r:number)=>direction==='BUY'?entry+risk*r:entry-risk*r;
const hitFavorable=(candle:StrategyCandle,direction:'BUY'|'SELL',price:number)=>direction==='BUY'?candle.high>=price:candle.low<=price;
const hitAdverse=(candle:StrategyCandle,direction:'BUY'|'SELL',price:number)=>direction==='BUY'?candle.low<=price:candle.high>=price;
const milestoneKey=(r:number)=>`${r>=0?'+':''}${r}R`;
const MILESTONES=[-.75,-.5,-.25,.25,.5,1,1.5,2,2.5,3,4,5];

const pathFor=(candles:StrategyCandle[],startIndex:number,direction:'BUY'|'SELL',entry:number,risk:number,endTime?:number):TradePathSummary=>{
  let mfeR=Number.NEGATIVE_INFINITY;
  let maeR=Number.POSITIVE_INFINITY;
  let endingR=0;
  const firstReachedAt:Record<string,number>={};
  let count=0;
  let start:number|null=null;
  let end:number|null=null;
  for(let index=startIndex;index<candles.length;index+=1){
    const candle=candles[index];
    if(endTime!==undefined&&candle.time>=endTime)break;
    start??=candle.time;end=candle.time;count+=1;
    const favorable=rAt(direction,direction==='BUY'?candle.high:candle.low,entry,risk);
    const adverse=rAt(direction,direction==='BUY'?candle.low:candle.high,entry,risk);
    mfeR=Math.max(mfeR,favorable);maeR=Math.min(maeR,adverse);endingR=rAt(direction,candle.close,entry,risk);
    for(const milestone of MILESTONES){
      const reached=milestone>=0?favorable>=milestone:adverse<=milestone;
      if(reached&&firstReachedAt[milestoneKey(milestone)]===undefined)firstReachedAt[milestoneKey(milestone)]=candle.time;
    }
  }
  return {coverageStartTime:start,coverageEndTime:end,candleCount:count,mfeR:Number.isFinite(mfeR)?mfeR:0,maeR:Number.isFinite(maeR)?maeR:0,endingR,firstReachedAt,ambiguousCandles:[]};
};

export const summarizeTradeMarketPath=(args:{candles:StrategyCandle[];startIndex:number;direction:'BUY'|'SELL';entry:number;stopLoss:number;endTime?:number})=>{
  const risk=Math.abs(args.entry-args.stopLoss);
  return risk>0?pathFor(args.candles,args.startIndex,args.direction,args.entry,risk,args.endTime):null;
};

export const evaluateTradeManagementPolicy=(args:{
  candles:StrategyCandle[];startIndex:number;direction:'BUY'|'SELL';entry:number;stopLoss:number;
  policy:TradeManagementPolicy;weekendLiquidationTime?:number;
}):TradeManagementResearchResult=>{
  const {candles,startIndex,direction,entry,stopLoss,policy,weekendLiquidationTime}=args;
  const risk=Math.abs(entry-stopLoss);
  if(!(risk>0))throw new Error('Trade-management research requires a positive initial risk distance.');
  const summary=pathFor(candles,startIndex,direction,entry,risk,weekendLiquidationTime);
  let breakEvenActivatedAt:number|null=null;
  let partialExitAt:number|null=null;
  let realizedPrimary=0;
  const primaryTarget=thresholdPrice(direction,entry,risk,policy.primaryTargetR);
  const runnerTarget=policy.runnerTargetR===null?null:thresholdPrice(direction,entry,risk,policy.runnerTargetR);
  for(let index=startIndex;index<candles.length;index+=1){
    const candle=candles[index];
    if(weekendLiquidationTime!==undefined&&candle.time>=weekendLiquidationTime){
      const openR=rAt(direction,candle.open,entry,risk);
      const remaining=partialExitAt===null?1:1-policy.primaryExitFraction;
      const floor=partialExitAt!==null?(policy.runnerStopR??-1):breakEvenActivatedAt!==null?0:-1;
      const realizedR=realizedPrimary+remaining*Math.max(floor,openR);
      return {policyId:policy.id,policyVersion:policy.version,policy,status:'closed',exitTime:candle.time,exitReason:'weekend_close',realizedR,markToMarketR:openR,breakEvenActivatedAt,partialExitAt,path:summary};
    }
    if(partialExitAt!==null){
      const runnerStopR=policy.runnerStopR??0;
      const runnerStop=thresholdPrice(direction,entry,risk,runnerStopR);
      const stopped=hitAdverse(candle,direction,runnerStop);
      const won=runnerTarget!==null&&hitFavorable(candle,direction,runnerTarget);
      if(stopped&&won)summary.ambiguousCandles.push({time:candle.time,reason:'runner stop and runner target were both inside one M1 candle; conservative runner stop used'});
      if(stopped||won){
        const runnerR=stopped?runnerStopR:policy.runnerTargetR!;
        const realizedR=realizedPrimary+(1-policy.primaryExitFraction)*runnerR;
        return {policyId:policy.id,policyVersion:policy.version,policy,status:'closed',exitTime:candle.time,exitReason:stopped?'runner_stop':'runner_target',realizedR,markToMarketR:rAt(direction,candle.close,entry,risk),breakEvenActivatedAt,partialExitAt,path:summary};
      }
      continue;
    }
    const activeStop=breakEvenActivatedAt===null?stopLoss:entry;
    const stopped=hitAdverse(candle,direction,activeStop);
    const reachedPrimary=hitFavorable(candle,direction,primaryTarget);
    const reachedBreakEven=policy.breakEvenAtR!==null&&hitFavorable(candle,direction,thresholdPrice(direction,entry,risk,policy.breakEvenAtR));
    if(stopped&&(reachedPrimary||reachedBreakEven))summary.ambiguousCandles.push({time:candle.time,reason:'stop and favorable management threshold were both inside one M1 candle; conservative stop used'});
    if(stopped){
      const stopR=breakEvenActivatedAt===null?-1:0;
      return {policyId:policy.id,policyVersion:policy.version,policy,status:'closed',exitTime:candle.time,exitReason:breakEvenActivatedAt===null?'stop':'break_even',realizedR:stopR,markToMarketR:rAt(direction,candle.close,entry,risk),breakEvenActivatedAt,partialExitAt,path:summary};
    }
    if(reachedPrimary){
      if(policy.primaryExitFraction>=1)return {policyId:policy.id,policyVersion:policy.version,policy,status:'closed',exitTime:candle.time,exitReason:'target',realizedR:policy.primaryTargetR,markToMarketR:rAt(direction,candle.close,entry,risk),breakEvenActivatedAt,partialExitAt,path:summary};
      partialExitAt=candle.time;
      realizedPrimary=policy.primaryExitFraction*policy.primaryTargetR;
      continue;
    }
    if(reachedBreakEven&&breakEvenActivatedAt===null)breakEvenActivatedAt=candle.time;
  }
  const remaining=partialExitAt===null?1:1-policy.primaryExitFraction;
  const markToMarketR=summary.endingR;
  return {policyId:policy.id,policyVersion:policy.version,policy,status:'open',exitTime:summary.coverageEndTime,exitReason:'archive_end',realizedR:null,markToMarketR:realizedPrimary+remaining*markToMarketR,breakEvenActivatedAt,partialExitAt,path:summary};
};

export const evaluateGoldilocksManagementPolicies=(args:Omit<Parameters<typeof evaluateTradeManagementPolicy>[0],'policy'>)=>
  GOLDILOCKS_MANAGEMENT_POLICIES.map(policy=>evaluateTradeManagementPolicy({...args,policy}));
