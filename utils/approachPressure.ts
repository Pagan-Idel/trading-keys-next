import type { GoldilocksZone, StrategyCandle } from './goldilocksStrategy.ts';

export interface GoldilocksApproachPressure {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17;
  zoneSide: 'demand' | 'supply';
  approachWindowCandles: number;
  approachReturnLegCandles?: number;
  sourceApproachCandles?: number;
  analysisTimeframeSeconds?: number;
  sweepTimeframeSeconds?: number;
  sweepLookbackCandles?: number;
  sweepReturnLegStartTime?: number | null;
  approachReturnLegStartTime?: number | null;
  firstOutsideTime?: number | null;
  liquiditySweepTimes?: number[];
  liquidityPoolStartTimes?: number[];
  liquidityPoolEndTimes?: number[];
  adverseRecoveryTimes?: number[];
  approachEvidenceTimes?: number[];
  sweepTolerancePrice?: number;
  liquiditySweepCount: number;
  latestSweepTime: number | null;
  latestSweepAgeBars: number | null;
  latestSweepDepthAtr: number | null;
  recoveryDisplacementAtr: number;
  latestRecoveryTime?: number | null;
  approachEvidenceTime?: number | null;
  directionalStepCount: number;
  directionalStepFraction: number;
  directionalCloseFraction: number;
  approachProgressZoneWidths: number;
  approachCompressionScore: number;
  approachClassification?: 'tightening_compression' | 'orderly_approach' | 'momentum_drive' | 'mixed_unclear';
  approachRangeContractionRatio?: number;
  approachBodyContractionRatio?: number;
  approachAverageOverlapFraction?: number;
  approachProgressEfficiency?: number;
  approachMomentumVeto?: boolean;
  fastApproachCandleTimes?: number[];
  fastApproachCandleAtrMultiples?: number[];
  fastApproachCandleCount?: number;
  fastApproachBurstCount?: number;
  fastApproachMaximumBodyAtr?: number;
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
const median=(values:number[])=>{
  if(!values.length)return 0;
  const sorted=[...values].sort((left,right)=>left-right);
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
};
const SWEEP_MINIMUM_POOL_CANDLES=4;
const SWEEP_MAXIMUM_EDGE_SPREAD_ATR=0.25;
const SWEEP_MAXIMUM_POOL_RANGE_ATR=1.5;
const SWEEP_MAXIMUM_CLOSE_DRIFT_ATR=0.75;
const SWEEP_MINIMUM_OVERLAP_FRACTION=0.35;
const SWEEP_MINIMUM_BREACH_ATR=0.02;
const SWEEP_REACTION_ATR=1;
const FAST_APPROACH_BODY_ATR=1.5;
const FAST_APPROACH_MINIMUM_BODY_FRACTION=0.6;
const FAST_APPROACH_MINIMUM_CANDLES=2;

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

const aggregateCandles=(candles:StrategyCandle[],seconds:number):StrategyCandle[]=>{
  const result:StrategyCandle[]=[];
  for(const candle of candles){
    const bucket=Math.floor(candle.time/seconds)*seconds;
    const current=result.at(-1);
    if(!current||current.time!==bucket){
      result.push({...candle,time:bucket});
      continue;
    }
    current.high=Math.max(current.high,candle.high);
    current.low=Math.min(current.low,candle.low);
    current.close=candle.close;
  }
  return result;
};

const adaptiveApproachCandles=(candles:StrategyCandle[])=>{
  if(candles.length<2)return {candles,timeframeSeconds:0};
  const differences=candles.slice(1).map((candle,index)=>candle.time-candles[index].time).filter((value)=>value>0);
  const sourceSeconds=Math.max(1,median(differences)||1);
  const standardSeconds=[sourceSeconds,...[60,300,900,1800,3600,14400,86400].filter((seconds)=>seconds>sourceSeconds)];
  for(const seconds of standardSeconds){
    const aggregated=aggregateCandles(candles,seconds);
    if(aggregated.length<=500)return {candles:aggregated,timeframeSeconds:seconds};
  }
  const timeframeSeconds=standardSeconds.at(-1)??sourceSeconds;
  return {candles:aggregateCandles(candles,timeframeSeconds),timeframeSeconds};
};

const latestReturnLegExtremeIndex=(
  candles:StrategyCandle[],
  side:'demand'|'supply',
)=>{
  if(!candles.length)return 0;
  return candles.reduce((extremeIndex,candle,index)=>{
    const extreme=candles[extremeIndex];
    if(side==='supply'&&candle.low<=extreme.low)return index;
    if(side==='demand'&&candle.high>=extreme.high)return index;
    return extremeIndex;
  },0);
};

export const measureGoldilocksApproachPressure=(
  zone:Pick<GoldilocksZone,'side'|'low'|'high'|'width'|'candleTime'>,
  candles:StrategyCandle[],
  touchIndex:number,
  confirmationIndex:number,
  options:{firstOutsideTime?:number;sweepTimeframeSeconds?:number}={},
):GoldilocksApproachPressure=>{
  const safeTouchIndex=Math.max(0,Math.min(candles.length,touchIndex));
  const safeConfirmationIndex=Math.max(safeTouchIndex,Math.min(candles.length-1,confirmationIndex));
  const derivedFirstOutsideIndex=candles.findIndex((candle,index)=>
    index<safeTouchIndex
    &&candle.time>zone.candleTime
    &&(zone.side==='supply'?candle.close<zone.low:candle.close>zone.high));
  const configuredFirstOutsideIndex=options.firstOutsideTime===undefined
    ?-1
    :candles.findIndex((candle,index)=>index<safeTouchIndex&&candle.time>=options.firstOutsideTime!);
  const approachStart=configuredFirstOutsideIndex>=0
    ?configuredFirstOutsideIndex
    :derivedFirstOutsideIndex>=0
      ?derivedFirstOutsideIndex
      :safeTouchIndex;
  const sourceApproach=candles.slice(approachStart,safeTouchIndex);
  const adaptiveApproach=adaptiveApproachCandles(sourceApproach);
  const approach=adaptiveApproach.candles;
  const approachReturnLegStartIndex=latestReturnLegExtremeIndex(approach,zone.side);
  const returnApproach=approach.slice(approachReturnLegStartIndex);
  const atr=averageTrueRange(returnApproach,returnApproach.length)||Math.max(Number(zone.width)||0,Number.EPSILON);
  const requestedSweepTimeframeSeconds=Math.max(0,Math.floor(options.sweepTimeframeSeconds??0));
  const sweepApproach=requestedSweepTimeframeSeconds>0
    ?aggregateCandles(sourceApproach,requestedSweepTimeframeSeconds)
    :approach;
  const sweepAtr=averageTrueRange(sweepApproach,sweepApproach.length)||Math.max(Number(zone.width)||0,Number.EPSILON);
  const sweepReturnLegStartIndex=latestReturnLegExtremeIndex(sweepApproach,zone.side);
  const sweeps:Array<{
    index:number;
    time:number;
    reference:number;
    extreme:number;
    depthAtr:number;
    atr:number;
    tolerance:number;
    poolStartTime:number;
    poolEndTime:number;
    reactionTime:number;
  }>=[];
  let lastConfirmedSweepIndex=-1;

  for(let index=sweepReturnLegStartIndex;index<sweepApproach.length;index+=1){
    const candle=sweepApproach[index];
    if(index<SWEEP_MINIMUM_POOL_CANDLES)continue;
    const localAtr=averageTrueRange(sweepApproach,index)||sweepAtr;
    const minimumExcursion=Math.max(
      localAtr*SWEEP_MINIMUM_BREACH_ATR,
      Math.max(zone.width,Number.EPSILON)*0.01,
    );
    const recentStart=lastConfirmedSweepIndex+1;
    let pool:StrategyCandle[]|undefined;
    for(
      let start=index-SWEEP_MINIMUM_POOL_CANDLES;
      start>=recentStart;
      start-=1
    ){
      const candidate=sweepApproach.slice(start,index);
      const lows=candidate.map((item)=>item.low);
      const highs=candidate.map((item)=>item.high);
      const edgeValues=zone.side==='supply'?lows:highs;
      const edgeSpread=Math.max(...edgeValues)-Math.min(...edgeValues);
      const poolRange=Math.max(...highs)-Math.min(...lows);
      const closeDrift=Math.abs(candidate.at(-1)!.close-candidate[0].close);
      const overlaps:number[]=[];
      for(let poolIndex=1;poolIndex<candidate.length;poolIndex+=1){
        const previous=candidate[poolIndex-1];
        const current=candidate[poolIndex];
        const overlap=Math.max(0,Math.min(previous.high,current.high)-Math.max(previous.low,current.low));
        overlaps.push(safeRatio(overlap,Math.min(previous.high-previous.low,current.high-current.low)));
      }
      const averageOverlap=overlaps.length
        ?overlaps.reduce((sum,value)=>sum+bounded(value),0)/overlaps.length
        :0;
      if(
        edgeSpread>localAtr*SWEEP_MAXIMUM_EDGE_SPREAD_ATR
        ||poolRange>localAtr*SWEEP_MAXIMUM_POOL_RANGE_ATR
      )break;
      if(
        closeDrift<=localAtr*SWEEP_MAXIMUM_CLOSE_DRIFT_ATR
        &&averageOverlap>=SWEEP_MINIMUM_OVERLAP_FRACTION
      )pool=candidate;
    }
    if(!pool)continue;
    const poolLow=Math.min(...pool.map((item)=>item.low));
    const poolHigh=Math.max(...pool.map((item)=>item.high));
    const reference=zone.side==='supply'?poolLow:poolHigh;
    const excursion=zone.side==='supply'
      ?reference-candle.low
      :candle.high-reference;
    const reclaimed=zone.side==='supply'
      ?candle.close>reference
      :candle.close<reference;
    if(!reclaimed||excursion<minimumExcursion)continue;
    const poolMidpoint=(poolLow+poolHigh)/2;
    const reaction=sweepApproach.slice(index).find((reactionCandle)=>{
      const displacement=zone.side==='supply'
        ?reactionCandle.close-candle.low
        :candle.high-reactionCandle.close;
      const reachedOppositeSide=zone.side==='supply'
        ?reactionCandle.close>=poolMidpoint
        :reactionCandle.close<=poolMidpoint;
      return reachedOppositeSide&&safeRatio(displacement,localAtr)>=SWEEP_REACTION_ATR;
    });
    if(!reaction)continue;
    sweeps.push({
      index,
      time:candle.time,
      reference,
      extreme:zone.side==='supply'?candle.low:candle.high,
      depthAtr:safeRatio(excursion,localAtr),
      atr:localAtr,
      tolerance:minimumExcursion,
      poolStartTime:pool[0].time,
      poolEndTime:pool.at(-1)!.time,
      reactionTime:reaction.time,
    });
    lastConfirmedSweepIndex=index;
  }

  const latestSweep=sweeps.at(-1);
  const recoveryEvents=sweeps.map((sweep)=>({
    time:sweep.reactionTime,
    sweepTime:sweep.time,
  }));
  const recoveryCandidates=sweeps.flatMap((sweep)=>
    sweepApproach.slice(sweep.index).map((candle)=>({
      candle,
      displacement:zone.side==='supply'
        ?safeRatio(Math.max(0,candle.close-sweep.extreme),sweep.atr)
        :safeRatio(Math.max(0,sweep.extreme-candle.close),sweep.atr),
    })));
  const strongestRecovery=recoveryCandidates.reduce<(typeof recoveryCandidates)[number]|undefined>(
    (best,item)=>!best||item.displacement>best.displacement?item:best,
    undefined,
  );
  const recoveryDisplacementAtr=strongestRecovery?.displacement??0;
  const latestRecoveryCandle=strongestRecovery?.candle;

  const compression=returnApproach;
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
  const compressionTrueRanges=compression.map((candle,index)=>{
    const previousClose=index>0?compression[index-1].close:candle.open;
    const rawRange=Math.max(candle.high-candle.low,Math.abs(candle.high-previousClose),Math.abs(candle.low-previousClose));
    return safeRatio(rawRange,averageTrueRange(compression,index)||atr);
  });
  const compressionBodies=compression.map((candle,index)=>
    safeRatio(Math.abs(candle.close-candle.open),averageTrueRange(compression,index)||atr));
  const splitIndex=Math.max(1,Math.floor(compression.length/2));
  const earlierRanges=compressionTrueRanges.slice(0,splitIndex);
  const recentRanges=compressionTrueRanges.slice(splitIndex);
  const earlierBodies=compressionBodies.slice(0,splitIndex);
  const recentBodies=compressionBodies.slice(splitIndex);
  const approachRangeContractionRatio=safeRatio(median(recentRanges),median(earlierRanges));
  const approachBodyContractionRatio=safeRatio(median(recentBodies),median(earlierBodies));
  const overlaps:number[]=[];
  for(let index=1;index<compression.length;index+=1){
    const previous=compression[index-1];
    const current=compression[index];
    const overlap=Math.max(0,Math.min(previous.high,current.high)-Math.max(previous.low,current.low));
    overlaps.push(safeRatio(overlap,Math.min(previous.high-previous.low,current.high-current.low)));
  }
  const approachAverageOverlapFraction=overlaps.length
    ?overlaps.reduce((sum,value)=>sum+bounded(value),0)/overlaps.length
    :0;
  const netProgress=firstApproachClose===undefined||lastApproachClose===undefined
    ?0
    :Math.max(0,zone.side==='supply'?lastApproachClose-firstApproachClose:firstApproachClose-lastApproachClose);
  const approachAtrMedian=median(compression.map((_,index)=>averageTrueRange(compression,index)||atr))||atr;
  const approachProgressEfficiency=safeRatio(
    safeRatio(netProgress,approachAtrMedian),
    compressionTrueRanges.reduce((sum,value)=>sum+value,0),
  );

  const rangeContractionScore=bounded((1-approachRangeContractionRatio)/0.5);
  const bodyContractionScore=bounded((1-approachBodyContractionRatio)/0.5);
  const overlapScore=bounded(approachAverageOverlapFraction/0.6);
  const lowProgressEfficiencyScore=bounded((0.5-approachProgressEfficiency)/0.5);
  const directionalConsistencyScore=bounded((directionalStepFraction+directionalCloseFraction)/2);
  const approachCompressionScore=bounded(
    0.3*rangeContractionScore
    +0.2*bodyContractionScore
    +0.25*overlapScore
    +0.15*lowProgressEfficiencyScore
    +0.1*directionalConsistencyScore,
  );

  const touch=candles[safeTouchIndex];
  const fastApproachCandidates=compression.map((candle,index)=>{
    const candleRange=Math.max(0,candle.high-candle.low);
    const directionalBody=zone.side==='supply'
      ?Math.max(0,candle.close-candle.open)
      :Math.max(0,candle.open-candle.close);
    const priorAtr=averageTrueRange(compression,index)||atr;
    const bodyAtr=safeRatio(directionalBody,priorAtr);
    const bodyFraction=safeRatio(directionalBody,candleRange);
    return bodyAtr>=FAST_APPROACH_BODY_ATR
      &&bodyFraction>=FAST_APPROACH_MINIMUM_BODY_FRACTION
      ?{time:candle.time,bodyAtr}
      :null;
  });
  const fastApproachBursts:Array<Array<{time:number;bodyAtr:number}>>=[];
  let currentFastApproachBurst:Array<{time:number;bodyAtr:number}>=[];
  const finishFastApproachBurst=()=>{
    if(currentFastApproachBurst.length>=FAST_APPROACH_MINIMUM_CANDLES)
      fastApproachBursts.push(currentFastApproachBurst);
    currentFastApproachBurst=[];
  };
  for(const candidate of fastApproachCandidates){
    if(candidate)currentFastApproachBurst.push(candidate);
    else finishFastApproachBurst();
  }
  finishFastApproachBurst();
  const fastApproachCandles=fastApproachBursts.flat();
  const fastApproachMaximumBodyAtr=Math.max(
    0,
    ...fastApproachCandles.map((item)=>item.bodyAtr),
  );
  const approachMomentumVeto=fastApproachBursts.length>0;
  const directionalApproach=directionalCloseFraction>=0.5||directionalStepFraction>=0.5;
  const approachClassification=approachMomentumVeto
    ?'momentum_drive'
    :approachCompressionScore>=0.6&&directionalApproach
      ?'tightening_compression'
      :directionalApproach
        ?'orderly_approach'
        :'mixed_unclear';

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
  if(approachClassification==='momentum_drive')adversePressureFlags.push(zone.side==='supply'?'momentum_drive_into_supply':'momentum_drive_into_demand');
  const adverseShape=approachClassification==='momentum_drive';
  const approachEvidenceTimes=adverseShape&&fastApproachCandles.length
    ?[...new Set(fastApproachCandles.map((item)=>item.time))]
    :[];

  return {
    version:17,
    zoneSide:zone.side,
    approachWindowCandles:approach.length,
    approachReturnLegCandles:returnApproach.length,
    sourceApproachCandles:sourceApproach.length,
    analysisTimeframeSeconds:adaptiveApproach.timeframeSeconds,
    sweepTimeframeSeconds:requestedSweepTimeframeSeconds||adaptiveApproach.timeframeSeconds,
    sweepReturnLegStartTime:sweepApproach[sweepReturnLegStartIndex]?.time??null,
    approachReturnLegStartTime:returnApproach[0]?.time??null,
    firstOutsideTime:sourceApproach[0]?.time??null,
    liquiditySweepTimes:sweeps.map((sweep)=>sweep.time),
    liquidityPoolStartTimes:sweeps.map((sweep)=>sweep.poolStartTime),
    liquidityPoolEndTimes:sweeps.map((sweep)=>sweep.poolEndTime),
    adverseRecoveryTimes:[...new Set(recoveryEvents.map((event)=>event.time))],
    approachEvidenceTimes,
    sweepTolerancePrice:latestSweep?.tolerance??Math.max(
      sweepAtr*SWEEP_MINIMUM_BREACH_ATR,
      Math.max(zone.width,Number.EPSILON)*0.01,
    ),
    liquiditySweepCount:sweeps.length,
    latestSweepTime:latestSweep?.time??null,
    latestSweepAgeBars:latestSweep?sweepApproach.length-latestSweep.index:null,
    latestSweepDepthAtr:latestSweep?.depthAtr??null,
    recoveryDisplacementAtr,
    latestRecoveryTime:latestRecoveryCandle?.time??null,
    approachEvidenceTime:compression.at(-1)?.time??null,
    directionalStepCount,
    directionalStepFraction,
    directionalCloseFraction,
    approachProgressZoneWidths,
    approachCompressionScore,
    approachClassification,
    approachRangeContractionRatio,
    approachBodyContractionRatio,
    approachAverageOverlapFraction,
    approachProgressEfficiency,
    approachMomentumVeto,
    fastApproachCandleTimes:fastApproachCandles.map((item)=>item.time),
    fastApproachCandleAtrMultiples:fastApproachCandles.map((item)=>item.bodyAtr),
    fastApproachCandleCount:fastApproachCandles.length,
    fastApproachBurstCount:fastApproachBursts.length,
    fastApproachMaximumBodyAtr,
    confirmationBodyFraction,
    confirmationCloseThroughZoneFraction,
    confirmationRejectionWickFraction,
    confirmationStrengthScore,
    weakConfirmation,
    adversePressureFlags,
    adversePressureScore:adversePressureFlags.length,
  };
};
