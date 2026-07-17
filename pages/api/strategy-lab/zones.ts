import type { NextApiRequest, NextApiResponse } from 'next';
import { forexPairs } from '../../../utils/constants';
import { annotateTimeframeConfluence, detectGoldilocksZoneHistory, detectGoldilocksZones, findCloseBeyondTouchedCandle, validateFinalEntryAfterEngulf, validateTwoToOneRunway, type SwingLeg } from '../../../utils/goldilocksStrategy';
import { fetchCandles } from '../../../utils/oanda/api/fetchCandles';
import { fetchCandleHistory } from '../../../utils/oanda/api/fetchCandleHistory';
import { determineSwingPoints } from '../../../utils/swingLabeler';
import { annotateConfluenceAt, buildGoldilocksHistoryChunked, getGoldilocksRangeAssessment, getGoldilocksTrend, toStrategyCandles } from '../../../utils/goldilocksScanner';
import { GOLDILOCKS_DEMO_TIMEFRAMES, GOLDILOCKS_LIVE_CANDLE_LIMITS, getGoldilocksMinimumScore } from '../../../utils/goldilocksConfig';
import { scoreGoldilocksSetup } from '../../../utils/goldilocksScoring';

const replayCache=new Map<string,{expiresAt:number;payload:unknown}>();

const isBullishPair = (left: string, right: string) =>
  ['LL','HL','L'].includes(left) && ['HH','LH','H'].includes(right);
const isBearishPair = (left: string, right: string) =>
  ['HH','LH','H'].includes(left) && ['LL','HL','L'].includes(right);

const zoneExpiresAt = (candleTime: number) => {
  const date=new Date(candleTime*1000);
  date.setUTCFullYear(date.getUTCFullYear()+2);
  return Math.floor(date.getTime()/1000);
};

const zoneWasUsableAt = (zone: ReturnType<typeof detectGoldilocksZoneHistory>['zones'][number], time: number) =>
  (zone.availableAt??zone.candleTime)<=time&&
  (!zone.invalidatedAt||zone.invalidatedAt>time)&&
  time<=zoneExpiresAt(zone.candleTime);

const firstCandleAfter = (candles: Array<{time:number}>, time: number) => {
  let low=0;
  let high=candles.length;
  while(low<high){
    const middle=(low+high)>>>1;
    if(candles[middle].time<=time)low=middle+1;
    else high=middle;
  }
  return low;
};

const buildZoneHistory = (candles: Awaited<ReturnType<typeof fetchCandles>>) => {
  const swings=determineSwingPoints(candles);
  const legs:SwingLeg[]=[];
  for(let index=0;index<swings.length-1;index+=1){
    const left=swings[index];const right=swings[index+1];
    const direction=isBullishPair(left.swing,right.swing)?'bullish':isBearishPair(left.swing,right.swing)?'bearish':null;
    if(!direction)continue;
    const startIndex=candles.findIndex(candle=>candle.time===left.time);
    const endIndex=candles.findIndex(candle=>candle.time===right.time);
    if(startIndex>=0&&endIndex>startIndex)legs.push({direction,startIndex,endIndex,startSwing:left.swing,endSwing:right.swing,brokeOppositeLegIn:(left.swing==='LL'&&right.swing==='HH')||(left.swing==='HH'&&right.swing==='LL')});
  }
  const strategyCandles=candles.map(candle=>({
    time:Math.floor(new Date(candle.time).getTime()/1000),open:candle.open,high:candle.high,low:candle.low,close:candle.close,
  }));
  return detectGoldilocksZoneHistory(strategyCandles,legs);
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const pair = String(req.query.pair ?? 'EUR/USD').toUpperCase();
  if (!forexPairs.includes(pair)) return res.status(400).json({ error: 'Unsupported pair' });
  const timeframe = String(req.query.timeframe ?? 'M15').toUpperCase();
  const requestedTradeTime = Number(req.query.tradeTime);
  const supportedTimeframes = ['M5', 'M15', 'M30', 'H1', 'H4'];
  if (!supportedTimeframes.includes(timeframe)) {
    return res.status(400).json({ error: 'Unsupported timeframe' });
  }
  const replayCacheKey=Number.isFinite(requestedTradeTime)?`${pair}:${timeframe}:${requestedTradeTime}`:'';
  const cachedReplay=replayCacheKey?replayCache.get(replayCacheKey):undefined;
  if(cachedReplay&&cachedReplay.expiresAt>Date.now()){
    res.setHeader('Cache-Control','private, max-age=60');
    return res.status(200).json(cachedReplay.payload);
  }

  try {
    const candles = await fetchCandles(pair, timeframe, 3000, undefined, undefined, 'demo');
    if (candles.length < 20) return res.status(422).json({ error: 'Not enough M15 candles' });
    const swings = determineSwingPoints(candles);
    const historicalLegs:SwingLeg[]=[];
    for(let index=0;index<swings.length-1;index+=1){
      const left=swings[index];const right=swings[index+1];
      const direction=isBullishPair(left.swing,right.swing)?'bullish':isBearishPair(left.swing,right.swing)?'bearish':null;
      if(!direction)continue;
      const startIndex=candles.findIndex(candle=>candle.time===left.time);
      const endIndex=candles.findIndex(candle=>candle.time===right.time);
      if(startIndex>=0&&endIndex>startIndex)historicalLegs.push({direction,startIndex,endIndex,startSwing:left.swing,endSwing:right.swing,brokeOppositeLegIn:(left.swing==='LL'&&right.swing==='HH')||(left.swing==='HH'&&right.swing==='LL')});
    }
    let leg: SwingLeg | null = null;
    let swingA = null;
    let swingB = null;

    for (let index = swings.length - 2; index >= 0; index -= 1) {
      const left = swings[index];
      const right = swings[index + 1];
      const direction = isBullishPair(left.swing, right.swing)
        ? 'bullish'
        : isBearishPair(left.swing, right.swing)
          ? 'bearish'
          : null;
      if (!direction) continue;
      const startIndex = candles.findIndex((candle) => candle.time === left.time);
      const endIndex = candles.findIndex((candle) => candle.time === right.time);
      if (startIndex < 0 || endIndex <= startIndex) continue;
      leg = { direction, startIndex, endIndex, startSwing:left.swing, endSwing:right.swing, brokeOppositeLegIn:(left.swing==='LL'&&right.swing==='HH')||(left.swing==='HH'&&right.swing==='LL') };
      swingA = left;
      swingB = right;
      break;
    }

    if (!leg) return res.status(422).json({ error: 'No completed M15 swing leg was found' });
    const strategyCandles = candles.map((candle) => ({
      time: Math.floor(new Date(candle.time).getTime() / 1000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    const detection = detectGoldilocksZones(strategyCandles, leg);
    const zoneHistory=detectGoldilocksZoneHistory(strategyCandles,historicalLegs);
    const deepZoneRaw=timeframe===GOLDILOCKS_DEMO_TIMEFRAMES.zone
      ?await fetchCandleHistory(pair,GOLDILOCKS_DEMO_TIMEFRAMES.zone,{lookbackDays:730,mode:'demo',backfillPages:0,maxCandles:GOLDILOCKS_LIVE_CANDLE_LIMITS[GOLDILOCKS_DEMO_TIMEFRAMES.zone]})
      :candles;
    const deepZoneHistory=timeframe===GOLDILOCKS_DEMO_TIMEFRAMES.zone
      ?buildGoldilocksHistoryChunked(deepZoneRaw,1_000,200)
      :zoneHistory;
    const currentPrice=strategyCandles[strategyCandles.length-1].close;
    const nearestDemand=zoneHistory.activeZones
      .filter(zone=>zone.side==='demand'&&zone.low<=currentPrice)
      .sort((a,b)=>Math.max(0,currentPrice-a.high)-Math.max(0,currentPrice-b.high))[0];
    const nearestSupply=zoneHistory.activeZones
      .filter(zone=>zone.side==='supply'&&zone.high>=currentPrice)
      .sort((a,b)=>Math.max(0,a.low-currentPrice)-Math.max(0,b.low-currentPrice))[0];
    const nearestZones=[nearestDemand,nearestSupply].filter((zone):zone is NonNullable<typeof zone>=>Boolean(zone));
    const detectedRecentBase=detection.zones.find(zone=>zone.kind==='base');
    const recentSwingBase=detectedRecentBase?zoneHistory.activeZones.find(zone=>
      zone.kind==='base'&&
      zone.side===detectedRecentBase.side&&
      zone.candleTime===detectedRecentBase.candleTime
    ):undefined;
    const recentDemandBase=zoneHistory.activeZones
      .filter(zone=>zone.kind==='base'&&zone.side==='demand')
      .sort((a,b)=>b.candleTime-a.candleTime)[0];
    const recentSupplyBase=zoneHistory.activeZones
      .filter(zone=>zone.kind==='base'&&zone.side==='supply')
      .sort((a,b)=>b.candleTime-a.candleTime)[0];
    const displayZones=[...nearestZones,...(recentSwingBase?[recentSwingBase]:[]),...(recentDemandBase?[recentDemandBase]:[]),...(recentSupplyBase?[recentSupplyBase]:[])]
      .filter((zone,index,items)=>items.findIndex(item=>item.id===zone.id)===index);
    const scoringTimeframes:string[]=[...GOLDILOCKS_DEMO_TIMEFRAMES.confluence];
    const otherTimeframeHistories=await Promise.all(scoringTimeframes
      .filter(item=>item!==timeframe)
      .map(async item=>{const timeframeCandles=await fetchCandleHistory(pair,item,{lookbackDays:item===GOLDILOCKS_DEMO_TIMEFRAMES.confirmation?90:730,mode:'demo',backfillPages:0,maxCandles:GOLDILOCKS_LIVE_CANDLE_LIMITS[item]});return {timeframe:item,candles:timeframeCandles,history:buildGoldilocksHistoryChunked(timeframeCandles,1_000,200)}}));
    const confluenceSources=[
      ...(scoringTimeframes.includes(timeframe)?[{timeframe,candles:deepZoneRaw,history:deepZoneHistory}]:[]),
      ...otherTimeframeHistories,
    ];
    const displayZonesWithConfluence=annotateTimeframeConfluence(
      displayZones,
      timeframe,
      confluenceSources
        .filter(group=>group.timeframe!==timeframe)
        .map(group=>({timeframe:group.timeframe,zones:group.history.activeZones})),
    );
    const deepConfirmationRaw=timeframe===GOLDILOCKS_DEMO_TIMEFRAMES.zone
      ?otherTimeframeHistories.find(source=>source.timeframe===GOLDILOCKS_DEMO_TIMEFRAMES.confirmation)?.candles??[]
      :candles;
    const historicalCandles=timeframe===GOLDILOCKS_DEMO_TIMEFRAMES.zone
      ?toStrategyCandles(deepConfirmationRaw).filter(candle=>candle.time>=Math.floor(new Date(deepZoneRaw[0]?.time??candles[0].time).getTime()/1000))
      :strategyCandles;
    const historicalConfluenceSources=confluenceSources;
    const currentTrend=getGoldilocksTrend(
      historicalConfluenceSources.find(source=>source.timeframe===GOLDILOCKS_DEMO_TIMEFRAMES.trend)?.candles??[],
      strategyCandles.at(-1)?.time,
    );
    const historicalEntrySetups=deepZoneHistory.zones.flatMap(zone=>{
      let countingStarted=false;
      let touchCandleIndex=-1;
      let priorTouches=0;
      let touchesBeforeTrigger=0;
      let maxPenetrationBeforeTrigger=0;
      let purityTouchesAtTrigger=0;
      let purityPenetrationAtTrigger=0;
      const completedSetups:Array<Record<string,unknown>>=[];
      for(let index=firstCandleAfter(historicalCandles,zone.availableAt??zone.candleTime);index<historicalCandles.length;index+=1){
        const candle=historicalCandles[index];
        if(candle.time>zoneExpiresAt(zone.candleTime))break;
        if(zone.invalidatedAt&&candle.time>=zone.invalidatedAt)break;
        const broken=zone.side==='demand'?candle.low<zone.low:candle.high>zone.high;
        if(broken)break;
        const outside=zone.side==='demand'?candle.low>zone.high:candle.high<zone.low;
        const touched=candle.high>=zone.low&&candle.low<=zone.high;
        if(touchCandleIndex<0){
          if(outside)countingStarted=true;
          if(touched&&countingStarted){
            touchesBeforeTrigger=priorTouches;
            const penetration=zone.side==='demand'?(zone.high-candle.low)/zone.width:(candle.high-zone.low)/zone.width;
            purityPenetrationAtTrigger=Math.max(maxPenetrationBeforeTrigger,Math.max(0,penetration));
            priorTouches+=1;
            purityTouchesAtTrigger=priorTouches;
            maxPenetrationBeforeTrigger=purityPenetrationAtTrigger;
            touchCandleIndex=index;
            countingStarted=false;
          }
          continue;
        }
        const touchedCandle=historicalCandles[touchCandleIndex];
        const confirmed=zone.side==='demand'
          ? candle.close>candle.open&&candle.close>touchedCandle.high
          : candle.close<candle.open&&candle.close<touchedCandle.low;
        if(!confirmed)continue;
        const knownAtConfirmation=deepZoneHistory.zones.filter(item=>zoneWasUsableAt(item,candle.time));
        const check=validateTwoToOneRunway(zone,knownAtConfirmation,candle.close);
        if(check.allowed){
          const confluenceZone=annotateConfluenceAt({...zone,touches:touchesBeforeTrigger},timeframe,candle.time,historicalConfluenceSources);
          const trendSource=historicalConfluenceSources.find(source=>source.timeframe===GOLDILOCKS_DEMO_TIMEFRAMES.trend)?.candles??[];
          const trend=getGoldilocksTrend(trendSource,candle.time);
          const score=scoreGoldilocksSetup({
            zone:confluenceZone,
            tradeDirection:zone.side==='demand'?'BUY':'SELL',
            trend,
            minimumScore:getGoldilocksMinimumScore(),
            purityTouches:touchesBeforeTrigger,
            purityMaxPenetration:maxPenetrationBeforeTrigger,
            availableRewardRisk:check.availableRatio,
            rangeAssessment:getGoldilocksRangeAssessment(trendSource,candle.time,check.entry,zone.side==='demand'?'BUY':'SELL'),
            gates:[
              {name:'Zone validity',passed:true,reason:'Zone was usable at confirmation time.'},
              {name:'Confirmation freshness',passed:true,reason:`Historical ${GOLDILOCKS_DEMO_TIMEFRAMES.confirmation} confirmation completed after its touch candle.`},
              {name:'2:1 runway',passed:true,reason:check.reason},
            ],
          });
          let outcomeIndex=-1;
          let outcome:'win'|'loss'|'open'='open';
          let exitReason:'target'|'stop'|'break_even'|'open'='open';
          let breakEvenActivated=false;
          const oneR=zone.side==='demand'?check.entry+(check.entry-check.stopLoss):check.entry-(check.stopLoss-check.entry);
          for(let futureIndex=index+1;futureIndex<historicalCandles.length;futureIndex+=1){
            const future=historicalCandles[futureIndex];
            const activeStop=breakEvenActivated?check.entry:check.stopLoss;
            const stopped=zone.side==='demand'?future.low<=activeStop:future.high>=activeStop;
            const targeted=zone.side==='demand'?future.high>=check.takeProfit:future.low<=check.takeProfit;
            if(stopped||targeted){
              outcomeIndex=futureIndex;
              outcome=stopped&&!breakEvenActivated?'loss':'win';
              exitReason=stopped?(breakEvenActivated?'break_even':'stop'):'target';
              break;
            }
            const reachedOneR=zone.side==='demand'?future.high>=oneR:future.low<=oneR;
            if(reachedOneR)breakEvenActivated=true;
          }
          const setup={
            zone:confluenceZone,
            confirmationTimeframe:timeframe===GOLDILOCKS_DEMO_TIMEFRAMES.zone?GOLDILOCKS_DEMO_TIMEFRAMES.confirmation:timeframe,
            confirmationTime:candle.time,
            confirmationCandle:candle,
            runway:check,
            trend,
            score,
            outcome,
            exitReason,
            breakEvenActivated,
            outcomeTime:outcomeIndex>=0?historicalCandles[outcomeIndex].time:undefined,
          };
          if(outcomeIndex<0)return [setup];
          completedSetups.push(setup);
          index=outcomeIndex;
        }
        touchCandleIndex=-1;
        const resumeCandle=historicalCandles[index];
        countingStarted=zone.side==='demand'?resumeCandle.low>zone.high:resumeCandle.high<zone.low;
      }
      return completedSetups;
    }) as Array<{zone:(typeof zoneHistory.activeZones)[number];confirmationTimeframe:string;confirmationTime:number;confirmationCandle:(typeof strategyCandles)[number];runway:ReturnType<typeof validateTwoToOneRunway>;trend:ReturnType<typeof getGoldilocksTrend>;score:ReturnType<typeof scoreGoldilocksSetup>;outcome:'win'|'loss'|'open';exitReason:'target'|'stop'|'break_even'|'open';breakEvenActivated:boolean;outcomeTime?:number}>;
    const openHistoricalSetups=historicalEntrySetups.filter(setup=>setup.outcome==='open').sort((a,b)=>a.confirmationTime-b.confirmationTime);
    const nearestRequestedSetup=Number.isFinite(requestedTradeTime)
      ? [...historicalEntrySetups].sort((a,b)=>Math.abs(a.confirmationTime-requestedTradeTime)-Math.abs(b.confirmationTime-requestedTradeTime))[0]??null
      : null;
    const requestedHistoricalEntrySetup=nearestRequestedSetup&&Math.abs(nearestRequestedSetup.confirmationTime-requestedTradeTime)<=60
      ?nearestRequestedSetup
      :null;
    const historicalEntrySetup=Number.isFinite(requestedTradeTime)
      ?requestedHistoricalEntrySetup
      :openHistoricalSetups[0]??historicalEntrySetups.sort((a,b)=>b.confirmationTime-a.confirmationTime)[0]??null;
    const runwayChecks = detection.zones.map((zone) => ({
      zoneId: zone.id,
      ...validateTwoToOneRunway(zone, zoneHistory.activeZones),
    }));
    const earliestActiveIndex=zoneHistory.activeZones.length?Math.min(...zoneHistory.activeZones.map(zone=>zone.candleIndex)):leg.startIndex;
    const viewEnd = candles.length - 1;
    const viewStart = Math.max(0,Math.min(leg.startIndex-200,earliestActiveIndex-20));
    const finalEntryChecks=detection.zones.map(zone=>{
      const storedZone=zoneHistory.zones.find(item=>item.kind===zone.kind&&item.side===zone.side&&item.candleTime===zone.candleTime)??zone;
      if(storedZone.firstTouchIndex===undefined){
        return {zoneId:zone.id,confirmed:false,reason:'The zone has not been touched after price left it.'};
      }
      const confirmation=findCloseBeyondTouchedCandle(
        strategyCandles,
        storedZone.side==='demand'?'bullish':'bearish',
        storedZone.firstTouchIndex,
      );
      if(!confirmation.confirmed||confirmation.candleIndex===undefined){
        return {zoneId:zone.id,confirmed:false,reason:confirmation.reason};
      }
      const engulfClose=strategyCandles[confirmation.candleIndex].close;
      return {
        zoneId:zone.id,confirmed:true,confirmationCandleIndex:confirmation.candleIndex-viewStart,
        ...validateFinalEntryAfterEngulf(storedZone,zoneHistory.activeZones,engulfClose,currentPrice),
      };
    });
    const visibleCandles = candles.slice(viewStart, viewEnd + 1).map((candle) => ({
      time: Math.floor(new Date(candle.time).getTime() / 1000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    const visibleLeg = {
      ...leg,
      startIndex: leg.startIndex - viewStart,
      endIndex: leg.endIndex - viewStart,
    };
    const visibleSwings = swings
      .filter((swing) => ['HH', 'HL', 'LH', 'LL'].includes(swing.swing))
      .filter((swing) => swing.candleIndex >= viewStart && swing.candleIndex <= viewEnd)
      .map((swing) => ({
        swing: swing.swing,
        price: swing.price,
        candleIndex: swing.candleIndex - viewStart,
        time: Math.floor(new Date(swing.time!).getTime() / 1000),
      }));

    res.setHeader('Cache-Control', 'no-store');
    const payload={
      pair,
      timeframe,
      currentTrend,
      fetchedAt: new Date().toISOString(),
      candles: visibleCandles,
      leg: visibleLeg,
      swingA,
      swingB,
      swings: visibleSwings,
      runwayChecks,
      finalEntryChecks,
      historicalEntrySetup,
      requestedTradeTime:Number.isFinite(requestedTradeTime)?requestedTradeTime:null,
      historicalMatchDeltaSeconds:requestedHistoricalEntrySetup?Math.abs(requestedHistoricalEntrySetup.confirmationTime-requestedTradeTime):null,
      historicalEntrySetups,
      backtestCoverage:{
        from:historicalCandles[0]?.time??null,
        to:historicalCandles.at(-1)?.time??null,
        candles:historicalCandles.length,
        trendTimeframe:GOLDILOCKS_DEMO_TIMEFRAMES.trend,
        zoneTimeframe:GOLDILOCKS_DEMO_TIMEFRAMES.zone,
        confirmationTimeframe:GOLDILOCKS_DEMO_TIMEFRAMES.confirmation,
      },
      zoneHistory:{
        zones:zoneHistory.zones.map(zone=>({...zone,candleIndex:zone.candleIndex-viewStart})),
        activeZones:zoneHistory.activeZones.map(zone=>({...zone,candleIndex:zone.candleIndex-viewStart})),
        activeDemand:zoneHistory.activeDemand?{...zoneHistory.activeDemand,candleIndex:zoneHistory.activeDemand.candleIndex-viewStart}:null,
        activeSupply:zoneHistory.activeSupply?{...zoneHistory.activeSupply,candleIndex:zoneHistory.activeSupply.candleIndex-viewStart}:null,
        nearestZones:nearestZones.map(zone=>({...zone,candleIndex:zone.candleIndex-viewStart})),
        displayZones:displayZonesWithConfluence.map(zone=>({...zone,candleIndex:zone.candleIndex-viewStart})),
        recentSwingBase:recentSwingBase?{...recentSwingBase,candleIndex:recentSwingBase.candleIndex-viewStart}:null,
        recentDemandBase:recentDemandBase?{...recentDemandBase,candleIndex:recentDemandBase.candleIndex-viewStart}:null,
        recentSupplyBase:recentSupplyBase?{...recentSupplyBase,candleIndex:recentSupplyBase.candleIndex-viewStart}:null,
        currentPrice,
      },
      detection: {
        ...detection,
        leg: visibleLeg,
        zones: detection.zones.map((zone) => ({
          ...zone,
          candleIndex: zone.candleIndex - viewStart,
          candleTime: zone.candleTime,
          invalidatedAt: zone.invalidatedAt,
          reasons: zone.reasons,
        })),
        rejected: detection.rejected.map((item) => ({
          ...item,
          candleIndex: item.candleIndex - viewStart,
        })),
      },
    };
    if(replayCacheKey){
      if(replayCache.size>=30)replayCache.delete(replayCache.keys().next().value!);
      replayCache.set(replayCacheKey,{expiresAt:Date.now()+5*60_000,payload});
    }
    return res.status(200).json(payload);
  } catch (error) {
    console.error('[strategy-lab/zones]', error);
    return res.status(500).json({ error: (error as Error).message });
  }
}
