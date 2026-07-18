import { zoneUsableAt } from './goldilocksScanner.ts';
import type { GoldilocksZone, StrategyCandle } from './goldilocksStrategy.ts';

export interface ZoneCorridorMeasurement {
  timeframe:string;
  measuredAt:number;
  available:boolean;
  reason:string;
  demandZoneId?:string;
  supplyZoneId?:string;
  demandHigh?:number;
  supplyLow?:number;
  width?:number;
  widthPips?:number;
  atr14?:number;
  widthAtr?:number;
  entryLocationPct?:number;
  initialRiskPct?:number;
  targetDistancePct?:number;
  opposingRoomPct?:number;
  oneRPct?:number;
  twoRPct?:number;
  fourRPct?:number;
}

const lastAtOrBefore=<T extends {time:number}>(items:T[],time:number)=>{let low=0,high=items.length;while(low<high){const middle=(low+high)>>>1;if(items[middle].time<=time)low=middle+1;else high=middle}return low-1};
const atr14At=(candles:StrategyCandle[],time:number)=>{
  const end=lastAtOrBefore(candles,time);
  if(end<1)return undefined;
  const start=Math.max(1,end-13);
  let total=0,count=0;
  for(let index=start;index<=end;index+=1){
    const candle=candles[index],previous=candles[index-1];
    total+=Math.max(candle.high-candle.low,Math.abs(candle.high-previous.close),Math.abs(candle.low-previous.close));count+=1;
  }
  return count?total/count:undefined;
};

export const measureZoneCorridor=(args:{
  pair:string;timeframe:string;measuredAt:number;entry:number;stopLoss:number;takeProfit:number;
  zones:GoldilocksZone[];candles:StrategyCandle[];
}):ZoneCorridorMeasurement=>{
  const {pair,timeframe,measuredAt,entry,stopLoss,takeProfit,zones,candles}=args;
  const usable=zones.filter(zone=>(zone.availableAt??zone.candleTime)<=measuredAt&&zoneUsableAt(zone,measuredAt));
  const demands=usable.filter(zone=>zone.side==='demand'&&zone.high<=entry).sort((a,b)=>b.high-a.high);
  const supplies=usable.filter(zone=>zone.side==='supply'&&zone.low>=entry).sort((a,b)=>a.low-b.low);
  const demand=demands[0],supply=supplies[0];
  if(!demand||!supply)return {timeframe,measuredAt,available:false,reason:`No complete active ${timeframe} demand-to-supply corridor bracketed the entry.`};
  const width=supply.low-demand.high;
  if(!(width>0))return {timeframe,measuredAt,available:false,reason:`The nearest active ${timeframe} zones overlapped, so no positive corridor was measurable.`};
  const atr14=atr14At(candles,measuredAt);
  const pipSize=pair.replace(/[^A-Z]/gi,'').toUpperCase().endsWith('JPY')?.01:.0001;
  const risk=Math.abs(entry-stopLoss);
  const targetDistance=Math.abs(takeProfit-entry);
  const opposingRoom=Math.max(0,Math.min(Math.abs(supply.low-entry),Math.abs(entry-demand.high)));
  const percentage=(distance:number)=>distance/width*100;
  return {
    timeframe,measuredAt,available:true,reason:`Nearest active ${timeframe} demand and supply bracketed the executable entry.`,
    demandZoneId:demand.id,supplyZoneId:supply.id,demandHigh:demand.high,supplyLow:supply.low,width,widthPips:width/pipSize,
    atr14,widthAtr:atr14&&atr14>0?width/atr14:undefined,
    entryLocationPct:(entry-demand.high)/width*100,
    initialRiskPct:percentage(risk),targetDistancePct:percentage(targetDistance),opposingRoomPct:percentage(opposingRoom),
    oneRPct:percentage(risk),twoRPct:percentage(risk*2),fourRPct:percentage(risk*4),
  };
};
