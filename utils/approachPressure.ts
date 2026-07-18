import type { GoldilocksZone, StrategyCandle } from './goldilocksStrategy.ts';

export interface GoldilocksApproachPressure {
  version: 1;
  zoneSide: 'demand' | 'supply';
  approachWindowCandles: number;
  sweepLookbackCandles: number;
  liquiditySweepCount: number;
  latestSweepTime: number | null;
  latestSweepAgeBars: number | null;
  latestSweepDepthAtr: number | null;
  recoveryDisplacementAtr: number;
  directionalStepCount: number;
  directionalStepFraction: number;
  directionalCloseFraction: number;
  approachProgressZoneWidths: number;
  approachCompressionScore: number;
  confirmationBodyFraction: number;
  confirmationCloseThroughZoneFraction: number;
  confirmationRejectionWickFraction: number;
  confirmationStrengthScore: number;
  weakConfirmation: boolean;
  adversePressureFlags: string[];
  adversePressureScore: number;
}

const bounded=(value:number,min=0,max=1)=>Math.min(max,Math.max(min,value));
const safeRatio=(numerator:number,denominator:number)=>denominator>0&&Number.isFinite(denominator)?numerator/denominator:0;

const averageTrueRange=(candles:StrategyCandle[],endExclusive:number,period=14)=>{
  const start=Math.max(0,endExclusive-period);
  const ranges:number[]=[];
  for(let index=start;index<endExclusive;index+=1){
    const candle=candles[index];
    const previousClose=index>0?candles[index-1].close:candle.open;
    ranges.push(Math.max(candle.high-candle.low,Math.abs(candle.high-previousClose),Math.abs(candle.low-previousClose)));
  }
  return ranges.length?ranges.reduce((sum,value)=>sum+value,0)/ranges.length:0;
};

export const measureGoldilocksApproachPressure=(
  zone:Pick<GoldilocksZone,'side'|'low'|'high'|'width'>,
  candles:StrategyCandle[],
  touchIndex:number,
  confirmationIndex:number,
  options:{approachWindowCandles?:number;sweepLookbackCandles?:number}={},
):GoldilocksApproachPressure=>{
  const approachWindowCandles=Math.max(2,Math.floor(options.approachWindowCandles??24));
  const sweepLookbackCandles=Math.max(2,Math.floor(options.sweepLookbackCandles??6));
  const safeTouchIndex=Math.max(0,Math.min(candles.length,touchIndex));
  const safeConfirmationIndex=Math.max(safeTouchIndex,Math.min(candles.length-1,confirmationIndex));
  const approachStart=Math.max(0,safeTouchIndex-approachWindowCandles);
  const approach=candles.slice(approachStart,safeTouchIndex);
  const atr=averageTrueRange(candles,safeTouchIndex)||Math.max(Number(zone.width)||0,Number.EPSILON);
  const sweeps:Array<{index:number;time:number;reference:number;depthAtr:number}>=[];

  for(let index=approachStart;index<safeTouchIndex;index+=1){
    const referenceStart=Math.max(0,index-sweepLookbackCandles);
    const referenceCandles=candles.slice(referenceStart,index);
    if(referenceCandles.length<2)continue;
    const candle=candles[index];
    if(zone.side==='supply'){
      const reference=Math.min(...referenceCandles.map(item=>item.low));
      if(candle.low<reference&&candle.close>=reference)sweeps.push({index,time:candle.time,reference,depthAtr:safeRatio(reference-candle.low,atr)});
    }else{
      const reference=Math.max(...referenceCandles.map(item=>item.high));
      if(candle.high>reference&&candle.close<=reference)sweeps.push({index,time:candle.time,reference,depthAtr:safeRatio(candle.high-reference,atr)});
    }
  }

  const latestSweep=sweeps.at(-1);
  const recoveryCandles=latestSweep?candles.slice(latestSweep.index+1,safeTouchIndex):[];
  const recoveryDisplacementAtr=latestSweep&&recoveryCandles.length
    ?zone.side==='supply'
      ?safeRatio(Math.max(0,Math.max(...recoveryCandles.map(candle=>candle.close))-latestSweep.reference),atr)
      :safeRatio(Math.max(0,latestSweep.reference-Math.min(...recoveryCandles.map(candle=>candle.close))),atr)
    :0;

  const compression=approach.slice(-8);
  let directionalStepCount=0;
  for(let index=1;index<compression.length;index+=1){
    if(zone.side==='supply'&&compression[index].low>compression[index-1].low)directionalStepCount+=1;
    if(zone.side==='demand'&&compression[index].high<compression[index-1].high)directionalStepCount+=1;
  }
  const directionalStepFraction=safeRatio(directionalStepCount,Math.max(0,compression.length-1));
  const directionalCloses=compression.filter(candle=>zone.side==='supply'?candle.close>candle.open:candle.close<candle.open).length;
  const directionalCloseFraction=safeRatio(directionalCloses,compression.length);
  const firstApproachClose=compression[0]?.close;
  const lastApproachClose=compression.at(-1)?.close;
  const approachProgressZoneWidths=firstApproachClose===undefined||lastApproachClose===undefined
    ?0
    :safeRatio(zone.side==='supply'?lastApproachClose-firstApproachClose:firstApproachClose-lastApproachClose,Math.max(zone.width,Number.EPSILON));
  const approachCompressionScore=bounded(
    0.4*directionalStepFraction+0.3*directionalCloseFraction+0.3*bounded(approachProgressZoneWidths),
  );

  const touch=candles[safeTouchIndex];
  const confirmation=candles[safeConfirmationIndex];
  const confirmationRange=confirmation?Math.max(0,confirmation.high-confirmation.low):0;
  const confirmationBodyFraction=confirmation?safeRatio(Math.abs(confirmation.close-confirmation.open),confirmationRange):0;
  const confirmationCloseThroughZoneFraction=touch&&confirmation
    ?safeRatio(Math.max(0,zone.side==='supply'?touch.low-confirmation.close:confirmation.close-touch.high),Math.max(zone.width,Number.EPSILON))
    :0;
  const confirmationRejectionWickFraction=confirmation
    ?safeRatio(zone.side==='supply'
      ?confirmation.high-Math.max(confirmation.open,confirmation.close)
      :Math.min(confirmation.open,confirmation.close)-confirmation.low,confirmationRange)
    :0;
  const confirmationStrengthScore=bounded(
    0.45*bounded(confirmationBodyFraction)
    +0.35*bounded(confirmationCloseThroughZoneFraction/0.25)
    +0.2*bounded(confirmationRejectionWickFraction),
  );
  const weakConfirmation=confirmationStrengthScore<0.35;
  const adversePressureFlags:string[]=[];
  if(sweeps.length)adversePressureFlags.push(zone.side==='supply'?'downside_sweep':'upside_sweep');
  if(recoveryDisplacementAtr>=1)adversePressureFlags.push(zone.side==='supply'?'bullish_recovery':'bearish_recovery');
  if(approachCompressionScore>=0.6)adversePressureFlags.push(zone.side==='supply'?'compression_into_supply':'compression_into_demand');
  if(weakConfirmation)adversePressureFlags.push('weak_confirmation');

  return {
    version:1,
    zoneSide:zone.side,
    approachWindowCandles:approach.length,
    sweepLookbackCandles,
    liquiditySweepCount:sweeps.length,
    latestSweepTime:latestSweep?.time??null,
    latestSweepAgeBars:latestSweep?safeTouchIndex-latestSweep.index:null,
    latestSweepDepthAtr:latestSweep?.depthAtr??null,
    recoveryDisplacementAtr,
    directionalStepCount,
    directionalStepFraction,
    directionalCloseFraction,
    approachProgressZoneWidths,
    approachCompressionScore,
    confirmationBodyFraction,
    confirmationCloseThroughZoneFraction,
    confirmationRejectionWickFraction,
    confirmationStrengthScore,
    weakConfirmation,
    adversePressureFlags,
    adversePressureScore:adversePressureFlags.length,
  };
};
