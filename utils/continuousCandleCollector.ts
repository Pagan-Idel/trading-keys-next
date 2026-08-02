import type { Candle } from './swingLabeler.ts';
import { clearCandleSyncGapsThrough, getArchivedCandleBounds, getCandleNoPrintIntervals, readArchivedCandles, recordCandleNoPrintInterval, recordCandleSyncGap, upsertArchivedCandles, type CandleNoPrintInterval } from './candleArchive.ts';
import { fetchCandleHistory } from './oanda/api/fetchCandleHistory.ts';
import { fetchCandles, fetchCompletedCandlesSince } from './oanda/api/fetchCandles.ts';
import { tfToSeconds } from './shared.ts';

export type CandleCollectorKey={pair:string;timeframe:string;mode:'live'|'demo'};
export type CandleSyncResult={key:CandleCollectorKey;requested:boolean;appended:number;gapDetected:boolean;gapRepaired:boolean;noPrintRecorded?:{startTime:number;endTime:number};latestTime?:string};
export type CandleRepairResult={candles:Candle[];coverageConfirmed:boolean};
export type CandleCollectorDependencies={
  bounds:(key:CandleCollectorKey)=>{startTime:number|null;endTime:number|null;candleCount:number};
  bootstrap:(key:CandleCollectorKey,lookbackDays:number,maxCandles:number,signal?:AbortSignal)=>Promise<Candle[]>;
  incremental:(key:CandleCollectorKey,lastTime:string,count:number,signal?:AbortSignal)=>Promise<Candle[]>;
  repair:(key:CandleCollectorKey,from:string,to:string,signal?:AbortSignal)=>Promise<CandleRepairResult>;
  append:(key:CandleCollectorKey,candles:Candle[])=>number;
  recordGap:(key:CandleCollectorKey,start:number,end:number)=>unknown;clearGaps:(key:CandleCollectorKey,end:number)=>unknown;
  read:(key:CandleCollectorKey,start:number,end:number)=>Candle[];
  noPrints:(key:CandleCollectorKey)=>CandleNoPrintInterval[];
  recordNoPrint:(key:CandleCollectorKey,start:number,end:number)=>unknown;
  now:()=>number;
};
const inFlight=new Map<string,Promise<CandleSyncResult>>();
const identity=(key:CandleCollectorKey)=>`${key.mode}:${key.pair}:${key.timeframe}`;
const defaultDependencies:CandleCollectorDependencies={
  bounds:getArchivedCandleBounds,
  bootstrap:(key,lookbackDays,maxCandles,signal)=>fetchCandleHistory(key.pair,key.timeframe,{lookbackDays,mode:key.mode,maxCandles,backfillPages:1,signal}),
  incremental:(key,lastTime,count,signal)=>fetchCompletedCandlesSince(key.pair,key.timeframe,lastTime,key.mode,count,signal,false),
  repair:async(key,from,to,signal)=>({candles:await fetchCandles(key.pair,key.timeframe,5_000,from,to,key.mode,signal,false),coverageConfirmed:true}),
  append:upsertArchivedCandles,
  recordGap:recordCandleSyncGap,clearGaps:clearCandleSyncGapsThrough,
  read:readArchivedCandles,now:Date.now,
  noPrints:getCandleNoPrintIntervals,recordNoPrint:recordCandleNoPrintInterval,
};

export class ContinuousCandleCollector{
  constructor(readonly key:CandleCollectorKey,readonly options:{lookbackDays:number;maxCandles:number;incrementalLimit?:number},readonly dependencies:CandleCollectorDependencies=defaultDependencies){}
  bootstrap(signal?:AbortSignal){return this.singleFlight(async()=>{
    const before=this.dependencies.bounds(this.key);
    if(!before.candleCount)await this.dependencies.bootstrap(this.key,this.options.lookbackDays,this.options.maxCandles,signal);
    return this.synchronizeInternal(signal,before.candleCount===0);
  })}
  synchronize(signal?:AbortSignal){return this.singleFlight(()=>this.synchronizeInternal(signal,false))}
  private singleFlight(work:()=>Promise<CandleSyncResult>){
    const key=identity(this.key),existing=inFlight.get(key);if(existing)return existing;
    const promise=work().finally(()=>{if(inFlight.get(key)===promise)inFlight.delete(key)});inFlight.set(key,promise);return promise;
  }
  private async synchronizeInternal(signal?:AbortSignal,bootstrapped=false):Promise<CandleSyncResult>{
    const before=this.dependencies.bounds(this.key);
    if(before.endTime===null)return {key:this.key,requested:bootstrapped,appended:before.candleCount,gapDetected:false,gapRepaired:false};
    const interval=tfToSeconds(this.key.timeframe),lastTime=new Date(before.endTime*1000).toISOString();
    const expectedNext=before.endTime+interval;
    if(expectedNext*1000>this.dependencies.now()-1_000)return {key:this.key,requested:bootstrapped,appended:0,gapDetected:false,gapRepaired:false,latestTime:lastTime};
    const returned=await this.dependencies.incremental(this.key,lastTime,this.options.incrementalLimit??5_000,signal);
    const complete=returned.filter(candle=>Date.parse(candle.time)+interval*1000<=this.dependencies.now());
    const times=complete.map(candle=>Math.floor(Date.parse(candle.time)/1000)).filter(Number.isFinite).sort((a,b)=>a-b);
    let combined=complete;
    let noPrints=this.dependencies.noPrints(this.key);
    let gap=findUnexpectedGap(before.endTime,times,interval,noPrints);
    let noPrintRecorded:{startTime:number;endTime:number}|undefined;
    if(gap){
      const repair=await this.dependencies.repair(this.key,new Date(before.endTime*1000).toISOString(),new Date(gap.end*1000).toISOString(),signal);
      const merged=new Map([...repair.candles,...complete].map(item=>[item.time,item]));combined=[...merged.values()].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
      const combinedTimes=combined.map(item=>Math.floor(Date.parse(item.time)/1000));
      const repairedGap=findUnexpectedGap(before.endTime,combinedTimes,interval,noPrints);
      if(repair.coverageConfirmed&&repairedGap?.start===gap.start&&repairedGap.end===gap.end&&combinedTimes.includes(gap.end)){
        this.dependencies.recordNoPrint(this.key,gap.start,gap.end);noPrintRecorded={startTime:gap.start,endTime:gap.end};
        noPrints=[...noPrints,{...noPrintRecorded,source:'OANDA_NO_PRINT',confirmedAt:new Date().toISOString()}];
      }
      gap=findUnexpectedGap(before.endTime,combinedTimes,interval,noPrints);
    }
    const gapDetected=Boolean(gap);
    if(gap)this.dependencies.recordGap(this.key,gap.start,gap.end);
    else {this.dependencies.append(this.key,combined);const promoted=Math.max(before.endTime,...combined.map(item=>Math.floor(Date.parse(item.time)/1000)));this.dependencies.clearGaps(this.key,promoted)}
    const after=this.dependencies.bounds(this.key);
    const appended=Math.max(0,after.candleCount-before.candleCount);
    const gapRepaired=!gapDetected&&after.endTime!==null&&after.endTime>=expectedNext;
    return {key:this.key,requested:true,appended,gapDetected,gapRepaired,noPrintRecorded,latestTime:after.endTime===null?lastTime:new Date(after.endTime*1000).toISOString()};
  }
}

const nyParts=(epochSeconds:number)=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',hourCycle:'h23'})
  .formatToParts(new Date(epochSeconds*1000)).filter(part=>part.type==='weekday'||part.type==='hour').map(part=>[part.type,part.value]));
export const isScheduledForexClosure=(epochSeconds:number)=>{const parts=nyParts(epochSeconds),hour=Number(parts.hour);
  return parts.weekday==='Sat'||(parts.weekday==='Fri'&&hour>=17)||(parts.weekday==='Sun'&&hour<17)};
export const findUnexpectedGap=(last:number,times:number[],interval:number,noPrints:Array<Pick<CandleNoPrintInterval,'startTime'|'endTime'>>=[])=>{
  let previous=last;
  for(const time of [...times].sort((a,b)=>a-b)){
    for(let expected=previous+interval;expected<time;expected+=interval)if(!isScheduledForexClosure(expected)&&
      !noPrints.some(item=>expected>=item.startTime&&expected<item.endTime))return {start:expected,end:time};
    previous=time;
  }
  return null;
};

export const activeCandleSynchronizationCount=()=>inFlight.size;
