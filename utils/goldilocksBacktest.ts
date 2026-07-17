import type { Candle } from './swingLabeler.ts';
import { annotateConfluenceAt, buildGoldilocksHistoryChunked, buildGoldilocksLegs, toStrategyCandles, zoneUsableAt, type GoldilocksRangeAssessment, type GoldilocksTrend } from './goldilocksScanner.ts';
import { validateTwoToOneRunway, type GoldilocksZone, type StrategyCandle } from './goldilocksStrategy.ts';
import { scoreGoldilocksSetup } from './goldilocksScoring.ts';
import { GOLDILOCKS_DEMO_TIMEFRAMES } from './goldilocksConfig.ts';
import type { BacktestTradeInput } from './backtestStore.ts';

export interface GoldilocksBacktestInput {
  runId:string;pair:string;minimumScore:number;zoneCandles:Candle[];confirmationCandles:Candle[];trendCandles:Candle[];
  onProgress?:(progress:{stage:string;completed:number;total:number;percent:number})=>void;
}
const lastAtOrBefore=<T extends {time:number}>(items:T[],time:number)=>{let low=0,high=items.length;while(low<high){const middle=(low+high)>>>1;if(items[middle].time<=time)low=middle+1;else high=middle}return low-1};
const expiresAt=(time:number)=>{const date=new Date(time*1000);date.setUTCFullYear(date.getUTCFullYear()+2);return date.getTime()/1000};
const penetration=(zone:GoldilocksZone,candle:StrategyCandle)=>Math.max(0,zone.side==='demand'?(zone.high-candle.low)/zone.width:(candle.high-zone.low)/zone.width);

interface MarketContextPoint {time:number;trend:GoldilocksTrend;low:number;high:number;midpoint:number;}
const buildMarketContextIndex=(candles:Candle[],chunkSize=1_000,overlap=200):MarketContextPoint[]=>{
  const points:MarketContextPoint[]=[];
  const step=Math.max(1,chunkSize-overlap);
  for(let coreStart=0;coreStart<candles.length;coreStart+=step){
    const sliceStart=Math.max(0,coreStart-overlap);
    const sliceEnd=Math.min(candles.length,coreStart+step+overlap);
    const slice=candles.slice(sliceStart,sliceEnd).map((candle,index)=>({...candle,candleIndex:index}));
    for(const leg of buildGoldilocksLegs(slice)){
      const globalEnd=sliceStart+leg.endIndex;
      if(globalEnd<coreStart||globalEnd>=Math.min(candles.length,coreStart+step))continue;
      const completed=slice[leg.endIndex];
      const range=slice.slice(leg.startIndex,leg.endIndex+1);
      if(!completed||!range.length)continue;
      const low=Math.min(...range.map(candle=>candle.low));
      const high=Math.max(...range.map(candle=>candle.high));
      const trend:GoldilocksTrend=leg.endSwing==='HH'||leg.endSwing==='HL'
        ?'bullish'
        :leg.endSwing==='LH'||leg.endSwing==='LL'
          ?'bearish'
          :'unknown';
      points.push({time:Math.floor(new Date(completed.time).getTime()/1000),trend,low,high,midpoint:low+(high-low)/2});
    }
  }
  points.sort((left,right)=>left.time-right.time);
  const deduped:MarketContextPoint[]=[];
  for(const point of points){
    if(deduped.at(-1)?.time===point.time)deduped[deduped.length-1]=point;
    else deduped.push(point);
  }
  return deduped;
};
const marketContextAt=(index:MarketContextPoint[],time:number,entry:number,direction:'BUY'|'SELL'):{trend:GoldilocksTrend;rangeAssessment:GoldilocksRangeAssessment}=>{
  const position=lastAtOrBefore(index,time);
  const point=position>=0?index[position]:undefined;
  if(!point)return {trend:'unknown',rangeAssessment:{aligned:null,detail:'No completed M15 swing range was available.'}};
  const aligned=direction==='BUY'?entry<=point.midpoint:entry>=point.midpoint;
  return {trend:point.trend,rangeAssessment:{aligned,low:point.low,high:point.high,midpoint:point.midpoint,detail:`${direction} entry ${entry} is ${aligned?'in the correct':'in the opposite'} half of M15 range ${point.low}-${point.high} (midpoint ${point.midpoint}).`}};
};
const runnerFractionForScore=(score?:number)=>score==null||score<16?0:score<18?.25:.5;
const blendedRunnerR=(runnerFraction:number,runnerExitR:number)=>(1-runnerFraction)*2+runnerFraction*runnerExitR;

export const resolveProtectedOutcome=(candles:StrategyCandle[],startIndex:number,direction:'BUY'|'SELL',stopLoss:number,oneR:number,takeProfit?:number,score?:number)=>{
  const entry=(stopLoss+oneR)/2;
  const risk=Math.abs(entry-stopLoss);
  const target=takeProfit??(direction==='BUY'?entry+Math.abs(entry-stopLoss)*2:entry-Math.abs(entry-stopLoss)*2);
  const runnerTarget=direction==='BUY'?entry+risk*4:entry-risk*4;
  const runnerFraction=runnerFractionForScore(score);
  let protectedAt=-1;
  let partialAt=-1;
  for(let index=startIndex;index<candles.length;index+=1){
    const candle=candles[index];
    if(partialAt>=0){
      const runnerStopped=direction==='BUY'?candle.low<=oneR:candle.high>=oneR;
      const runnerWon=direction==='BUY'?candle.high>=runnerTarget:candle.low<=runnerTarget;
      if(runnerStopped)return {outcome:'WIN' as const,outcomeTime:candle.time,exitReason:'runner_stop' as const,realizedR:blendedRunnerR(runnerFraction,1)};
      if(runnerWon)return {outcome:'WIN' as const,outcomeTime:candle.time,exitReason:'runner_target' as const,realizedR:blendedRunnerR(runnerFraction,4)};
      continue;
    }
    if(protectedAt<0){
      const stopped=direction==='BUY'?candle.low<=stopLoss:candle.high>=stopLoss;
      const reachedOneR=direction==='BUY'?candle.high>=oneR:candle.low<=oneR;
      const reachedTarget=direction==='BUY'?candle.high>=target:candle.low<=target;
      if(stopped)return {outcome:'LOSS' as const,outcomeTime:candle.time,exitReason:'stop' as const,realizedR:-1};
      if(reachedTarget){if(!runnerFraction)return {outcome:'WIN' as const,outcomeTime:candle.time,exitReason:'target' as const,realizedR:2};partialAt=index;continue}
      if(reachedOneR)protectedAt=index;
      continue;
    }
    const breakEven=direction==='BUY'?candle.low<=entry:candle.high>=entry;
    const reachedTarget=direction==='BUY'?candle.high>=target:candle.low<=target;
    if(breakEven)return {outcome:'WIN' as const,outcomeTime:candle.time,exitReason:'break_even' as const,realizedR:0};
    if(reachedTarget){if(!runnerFraction)return {outcome:'WIN' as const,outcomeTime:candle.time,exitReason:'target' as const,realizedR:2};partialAt=index}
  }
  if(partialAt>=0&&candles.length)return {outcome:'WIN' as const,outcomeTime:candles[candles.length-1].time,exitReason:'runner_open' as const,realizedR:blendedRunnerR(runnerFraction,1)};
  return protectedAt>=0&&candles.length?{outcome:'WIN' as const,outcomeTime:candles[candles.length-1].time,exitReason:'one_r_protected' as const,realizedR:0}:null;
};

export const buildProtectedOutcomeResolver=(candles:StrategyCandle[])=>{
  let size=1;
  while(size<candles.length)size*=2;
  const maximumHigh=new Float64Array(size*2);
  maximumHigh.fill(Number.NEGATIVE_INFINITY);
  const minimumLow=new Float64Array(size*2);
  minimumLow.fill(Number.POSITIVE_INFINITY);
  for(let index=0;index<candles.length;index+=1){
    maximumHigh[size+index]=candles[index].high;
    minimumLow[size+index]=candles[index].low;
  }
  for(let node=size-1;node>0;node-=1){
    maximumHigh[node]=Math.max(maximumHigh[node*2],maximumHigh[node*2+1]);
    minimumLow[node]=Math.min(minimumLow[node*2],minimumLow[node*2+1]);
  }
  const firstHighAtLeast=(start:number,value:number,node=1,left=0,right=size-1):number=>{
    if(right<start||maximumHigh[node]<value)return -1;
    if(left===right)return left<candles.length?left:-1;
    const midpoint=(left+right)>>>1;
    const first=firstHighAtLeast(start,value,node*2,left,midpoint);
    return first>=0?first:firstHighAtLeast(start,value,node*2+1,midpoint+1,right);
  };
  const firstLowAtMost=(start:number,value:number,node=1,left=0,right=size-1):number=>{
    if(right<start||minimumLow[node]>value)return -1;
    if(left===right)return left<candles.length?left:-1;
    const midpoint=(left+right)>>>1;
    const first=firstLowAtMost(start,value,node*2,left,midpoint);
    return first>=0?first:firstLowAtMost(start,value,node*2+1,midpoint+1,right);
  };
  return (startIndex:number,direction:'BUY'|'SELL',stopLoss:number,oneR:number,takeProfit?:number,score?:number)=>{
    const entry=(stopLoss+oneR)/2;
    const risk=Math.abs(entry-stopLoss);
    const target=takeProfit??(direction==='BUY'?entry+Math.abs(entry-stopLoss)*2:entry-Math.abs(entry-stopLoss)*2);
    const runnerTarget=direction==='BUY'?entry+risk*4:entry-risk*4;
    const runnerFraction=runnerFractionForScore(score);
    const stopIndex=direction==='BUY'?firstLowAtMost(startIndex,stopLoss):firstHighAtLeast(startIndex,stopLoss);
    const protectedIndex=direction==='BUY'?firstHighAtLeast(startIndex,oneR):firstLowAtMost(startIndex,oneR);
    if(protectedIndex<0)return stopIndex>=0?{outcome:'LOSS' as const,outcomeTime:candles[stopIndex].time,exitReason:'stop' as const,realizedR:-1}:null;
    if(stopIndex>=0&&stopIndex<=protectedIndex)return {outcome:'LOSS' as const,outcomeTime:candles[stopIndex].time,exitReason:'stop' as const,realizedR:-1};
    const directTargetIndex=direction==='BUY'?firstHighAtLeast(startIndex,target):firstLowAtMost(startIndex,target);
    if(directTargetIndex===protectedIndex){
      if(!runnerFraction)return {outcome:'WIN' as const,outcomeTime:candles[directTargetIndex].time,exitReason:'target' as const,realizedR:2};
      const after=directTargetIndex+1;
      const runnerStopIndex=direction==='BUY'?firstLowAtMost(after,oneR):firstHighAtLeast(after,oneR);
      const runnerTargetIndex=direction==='BUY'?firstHighAtLeast(after,runnerTarget):firstLowAtMost(after,runnerTarget);
      if(runnerStopIndex<0&&runnerTargetIndex<0)return {outcome:'WIN' as const,outcomeTime:candles[candles.length-1].time,exitReason:'runner_open' as const,realizedR:blendedRunnerR(runnerFraction,1)};
      if(runnerStopIndex>=0&&(runnerTargetIndex<0||runnerStopIndex<=runnerTargetIndex))return {outcome:'WIN' as const,outcomeTime:candles[runnerStopIndex].time,exitReason:'runner_stop' as const,realizedR:blendedRunnerR(runnerFraction,1)};
      return {outcome:'WIN' as const,outcomeTime:candles[runnerTargetIndex].time,exitReason:'runner_target' as const,realizedR:blendedRunnerR(runnerFraction,4)};
    }
    const after=protectedIndex+1;
    const breakEvenIndex=direction==='BUY'?firstLowAtMost(after,entry):firstHighAtLeast(after,entry);
    const targetIndex=direction==='BUY'?firstHighAtLeast(after,target):firstLowAtMost(after,target);
    if(breakEvenIndex<0&&targetIndex<0)return {outcome:'WIN' as const,outcomeTime:candles[candles.length-1].time,exitReason:'one_r_protected' as const,realizedR:0};
    if(breakEvenIndex>=0&&(targetIndex<0||breakEvenIndex<=targetIndex))return {outcome:'WIN' as const,outcomeTime:candles[breakEvenIndex].time,exitReason:'break_even' as const,realizedR:0};
    if(!runnerFraction)return {outcome:'WIN' as const,outcomeTime:candles[targetIndex].time,exitReason:'target' as const,realizedR:2};
    const runnerAfter=targetIndex+1;
    const runnerStopIndex=direction==='BUY'?firstLowAtMost(runnerAfter,oneR):firstHighAtLeast(runnerAfter,oneR);
    const runnerTargetIndex=direction==='BUY'?firstHighAtLeast(runnerAfter,runnerTarget):firstLowAtMost(runnerAfter,runnerTarget);
    if(runnerStopIndex<0&&runnerTargetIndex<0)return {outcome:'WIN' as const,outcomeTime:candles[candles.length-1].time,exitReason:'runner_open' as const,realizedR:blendedRunnerR(runnerFraction,1)};
    if(runnerStopIndex>=0&&(runnerTargetIndex<0||runnerStopIndex<=runnerTargetIndex))return {outcome:'WIN' as const,outcomeTime:candles[runnerStopIndex].time,exitReason:'runner_stop' as const,realizedR:blendedRunnerR(runnerFraction,1)};
    return {outcome:'WIN' as const,outcomeTime:candles[runnerTargetIndex].time,exitReason:'runner_target' as const,realizedR:blendedRunnerR(runnerFraction,4)};
  };
};

export const simulateGoldilocksPair=(input:GoldilocksBacktestInput):BacktestTradeInput[]=>{
  input.onProgress?.({stage:'building M5 zones',completed:0,total:4,percent:0});
  const zoneHistory=buildGoldilocksHistoryChunked(input.zoneCandles,1_000,200);
  input.onProgress?.({stage:'building M1 confluence',completed:1,total:4,percent:5});
  const confirmation=toStrategyCandles(input.confirmationCandles);
  const confirmationHistory=buildGoldilocksHistoryChunked(input.confirmationCandles,1_000,200);
  const resolveOutcome=buildProtectedOutcomeResolver(confirmation);
  input.onProgress?.({stage:'building M15 context',completed:2,total:4,percent:10});
  const trendHistory=buildGoldilocksHistoryChunked(input.trendCandles,1_000,200);
  const marketContext=buildMarketContextIndex(input.trendCandles,1_000,200);
  const sources=[
    {timeframe:GOLDILOCKS_DEMO_TIMEFRAMES.confirmation,candles:input.confirmationCandles,history:confirmationHistory},
    {timeframe:GOLDILOCKS_DEMO_TIMEFRAMES.zone,candles:input.zoneCandles,history:zoneHistory},
    {timeframe:GOLDILOCKS_DEMO_TIMEFRAMES.trend,candles:input.trendCandles,history:trendHistory},
  ];
  const candidates:BacktestTradeInput[]=[];
  type ZoneScanState={zone:GoldilocksZone;departed:boolean;touchIndex:number;priorTouches:number;priorMaxPenetration:number};
  const pending=[...zoneHistory.zones].sort((left,right)=>(left.availableAt??left.candleTime)-(right.availableAt??right.candleTime));
  const active=new Map<string,ZoneScanState>();
  let pendingIndex=0;
  const progressEvery=Math.max(1,Math.floor(confirmation.length/100));
  for(let index=0;index<confirmation.length;index+=1){
    const candle=confirmation[index];
    while(pendingIndex<pending.length&&(pending[pendingIndex].availableAt??pending[pendingIndex].candleTime)<candle.time){
      const zone=pending[pendingIndex++];
      if(zoneUsableAt(zone,candle.time))active.set(zone.id,{zone,departed:false,touchIndex:-1,priorTouches:0,priorMaxPenetration:0});
    }
    if(index%progressEvery===0||index===confirmation.length-1){
      input.onProgress?.({stage:'scanning M1 confirmations',completed:index+1,total:confirmation.length,percent:10+Math.round(((index+1)/Math.max(1,confirmation.length))*85)});
    }
    for(const [zoneId,state] of active){
      const {zone}=state;
      if(candle.time>expiresAt(zone.candleTime)||(zone.invalidatedAt&&candle.time>=zone.invalidatedAt)){
        active.delete(zoneId);
        continue;
      }
      const broken=zone.side==='demand'?candle.low<zone.low:candle.high>zone.high;
      if(broken){active.delete(zoneId);continue}
      const outside=zone.side==='demand'?candle.low>zone.high:candle.high<zone.low;
      const touched=candle.high>=zone.low&&candle.low<=zone.high;
      if(state.touchIndex<0){
        if(outside)state.departed=true;
        if(touched&&state.departed){state.touchIndex=index;state.departed=false}
        continue;
      }
      const touch=confirmation[state.touchIndex];
      const confirmed=zone.side==='demand'?candle.close>candle.open&&candle.close>touch.high:candle.close<candle.open&&candle.close<touch.low;
      if(!confirmed)continue;
      const known=zoneHistory.zones.filter(item=>zoneUsableAt(item,candle.time));
      const runway=validateTwoToOneRunway(zone,known,candle.close);
      if(runway.allowed){
        const scoredZone=annotateConfluenceAt({...zone,touches:state.priorTouches,maxPenetration:state.priorMaxPenetration},GOLDILOCKS_DEMO_TIMEFRAMES.zone,candle.time,sources);
        const direction=zone.side==='demand'?'BUY':'SELL';
        const context=marketContextAt(marketContext,candle.time,runway.entry,direction);
        const trend=context.trend;
        const score=scoreGoldilocksSetup({
          zone:scoredZone,tradeDirection:direction,trend,minimumScore:input.minimumScore,
          purityTouches:state.priorTouches,purityMaxPenetration:state.priorMaxPenetration,availableRewardRisk:runway.availableRatio,
          rangeAssessment:context.rangeAssessment,
          gates:[
            {name:'Zone validity',passed:true,reason:'Historically active at confirmation.'},
            {name:'Confirmation freshness',passed:true,reason:'M1 close-through completed after touch.'},
            {name:'2:1 runway',passed:true,reason:runway.reason},
          ],
        });
        if(score.eligible){
          const oneR=direction==='BUY'?runway.entry+runway.risk:runway.entry-runway.risk;
          const resolved=resolveOutcome(index+1,direction,runway.stopLoss,oneR,runway.takeProfit,score.total);
          const result:BacktestTradeInput|null=resolved?{runId:input.runId,pair:input.pair,zoneId:zone.id,zoneKind:zone.kind,direction,
            confirmationTime:candle.time,...resolved,entry:runway.entry,stopLoss:runway.stopLoss,
            oneR,takeProfit:runway.takeProfit,score:score.total,scoreJson:score,priorTouches:state.priorTouches,maxPenetration:state.priorMaxPenetration,
            availableRrr:runway.availableRatio,confluenceCount:scoredZone.timeframeConfluence?.timeframeCount??1,trend}:null;
          if(result)candidates.push(result);
        }
      }
      state.priorMaxPenetration=Math.max(state.priorMaxPenetration,penetration(zone,touch));
      state.priorTouches+=1;
      if(state.priorTouches>=3){active.delete(zoneId);continue}
      state.touchIndex=-1;
      state.departed=outside;
    }
  }
  candidates.sort((a,b)=>a.confirmationTime-b.confirmationTime||b.score-a.score);
  const selected:BacktestTradeInput[]=[];
  let availableAfter=0;
  for(const trade of candidates){
    if(trade.confirmationTime<=availableAfter)continue;
    selected.push(trade);
    availableAfter=trade.outcomeTime;
  }
  input.onProgress?.({stage:'complete',completed:1,total:1,percent:100});
  return selected;
};
