import type { NextApiRequest, NextApiResponse } from 'next';
import { forexPairs } from '../../../utils/constants';
import { annotateTimeframeConfluence, createHistoricalZoneTouchState, detectGoldilocksZoneHistory, detectGoldilocksZones, findCloseBeyondTouchedCandle, measureGoldilocksIntrabarDepartureSpeed, summarizeZoneTimeframeTouches, validateFinalEntryAfterEngulf, validateGoldilocksDepartureQuality, validateGoldilocksEntryProximity, validateGoldilocksFirstTouchCandle, validateTwoToOneRunway, type GoldilocksEntryProximityCheck, type SwingLeg } from '../../../utils/goldilocksStrategy';
import { fetchCandles } from '../../../utils/oanda/api/fetchCandles';
import { fetchCandleHistory } from '../../../utils/oanda/api/fetchCandleHistory';
import { determineSwingPoints } from '../../../utils/swingLabeler';
import { annotateConfluenceAt, buildGoldilocksHistoryChunked, buildGoldilocksLegs, getGoldilocksRangeAssessment, getGoldilocksTrend, toStrategyCandles } from '../../../utils/goldilocksScanner';
import { GOLDILOCKS_DEMO_TIMEFRAMES, GOLDILOCKS_LIVE_CANDLE_LIMITS, GOLDILOCKS_STRATEGY_VERSION, GOLDILOCKS_TIMEFRAME_SECONDS, getGoldilocksMinimumScore } from '../../../utils/goldilocksConfig';
import { scoreGoldilocksSetup } from '../../../utils/goldilocksScoring';
import { getBacktestTradeReplay } from '../../../utils/backtestStore';
import { filterReplayRejectedFirstTouchesAt, getStrategyReplayBaseContextStart, getStrategyReplayContextAnchor, getStrategyReplayRequestEnd, getStrategyReplayWindow } from '../../../utils/strategyReplay';
import { getForexHolidayStatusAt, isForexWeekendEntryBlocked } from '../../../utils/forexMarketHours';
import { getGoldilocksZoneAgeSeconds } from '../../../utils/zoneAge';

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
  const timeframe = String(req.query.timeframe ?? GOLDILOCKS_DEMO_TIMEFRAMES.confirmation).toUpperCase();
  const requestedTradeTime = Number(req.query.tradeTime);
  const requestedExitTime = Number(req.query.exitTime);
  const requestedTradeId=typeof req.query.tradeId==='string'?req.query.tradeId:undefined;
  const storedReplayForRequest=Number.isFinite(requestedTradeTime)?getBacktestTradeReplay(pair,requestedTradeTime,requestedTradeId):undefined;
  const storedZoneCandleTime=Number(storedReplayForRequest?.zoneId.match(/(\d+)$/)?.[1]);
  const supportedTimeframes = ['M5', 'M15', 'M30', 'H1', 'H4'];
  if (!supportedTimeframes.includes(timeframe)) {
    return res.status(400).json({ error: 'Unsupported timeframe' });
  }
  const replayCacheKey=Number.isFinite(requestedTradeTime)?`all-zone-base-context-v3:${pair}:${timeframe}:${requestedTradeTime}:${requestedTradeId??'latest'}:${Number.isFinite(requestedExitTime)?requestedExitTime:'stored'}`:'';
  const cachedReplay=replayCacheKey?replayCache.get(replayCacheKey):undefined;
  if(cachedReplay&&cachedReplay.expiresAt>Date.now()){
    res.setHeader('Cache-Control','private, max-age=60');
    return res.status(200).json(cachedReplay.payload);
  }

  try {
    const replayWindow=storedReplayForRequest?getStrategyReplayWindow(
      storedReplayForRequest.confirmationTime,
      Number.isFinite(requestedExitTime)?requestedExitTime:storedReplayForRequest.outcomeTime,
      Number.isFinite(storedZoneCandleTime)?storedZoneCandleTime:undefined,
    ):undefined;
    const replayWindowStart=replayWindow?.chartStart;
    const replayWindowEnd=replayWindow?getStrategyReplayRequestEnd(replayWindow.chartEnd):undefined;
    const replayConfirmationEnd=replayWindow?getStrategyReplayRequestEnd(replayWindow.confirmationEnd):undefined;
    const candles = await fetchCandles(
      pair,timeframe,3000,
      replayWindowStart?new Date(replayWindowStart*1000).toISOString():undefined,
      replayWindowEnd?new Date(replayWindowEnd*1000).toISOString():undefined,
      'demo',
    );
    if (candles.length < 20) return res.status(422).json({ error: `Not enough ${timeframe} candles` });
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

    if (!leg) return res.status(422).json({ error: `No completed ${timeframe} swing leg was found` });
    const strategyCandles = candles.map((candle) => ({
      time: Math.floor(new Date(candle.time).getTime() / 1000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    // Always build the authoritative M15 zones from the same depth/source. Reusing
    // the display candles on M15 produced different zone IDs than M5/H1 views.
    const deepZoneRaw=await fetchCandleHistory(pair,GOLDILOCKS_DEMO_TIMEFRAMES.zone,{lookbackDays:730,mode:'demo',backfillPages:0,maxCandles:storedReplayForRequest?undefined:GOLDILOCKS_LIVE_CANDLE_LIMITS[GOLDILOCKS_DEMO_TIMEFRAMES.zone]});
    const deepZoneHistory=buildGoldilocksHistoryChunked(deepZoneRaw,1_000,200,{trackTouches:false});
    const deepZoneStrategy=toStrategyCandles(deepZoneRaw);
    const deepZoneLegs=buildGoldilocksLegs(deepZoneRaw);
    const latestZoneLeg=deepZoneLegs.at(-1);
    const detection=latestZoneLeg
      ?detectGoldilocksZones(deepZoneStrategy,latestZoneLeg)
      :detectGoldilocksZones(strategyCandles,leg);
    const zoneHistory=deepZoneHistory;
    const replayDisplayTime=Number.isFinite(requestedTradeTime)
      ?storedReplayForRequest?.confirmationTime??requestedTradeTime
      :undefined;
    const replayDisplayCandle=replayDisplayTime===undefined
      ?undefined
      :[...strategyCandles].reverse().find(candle=>candle.time<=replayDisplayTime);
    const currentPrice=storedReplayForRequest?.entry??replayDisplayCandle?.close??strategyCandles[strategyCandles.length-1].close;
    // A historical replay must never draw a zone from the final state of the
    // downloaded history. Select only zones that were known and usable when the
    // stored M5 confirmation completed; otherwise future bases appear as ghosts.
    const displayZonePool=replayDisplayTime===undefined
      ?zoneHistory.activeZones
      :zoneHistory.zones.filter(zone=>zoneWasUsableAt(zone,replayDisplayTime));
    const nearestDemand=displayZonePool
      .filter(zone=>zone.side==='demand'&&zone.low<=currentPrice)
      .sort((a,b)=>Math.max(0,currentPrice-a.high)-Math.max(0,currentPrice-b.high))[0];
    const nearestSupply=displayZonePool
      .filter(zone=>zone.side==='supply'&&zone.high>=currentPrice)
      .sort((a,b)=>Math.max(0,a.low-currentPrice)-Math.max(0,b.low-currentPrice))[0];
    const nearestZones=[nearestDemand,nearestSupply].filter((zone):zone is NonNullable<typeof zone>=>Boolean(zone));
    const detectedRecentBase=detection.zones.find(zone=>zone.kind==='base');
    const recentSwingBase=replayDisplayTime===undefined&&detectedRecentBase?displayZonePool.find(zone=>
      zone.kind==='base'&&
      zone.side===detectedRecentBase.side&&
      zone.candleTime===detectedRecentBase.candleTime
    ):undefined;
    const recentDemandBase=displayZonePool
      .filter(zone=>zone.kind==='base'&&zone.side==='demand')
      .sort((a,b)=>b.candleTime-a.candleTime)[0];
    const recentSupplyBase=displayZonePool
      .filter(zone=>zone.kind==='base'&&zone.side==='supply')
      .sort((a,b)=>b.candleTime-a.candleTime)[0];
    const displayZones=[...nearestZones,...(recentSwingBase?[recentSwingBase]:[]),...(recentDemandBase?[recentDemandBase]:[]),...(recentSupplyBase?[recentSupplyBase]:[])]
      .filter((zone,index,items)=>items.findIndex(item=>item.id===zone.id)===index);
    const scoringTimeframes:string[]=[...GOLDILOCKS_DEMO_TIMEFRAMES.confluence];
    const otherTimeframeHistories=await Promise.all(scoringTimeframes
      .filter(item=>item!==GOLDILOCKS_DEMO_TIMEFRAMES.zone)
      .map(async item=>{
        const timeframeCandles=storedReplayForRequest
          ?await fetchCandles(
              pair,item,5_000,
              new Date(replayWindowStart!*1000).toISOString(),
              new Date((item===GOLDILOCKS_DEMO_TIMEFRAMES.confirmation?replayConfirmationEnd!:replayWindowEnd!)*1000).toISOString(),
              'demo',
            )
          :await fetchCandleHistory(pair,item,{lookbackDays:item===GOLDILOCKS_DEMO_TIMEFRAMES.confirmation?90:730,mode:'demo',backfillPages:0,maxCandles:GOLDILOCKS_LIVE_CANDLE_LIMITS[item]});
        return {timeframe:item,candles:timeframeCandles,history:buildGoldilocksHistoryChunked(timeframeCandles,1_000,200)};
      }));
    const confluenceSources=[
      {timeframe:GOLDILOCKS_DEMO_TIMEFRAMES.zone,candles:deepZoneRaw,history:deepZoneHistory},
      ...otherTimeframeHistories,
    ];
    const annotatedDisplayZones=replayDisplayTime===undefined
      ?annotateTimeframeConfluence(
          displayZones,
          GOLDILOCKS_DEMO_TIMEFRAMES.zone,
          confluenceSources
            .filter(group=>group.timeframe!==GOLDILOCKS_DEMO_TIMEFRAMES.zone)
            .map(group=>({timeframe:group.timeframe,zones:group.history.activeZones})),
        )
      :displayZones.map(zone=>annotateConfluenceAt(
          zone,
          GOLDILOCKS_DEMO_TIMEFRAMES.zone,
          replayDisplayTime,
        confluenceSources,
      ));
    // The stored backtest score is authoritative for the selected trade zone's
    // entry-time ZIZ count. A bounded chart replay may not contain the much older
    // M5/H1 source zones even though they were present in the full backtest history.
    const displayZonesWithConfluence=annotatedDisplayZones.map(zone=>{
      const storedCount=zone.id===storedReplayForRequest?.zoneId?storedReplayForRequest.confluenceCount:undefined;
      const currentCount=zone.timeframeConfluence?.timeframeCount??1;
      if(!storedCount||storedCount<=currentCount)return zone;
      return {
        ...zone,
        timeframeConfluence:{
          timeframes:storedCount===scoringTimeframes.length?[...scoringTimeframes]:zone.timeframeConfluence?.timeframes??[GOLDILOCKS_DEMO_TIMEFRAMES.zone],
          timeframeCount:storedCount,
          overlaps:zone.timeframeConfluence?.overlaps??[],
        },
      };
    });
    const deepConfirmationRaw=timeframe===GOLDILOCKS_DEMO_TIMEFRAMES.confirmation
      ?candles
      :otherTimeframeHistories.find(source=>source.timeframe===GOLDILOCKS_DEMO_TIMEFRAMES.confirmation)?.candles??[];
    const historicalCandles=toStrategyCandles(deepConfirmationRaw)
      .filter(candle=>candle.time>=Math.floor(new Date(deepZoneRaw[0]?.time??candles[0].time).getTime()/1000));
    const zoneTouchCandles=toStrategyCandles(deepZoneRaw);
    const historicalConfluenceSources=confluenceSources;
    const currentTrend=getGoldilocksTrend(
      historicalConfluenceSources.find(source=>source.timeframe===GOLDILOCKS_DEMO_TIMEFRAMES.trend)?.candles??[],
      strategyCandles.at(-1)?.time,
    );
    const rejectedFirstTouches:Array<{
      zoneId:string;
      zoneSide:'demand'|'supply';
      time:number;
      candle:(typeof historicalCandles)[number];
      touchRangeZoneFraction:number;
      maxTouchRangeZoneFraction:number;
      reason:string;
    }>=[];
    const historicalEntrySetups=deepZoneHistory.zones.flatMap(zone=>{
      const departureQuality=validateGoldilocksDepartureQuality(zone);
      if(!departureQuality.allowed)return [];
      const touchState=createHistoricalZoneTouchState();
      const completedSetups:Array<Record<string,unknown>>=[];
      for(let index=firstCandleAfter(historicalCandles,zone.availableAt??zone.candleTime);index<historicalCandles.length;index+=1){
        const candle=historicalCandles[index];
        if(candle.time>zoneExpiresAt(zone.candleTime))break;
        if(zone.invalidatedAt&&candle.time>=zone.invalidatedAt)break;
        const broken=zone.side==='demand'?candle.low<zone.low:candle.high>zone.high;
        if(broken)break;
        const touchedCandle=touchState.touchCandleIndex>=0?historicalCandles[touchState.touchCandleIndex]:undefined;
        const confirmed=touchedCandle!==undefined&&(zone.side==='demand'
          ?candle.close>candle.open&&candle.close>touchedCandle.high
          :candle.close<candle.open&&candle.close<touchedCandle.low);
        if(!confirmed){
          if(touchState.touchCandleIndex<0){
            const armed=summarizeZoneTimeframeTouches(zone,zoneTouchCandles,900,candle.time);
            if(armed.invalidated)break;
            if(armed.firstOutsideTime!==undefined&&candle.time>=armed.firstOutsideTime&&candle.high>=zone.low&&candle.low<=zone.high){
              const firstTouch=validateGoldilocksFirstTouchCandle(zone,candle);
              if(!firstTouch.allowed){
                rejectedFirstTouches.push({
                  zoneId:zone.id,
                  zoneSide:zone.side,
                  time:candle.time,
                  candle,
                  touchRangeZoneFraction:firstTouch.touchRangeZoneFraction,
                  maxTouchRangeZoneFraction:firstTouch.maxTouchRangeZoneFraction,
                  reason:firstTouch.reason,
                });
                break;
              }
              touchState.touchCandleIndex=index;
            }
          }
          continue;
        }
        const purity=summarizeZoneTimeframeTouches(zone,zoneTouchCandles,900,touchedCandle.time);
        if(purity.invalidated)break;
        const proximity=validateGoldilocksEntryProximity(zone,touchedCandle,candle.close);
        if(!proximity.allowed)break;
        const knownAtConfirmation=deepZoneHistory.zones.filter(item=>zoneWasUsableAt(item,candle.time));
        const check=validateTwoToOneRunway(zone,knownAtConfirmation,candle.close,{knownZonesUsableAtEntry:true});
        if(check.allowed){
          const confluenceZone=annotateConfluenceAt({...zone,touches:purity.touches,maxPenetration:purity.maxPenetration,departureInsideCandleCount:purity.departureInsideCandleCount},GOLDILOCKS_DEMO_TIMEFRAMES.zone,candle.time,historicalConfluenceSources);
          const trendSource=historicalConfluenceSources.find(source=>source.timeframe===GOLDILOCKS_DEMO_TIMEFRAMES.trend)?.candles??[];
          const trend=getGoldilocksTrend(trendSource,candle.time);
          const score=scoreGoldilocksSetup({
            zone:confluenceZone,
            tradeDirection:zone.side==='demand'?'BUY':'SELL',
            trend,
            minimumScore:getGoldilocksMinimumScore(),
            purityTouches:purity.touches,
            purityMaxPenetration:purity.maxPenetration,
            availableRewardRisk:check.availableRatio,
            rangeAssessment:getGoldilocksRangeAssessment(trendSource,candle.time,check.entry,zone.side==='demand'?'BUY':'SELL'),
            gates:[
              {name:'Zone validity',passed:true,reason:'Zone was usable at confirmation time.'},
              {name:'Confirmation freshness',passed:true,reason:`Historical ${GOLDILOCKS_DEMO_TIMEFRAMES.confirmation} confirmation completed after its touch candle.`},
              {name:'Entry proximity',passed:true,reason:proximity.reason},
              {name:'Departure quality',passed:true,reason:departureQuality.reason},
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
            zoneAgeSeconds:getGoldilocksZoneAgeSeconds(zone.candleTime,candle.time+(GOLDILOCKS_TIMEFRAME_SECONDS[GOLDILOCKS_DEMO_TIMEFRAMES.confirmation]??300)),
            firstOutsideTime:purity.firstOutsideTime,
            priorTouchDetails:purity.touchDetails,
            confirmationTimeframe:GOLDILOCKS_DEMO_TIMEFRAMES.confirmation,
            confirmationTime:candle.time,
            confirmationCandle:candle,
            touchCandle:touchedCandle,
            proximity,
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
        touchState.touchCandleIndex=-1;
      }
      return completedSetups;
    }) as Array<{zone:(typeof zoneHistory.activeZones)[number];firstOutsideTime?:number;priorTouchDetails:Array<{time:number;penetration:number;price:number}>;confirmationTimeframe:string;confirmationTime:number;confirmationCandle:(typeof strategyCandles)[number];touchCandle:(typeof strategyCandles)[number];proximity:GoldilocksEntryProximityCheck;runway:ReturnType<typeof validateTwoToOneRunway>;trend:ReturnType<typeof getGoldilocksTrend>;score:ReturnType<typeof scoreGoldilocksSetup>;outcome:'win'|'loss'|'open';exitReason:'target'|'stop'|'break_even'|'open';breakEvenActivated:boolean;outcomeTime?:number}>;
    const openHistoricalSetups=historicalEntrySetups.filter(setup=>setup.outcome==='open').sort((a,b)=>a.confirmationTime-b.confirmationTime);
    const nearestRequestedSetup=Number.isFinite(requestedTradeTime)
      ? [...historicalEntrySetups].sort((a,b)=>Math.abs(a.confirmationTime-requestedTradeTime)-Math.abs(b.confirmationTime-requestedTradeTime))[0]??null
      : null;
    const requestedHistoricalEntrySetup=nearestRequestedSetup&&Math.abs(nearestRequestedSetup.confirmationTime-requestedTradeTime)<=60
      ?nearestRequestedSetup
      :null;
    const currentStrategyReplay=storedReplayForRequest?.strategyVersion===GOLDILOCKS_STRATEGY_VERSION;
    const compatibleTimeframeReplay=Boolean(storedReplayForRequest?.strategyVersion?.startsWith('h1-m15-m5-v'));
    const storedZoneForReplay=compatibleTimeframeReplay?deepZoneHistory.zones.find(zone=>
      zone.id===storedReplayForRequest!.zoneId||(
        zone.kind===storedReplayForRequest!.zoneKind&&
        zone.side===(storedReplayForRequest!.direction==='BUY'?'demand':'supply')&&
        zone.candleTime===storedZoneCandleTime&&
        Math.abs((zone.side==='demand'?zone.low:zone.high)-storedReplayForRequest!.stopLoss)<1e-9
      )
    ):undefined;
    const storedConfirmationIndex=compatibleTimeframeReplay?historicalCandles.findIndex(candle=>candle.time===storedReplayForRequest!.confirmationTime):-1;
    const storedTouchState=createHistoricalZoneTouchState();
    if(storedZoneForReplay&&storedConfirmationIndex>0){
      for(let index=firstCandleAfter(historicalCandles,storedZoneForReplay.availableAt??storedZoneForReplay.candleTime);index<storedConfirmationIndex;index+=1){
        const candle=historicalCandles[index];
        if(storedZoneForReplay.invalidatedAt&&candle.time>=storedZoneForReplay.invalidatedAt)break;
        const broken=storedZoneForReplay.side==='demand'?candle.low<storedZoneForReplay.low:candle.high>storedZoneForReplay.high;
        if(broken)break;
        if(storedTouchState.touchCandleIndex<0){
          const armed=summarizeZoneTimeframeTouches(storedZoneForReplay,zoneTouchCandles,900,candle.time);
          if(armed.firstOutsideTime!==undefined&&candle.time>=armed.firstOutsideTime&&candle.high>=storedZoneForReplay.low&&candle.low<=storedZoneForReplay.high)storedTouchState.touchCandleIndex=index;
        }
      }
    }
    const storedTouchCandle=storedTouchState.touchCandleIndex>=0?historicalCandles[storedTouchState.touchCandleIndex]:undefined;
    const storedConfirmationCandle=storedConfirmationIndex>=0?historicalCandles[storedConfirmationIndex]:undefined;
    const storedPurity=storedZoneForReplay&&storedTouchCandle
      ?summarizeZoneTimeframeTouches(storedZoneForReplay,zoneTouchCandles,900,storedTouchCandle.time)
      :undefined;
    const storedProximity=storedZoneForReplay&&storedTouchCandle&&storedConfirmationCandle
      ?validateGoldilocksEntryProximity(storedZoneForReplay,storedTouchCandle,storedConfirmationCandle.close,storedReplayForRequest?.entry)
      :undefined;
    const storedRisk=storedReplayForRequest?Math.abs(storedReplayForRequest.entry-storedReplayForRequest.stopLoss):0;
    const storedReward=storedReplayForRequest?Math.abs(storedReplayForRequest.takeProfit-storedReplayForRequest.entry):0;
    const storedExitPrice=storedReplayForRequest?.exitReason==='weekend_close'
      ?storedReplayForRequest.direction==='BUY'
        ?storedReplayForRequest.entry+storedReplayForRequest.realizedR*storedRisk
        :storedReplayForRequest.entry-storedReplayForRequest.realizedR*storedRisk
      :undefined;
    const storedEntrySetup=storedReplayForRequest&&storedZoneForReplay&&storedTouchCandle&&storedConfirmationCandle&&storedProximity?.allowed?{
      tradeId:storedReplayForRequest.tradeId,
      firstOutsideTime:storedReplayForRequest.firstOutsideTime,
      priorTouchDetails:storedPurity?.touchDetails.slice(0,storedReplayForRequest.priorTouches)??[],
      zone:{...storedZoneForReplay,touches:storedReplayForRequest.priorTouches,maxPenetration:storedReplayForRequest.maxPenetration,departureInsideCandleCount:storedPurity?.departureInsideCandleCount??0},
      zoneAgeSeconds:storedReplayForRequest.zoneAgeSeconds??getGoldilocksZoneAgeSeconds(storedZoneForReplay.candleTime,storedReplayForRequest.confirmationTime+(GOLDILOCKS_TIMEFRAME_SECONDS[GOLDILOCKS_DEMO_TIMEFRAMES.confirmation]??300)),
      confirmationTimeframe:GOLDILOCKS_DEMO_TIMEFRAMES.confirmation,
      confirmationTime:storedReplayForRequest.confirmationTime,
      confirmationCandle:storedConfirmationCandle,
      touchCandle:storedTouchCandle,
      proximity:storedProximity,
      runway:{
        direction:storedReplayForRequest.direction==='BUY'?'buy' as const:'sell' as const,
        entry:storedReplayForRequest.entry,stopLoss:storedReplayForRequest.stopLoss,takeProfit:storedReplayForRequest.takeProfit,
        risk:storedRisk,reward:storedReward,ratio:storedRisk?storedReward/storedRisk:0,
        availableReward:Number.isFinite(storedReplayForRequest.availableRrr)?storedRisk*storedReplayForRequest.availableRrr:Infinity,
        availableRatio:storedReplayForRequest.availableRrr??Infinity,allowed:true,
        reason:`Stored backtest entry, stop, and target at the recorded ${GOLDILOCKS_DEMO_TIMEFRAMES.confirmation} confirmation.`,
      },
      trend:(storedReplayForRequest.trend==='bullish'||storedReplayForRequest.trend==='bearish'?storedReplayForRequest.trend:'unknown') as ReturnType<typeof getGoldilocksTrend>,
      score:storedReplayForRequest.scoreJson as ReturnType<typeof scoreGoldilocksSetup>,
      outcome:storedReplayForRequest.outcome==='WIN'?'win' as const:'loss' as const,
      exitReason:storedReplayForRequest.exitReason==='stop'?'stop' as const
        :storedReplayForRequest.exitReason==='weekend_close'?'weekend_close' as const
          :storedReplayForRequest.exitReason==='target'||storedReplayForRequest.exitReason==='runner_target'?'target' as const:'break_even' as const,
      exitPrice:storedExitPrice,
      breakEvenActivated:storedReplayForRequest.exitReason!=='stop',
      outcomeTime:storedReplayForRequest.outcomeTime,
    }:null;
    const reconstructedEntrySetup=Number.isFinite(requestedTradeTime)
      ?storedEntrySetup??requestedHistoricalEntrySetup
      :openHistoricalSetups[0]??historicalEntrySetups.sort((a,b)=>b.confirmationTime-a.confirmationTime)[0]??null;
    const storedReplay=storedReplayForRequest;
    const replayExitTime=Number.isFinite(requestedExitTime)?requestedExitTime:storedReplay?.outcomeTime;
    const historicalEntrySetup=reconstructedEntrySetup&&Number.isFinite(replayExitTime)
      ?{
          ...reconstructedEntrySetup,
          outcomeTime:replayExitTime,
          outcome:storedReplay?.outcome==='LOSS'?'loss' as const:storedReplay?.outcome==='WIN'?'win' as const:reconstructedEntrySetup.outcome,
          exitReason:storedReplay?.exitReason==='stop'?'stop' as const
            :storedReplay?.exitReason==='break_even'||storedReplay?.exitReason==='runner_stop'||storedReplay?.exitReason==='one_r_protected'?'break_even' as const
              :storedReplay?.exitReason==='weekend_close'?'weekend_close' as const
              :storedReplay?.exitReason==='target'||storedReplay?.exitReason==='runner_target'?'target' as const
                :reconstructedEntrySetup.exitReason,
          exitPrice:storedExitPrice,
        }
      :reconstructedEntrySetup;
    const replayEntryEligibilityTime=historicalEntrySetup
      ?historicalEntrySetup.confirmationTime+(GOLDILOCKS_TIMEFRAME_SECONDS[GOLDILOCKS_DEMO_TIMEFRAMES.confirmation]??300)
      :undefined;
    const marketTimeAudit=replayEntryEligibilityTime===undefined?null:(()=>{
      const date=new Date(replayEntryEligibilityTime*1000);
      const holiday=getForexHolidayStatusAt(date);
      return {
        entryEligibilityTime:replayEntryEligibilityTime,
        marketTimeZone:'America/New_York',
        weeklyBlocked:isForexWeekendEntryBlocked(date),
        holiday,
      };
    })();
    let departureSpeed:ReturnType<typeof measureGoldilocksIntrabarDepartureSpeed>;
    const departureTime=historicalEntrySetup?.zone.departureQuality?.departureCandleTime;
    if(Number.isFinite(requestedTradeTime)&&historicalEntrySetup&&departureTime!==undefined){
      try{
        const intrabarRaw=await fetchCandles(
          pair,'M1',100,
          new Date((departureTime-30*60)*1000).toISOString(),
          new Date((departureTime+15*60)*1000).toISOString(),
          'demo',
        );
        departureSpeed=measureGoldilocksIntrabarDepartureSpeed(
          historicalEntrySetup.zone,
          intrabarRaw.map(candle=>({
            time:Math.floor(new Date(candle.time).getTime()/1000),
            open:candle.open,high:candle.high,low:candle.low,close:candle.close,
          })),
        );
      }catch{
        departureSpeed=undefined;
      }
    }
    const historicalEntrySetupWithAudit=historicalEntrySetup?{...historicalEntrySetup,departureSpeed}:historicalEntrySetup;
    const runwayChecks = detection.zones.map((zone) => ({
      zoneId: zone.id,
      ...validateTwoToOneRunway(zone, zoneHistory.activeZones),
    }));
    const displayIndexAtOrAfter=(time:number)=>{
      const index=strategyCandles.findIndex(candle=>candle.time>=time);
      return index>=0?index:strategyCandles.length-1;
    };
    const earliestActiveIndex=zoneHistory.activeZones.length?Math.min(...zoneHistory.activeZones.map(zone=>displayIndexAtOrAfter(zone.candleTime))):leg.startIndex;
    const replayContextAnchor=historicalEntrySetup
      ?getStrategyReplayContextAnchor(
          historicalEntrySetup.zone.candleTime,
          historicalEntrySetup.priorTouchDetails.map(touch=>touch.time),
          displayZonesWithConfluence.map(zone=>zone.candleTime),
        )
      :undefined;
    const replayBaseContextIndex=replayContextAnchor!==undefined
      ?displayIndexAtOrAfter(getStrategyReplayBaseContextStart(replayContextAnchor))
      :undefined;
    const viewEnd = candles.length - 1;
    const viewStart = replayBaseContextIndex??Math.max(0,Math.min(leg.startIndex-200,earliestActiveIndex-20));
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
      confirmationCandles:Number.isFinite(requestedTradeTime)?historicalCandles:null,
      displayTimeframe:timeframe,
      leg: visibleLeg,
      swingA,
      swingB,
      swings: visibleSwings,
      runwayChecks,
      finalEntryChecks,
      historicalEntrySetup:historicalEntrySetupWithAudit,
      marketTimeAudit,
      requestedTradeTime:Number.isFinite(requestedTradeTime)?requestedTradeTime:null,
      replayStrategyVersion:storedReplayForRequest?.strategyVersion??'legacy-m15-m5-m1',
      currentStrategyVersion:GOLDILOCKS_STRATEGY_VERSION,
      legacyReplay:Boolean(storedReplayForRequest&&!currentStrategyReplay),
      historicalMatchDeltaSeconds:requestedHistoricalEntrySetup?Math.abs(requestedHistoricalEntrySetup.confirmationTime-requestedTradeTime):null,
      historicalEntrySetups,
      rejectedFirstTouches:filterReplayRejectedFirstTouchesAt(
        rejectedFirstTouches,
        zoneHistory.zones,
        replayDisplayTime??strategyCandles.at(-1)?.time??Number.NEGATIVE_INFINITY,
        new Set(displayZonesWithConfluence.map(zone=>zone.id)),
      ).filter(rejected=>
        rejected.time>=(visibleCandles[0]?.time??Number.NEGATIVE_INFINITY)&&
        rejected.time<=(visibleCandles.at(-1)?.time??Number.POSITIVE_INFINITY)
      ),
      backtestCoverage:{
        from:historicalCandles[0]?.time??null,
        to:historicalCandles.at(-1)?.time??null,
        candles:historicalCandles.length,
        trendTimeframe:GOLDILOCKS_DEMO_TIMEFRAMES.trend,
        zoneTimeframe:GOLDILOCKS_DEMO_TIMEFRAMES.zone,
        confirmationTimeframe:GOLDILOCKS_DEMO_TIMEFRAMES.confirmation,
      },
      zoneHistory:{
        zones:zoneHistory.zones.map(zone=>({...zone,candleIndex:displayIndexAtOrAfter(zone.candleTime)-viewStart})),
        activeZones:zoneHistory.activeZones.map(zone=>({...zone,candleIndex:displayIndexAtOrAfter(zone.candleTime)-viewStart})),
        activeDemand:zoneHistory.activeDemand?{...zoneHistory.activeDemand,candleIndex:displayIndexAtOrAfter(zoneHistory.activeDemand.candleTime)-viewStart}:null,
        activeSupply:zoneHistory.activeSupply?{...zoneHistory.activeSupply,candleIndex:displayIndexAtOrAfter(zoneHistory.activeSupply.candleTime)-viewStart}:null,
        nearestZones:nearestZones.map(zone=>({...zone,candleIndex:displayIndexAtOrAfter(zone.candleTime)-viewStart})),
        displayZones:displayZonesWithConfluence.map(zone=>({...zone,candleIndex:displayIndexAtOrAfter(zone.candleTime)-viewStart})),
        recentSwingBase:recentSwingBase?{...recentSwingBase,candleIndex:displayIndexAtOrAfter(recentSwingBase.candleTime)-viewStart}:null,
        recentDemandBase:recentDemandBase?{...recentDemandBase,candleIndex:displayIndexAtOrAfter(recentDemandBase.candleTime)-viewStart}:null,
        recentSupplyBase:recentSupplyBase?{...recentSupplyBase,candleIndex:displayIndexAtOrAfter(recentSupplyBase.candleTime)-viewStart}:null,
        currentPrice,
      },
      detection: {
        ...detection,
        leg: visibleLeg,
        zones: detection.zones.map((zone) => ({
          ...zone,
          candleIndex: displayIndexAtOrAfter(zone.candleTime) - viewStart,
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
