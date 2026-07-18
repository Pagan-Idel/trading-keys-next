import type { GoldilocksZone } from './goldilocksStrategy.ts';
import { zoneUsableAt } from './goldilocksScanner.ts';

export interface StrategyReplayWindow {
  chartStart:number;
  chartEnd:number;
  confirmationStart:number;
  confirmationEnd:number;
}

export const STRATEGY_REPLAY_BASE_CONTEXT_SECONDS=12*60*60;

const formatEpochInZone=(epochSeconds:number,timeZone:string)=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',
    hour12:false,hourCycle:'h23',timeZoneName:'short',
  }).formatToParts(new Date(epochSeconds*1000)).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${timeZone==='UTC'?'UTC':parts.timeZoneName}`;
};

export const formatStrategyReplayUtc=(epochSeconds:number)=>formatEpochInZone(epochSeconds,'UTC');
export const formatStrategyReplayNewYork=(epochSeconds:number)=>formatEpochInZone(epochSeconds,'America/New_York');

export const getStrategyReplayBaseContextStart=(zoneBaseTime:number)=>(
  zoneBaseTime-STRATEGY_REPLAY_BASE_CONTEXT_SECONDS
);

export const getStrategyReplayContextAnchor=(
  tradeZoneBaseTime:number,
  priorTouchTimes:number[]=[],
  displayedZoneBaseTimes:number[]=[],
):number|undefined=>{
  const candidates=[tradeZoneBaseTime,...priorTouchTimes,...displayedZoneBaseTimes]
    .filter(Number.isFinite);
  return candidates.length?Math.min(...candidates):undefined;
};

export const getStrategyReplayRequestEnd=(requestedEnd:number,nowSeconds=Math.floor(Date.now()/1000))=>(
  Math.min(requestedEnd,Math.floor(nowSeconds/60)*60-1)
);

export const getReplayCandleIndexAtOrBefore=(
  candles:Array<{time:number}>,
  eventTime:number,
):number=>{
  if(!candles.length)return -1;
  let result=0;
  for(let index=1;index<candles.length;index+=1){
    if(candles[index].time>eventTime)break;
    result=index;
  }
  return result;
};

export const getReplayExitMarkerPrice=(trade:{
  exitReason?:string;
  exitPrice?:number;
  runway:{entry:number;stopLoss:number;takeProfit:number};
})=>trade.exitReason==='weekend_close'&&Number.isFinite(trade.exitPrice)
  ?trade.exitPrice!
  :trade.exitReason==='stop'
  ?trade.runway.stopLoss
  :trade.exitReason==='target'
    ?trade.runway.takeProfit
    :trade.runway.entry;

export const getReplayVisibleEnd=(
  lastCandleIndex:number,
  entryIndex:number,
  exitIndex:number,
  timeframe?:string,
)=>{
  const normalPadding=20;
  const minimumPostExitBars=timeframe==='H1'?3:timeframe==='M15'?4:6;
  const normalEnd=Math.min(lastCandleIndex,Math.max(entryIndex,exitIndex)+normalPadding);
  return Math.max(normalEnd,exitIndex+minimumPostExitBars);
};

export const getReplayVisibleStart=(
  zoneBaseIndex:number,
  entryIndex:number,
  exitIndex:number,
  padding=20,
)=>Math.max(0,Math.min(zoneBaseIndex,entryIndex,exitIndex)-padding);

export const sortUniqueReplayCandleItems=<T extends {candle:{time:unknown}}>(items:T[]):T[]=>{
  const byTime=new Map<number,T>();
  for(const item of items)byTime.set(Number(item.candle.time),item);
  return [...byTime.values()].sort((left,right)=>Number(left.candle.time)-Number(right.candle.time));
};

export const filterReplayRejectedFirstTouchesAt=<T extends {zoneId:string}>(
  items:T[],
  zones:GoldilocksZone[],
  displayTime:number,
  displayedZoneIds?:ReadonlySet<string>,
):T[]=>{
  const zonesById=new Map(zones.map(zone=>[zone.id,zone]));
  return items.filter(item=>{
    const zone=zonesById.get(item.zoneId);
    return Boolean(
      zone&&
      zoneUsableAt(zone,displayTime)&&
      (!displayedZoneIds||displayedZoneIds.has(item.zoneId))
    );
  });
};

export const formatStrategyZoneLabel=(zone:{
  historicalTradeZone:boolean;
  historicalContextZone?:boolean;
  kind:'base'|'continuation';
  side:'demand'|'supply';
  departureMultiple:number;
  touches:number;
  timeframeConfluence?:{timeframeCount:number;timeframes:string[]};
})=>{
  const prefix=zone.historicalTradeZone?'HISTORY TRADE ZONE · ':zone.historicalContextZone?'HISTORY CONTEXT ZONE · ':'';
  const zoneKind=zone.kind==='base'?'Base':'Continuation';
  const touchLabel=zone.historicalTradeZone
    ?`${zone.touches} prior touch${zone.touches===1?'':'es'}`
    :`${zone.touches} touch${zone.touches===1?'':'es'}`;
  const confluence=zone.timeframeConfluence
    ?` · ZIZ ${zone.timeframeConfluence.timeframeCount}/3${zone.timeframeConfluence.timeframes.length===zone.timeframeConfluence.timeframeCount?` · ${zone.timeframeConfluence.timeframes.join('+')}`:''}`
    :'';
  return `${prefix}${zoneKind} ${zone.side} · ${zone.departureMultiple.toFixed(1)}x · ${touchLabel}${confluence}`;
};

export const getStrategyReplayWindow=(
  confirmationTime:number,
  outcomeTime:number,
  zoneBaseTime?:number,
):StrategyReplayWindow=>({
  chartStart:Number.isFinite(zoneBaseTime)
    ?Math.min(confirmationTime-7*24*60*60,getStrategyReplayBaseContextStart(zoneBaseTime!))
    :confirmationTime-7*24*60*60,
  chartEnd:outcomeTime+24*60*60,
  confirmationStart:confirmationTime-2*24*60*60,
  confirmationEnd:confirmationTime+12*60*60,
});
