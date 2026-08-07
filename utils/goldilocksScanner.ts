import type { Candle } from './swingLabeler.ts';
import { measureGoldilocksApproachPressure, type GoldilocksApproachPressure } from './approachPressure.ts';
import { GOLDILOCKS_DEMO_TIMEFRAMES } from './goldilocksConfig.ts';
import { getGoldilocksZoneExpiresAt } from './zoneAge.ts';
import { determineSwingPoints, type SwingResult } from './swingLabeler.ts';
import {
  annotateTimeframeConfluence,
  createGoldilocksSignalState,
  detectGoldilocksZoneHistory,
  summarizeZoneTimeframeTouches,
  summarizeConfirmationTimeframeTouches,
  observeGoldilocksSignalCandle,
  observeGoldilocksStreamTouch,
  qualifyGoldilocksDepartureCandle,
  validateGoldilocksEntryProximity,
  type GoldilocksEntryProximityCheck,
  type GoldilocksDirection,
  type GoldilocksZone,
  type GoldilocksZoneHistory,
  type StrategyCandle,
  type SwingLeg,
} from './goldilocksStrategy.ts';

export type GoldilocksTrend = 'bullish' | 'bearish' | 'unknown';

export const buildProtectedStructureTrendTimeline = (candles:Candle[], swings:SwingResult[]):GoldilocksTrend[] => {
  const timeline:GoldilocksTrend[]=candles.map(()=>'unknown');
  const structure=swings
    .filter(swing=>['H','L','HH','HL','LH','LL'].includes(swing.swing))
    .sort((left,right)=>left.candleIndex-right.candleIndex);
  const firstMajorIndex=structure.findIndex(swing=>swing.swing==='HH'||swing.swing==='LL');
  if(firstMajorIndex<0)return timeline;
  const firstMajor=structure[firstMajorIndex];
  let trend:GoldilocksTrend=firstMajor.swing==='HH'?'bullish':'bearish';
  let externalHigh=firstMajor.swing==='HH'?firstMajor.price:Number.NEGATIVE_INFINITY;
  let externalLow=firstMajor.swing==='LL'?firstMajor.price:Number.POSITIVE_INFINITY;
  let protectedLow=trend==='bullish'
    ? structure.slice(0,firstMajorIndex).filter(swing=>swing.swing==='L'||swing.swing==='HL'||swing.swing==='LL').at(-1)?.price
    : undefined;
  let protectedHigh=trend==='bearish'
    ? structure.slice(0,firstMajorIndex).filter(swing=>swing.swing==='H'||swing.swing==='LH'||swing.swing==='HH').at(-1)?.price
    : undefined;
  const swingsByIndex=new Map<number,SwingResult[]>();
  for(const swing of structure.slice(firstMajorIndex)){
    const entries=swingsByIndex.get(swing.candleIndex)??[];
    entries.push(swing);
    swingsByIndex.set(swing.candleIndex,entries);
  }
  for(let index=firstMajor.candleIndex;index<candles.length;index+=1){
    for(const swing of swingsByIndex.get(index)??[]){
      if(trend==='bullish'){
        if(swing.swing==='HH')externalHigh=Math.max(externalHigh,swing.price);
        if(swing.swing==='HL')protectedLow=swing.price;
      }else{
        if(swing.swing==='LL')externalLow=Math.min(externalLow,swing.price);
      }
    }
    const candle=candles[index];
    if(trend==='bullish'&&protectedLow!==undefined&&candle.low<protectedLow){
      trend='bearish';
      protectedHigh=Number.isFinite(externalHigh)?externalHigh:candle.high;
      externalLow=candle.low;
      protectedLow=undefined;
      timeline[index]=trend;
      continue;
    }
    if(trend==='bearish'){
      externalLow=Math.min(externalLow,candle.low);
      if(protectedHigh!==undefined&&candle.high>protectedHigh){
        trend='bullish';
        protectedLow=Number.isFinite(externalLow)?externalLow:candle.low;
        externalHigh=candle.high;
        protectedHigh=undefined;
      }
    }
    timeline[index]=trend;
  }
  return timeline;
};

export const getProtectedStructureTrend = (candles:Candle[], swings:SwingResult[]):GoldilocksTrend => {
  return buildProtectedStructureTrendTimeline(candles,swings).at(-1)??'unknown';
};

export const getGoldilocksTrend = (candles: Candle[], atTime = Number.POSITIVE_INFINITY): GoldilocksTrend => {
  const available = candles.filter(candle => new Date(candle.time).getTime() / 1000 <= atTime);
  return getProtectedStructureTrend(available,determineSwingPoints(available));
};

export const zoneUsableAt = (zone: GoldilocksZone, time: number) => {
  return (zone.availableAt ?? zone.candleTime) <= time
    && (!zone.invalidatedAt || zone.invalidatedAt > time)
    && time <= getGoldilocksZoneExpiresAt(zone.candleTime);
};

export const annotateConfluenceAt = (
  zone: GoldilocksZone,
  zoneTimeframe: string,
  time: number,
  histories: Array<{ timeframe: string; history: GoldilocksZoneHistory }>,
) => annotateTimeframeConfluence(
  [zone],
  zoneTimeframe,
  histories
    .filter(item => item.timeframe !== zoneTimeframe)
    .map(item => ({
      timeframe:item.timeframe,
      zones:item.history.zones
        .filter(candidate=>zoneUsableAt(candidate,time))
        .map(candidate=>({...candidate,state:'fresh' as const})),
    })),
)[0];

export const getGoldilocksStructureBreakingLegDirection = (
  left: string,
  right: string,
): SwingLeg["direction"] | null => {
  if (["LL", "HL", "L"].includes(left) && right === "HH") return "bullish";
  if (["HH", "LH", "H"].includes(left) && right === "LL") return "bearish";
  return null;
};

export const toStrategyCandles = (candles: Candle[]): StrategyCandle[] => candles
  .map((candle) => ({
    time: Math.floor(new Date(candle.time).getTime() / 1000),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }))
  .filter((candle) => Number.isFinite(candle.time))
  .sort((a, b) => a.time - b.time);

export const buildGoldilocksLegs = (candles: Candle[]): SwingLeg[] => {
  const swings = determineSwingPoints(candles);
  const indexByTime = new Map(candles.map((candle, index) => [candle.time, index]));
  const legs: SwingLeg[] = [];
  for (let index = 0; index < swings.length - 1; index += 1) {
    const left = swings[index];
    const right = swings[index + 1];
    const direction = getGoldilocksStructureBreakingLegDirection(
      left.swing,
      right.swing,
    );
    if (!direction || !left.time || !right.time) continue;
    const startIndex = indexByTime.get(left.time) ?? -1;
    const endIndex = indexByTime.get(right.time) ?? -1;
    if (startIndex >= 0 && endIndex > startIndex) legs.push({
      direction,
      startIndex,
      endIndex,
      startSwing:left.swing,
      endSwing:right.swing,
      brokeOppositeLegIn:(left.swing==='LL'&&right.swing==='HH')||(left.swing==='HH'&&right.swing==='LL'),
    });
  }
  return legs;
};

export const buildGoldilocksHistory = (candles: Candle[], options: { trackTouches?: boolean } = {}): {
  candles: StrategyCandle[];
  legs: SwingLeg[];
  history: GoldilocksZoneHistory;
} => {
  const strategyCandles = toStrategyCandles(candles);
  const legs = buildGoldilocksLegs(candles);
  return { candles: strategyCandles, legs, history: detectGoldilocksZoneHistory(strategyCandles, legs, options) };
};

export const buildGoldilocksHistoryChunked = (
  candles: Candle[],
  chunkSize = 5_000,
  overlap = 500,
  options: { trackTouches?: boolean } = {},
): GoldilocksZoneHistory => {
  if (candles.length <= chunkSize) {
    const normalized = candles.map((candle, candleIndex) => ({ ...candle, candleIndex }));
    return buildGoldilocksHistory(normalized,options).history;
  }
  const strategyCandles = toStrategyCandles(candles);
  const candidates = new Map<string, GoldilocksZone>();
  const step = Math.max(1, chunkSize - overlap);
  for (let coreStart = 0; coreStart < candles.length; coreStart += step) {
    const sliceStart = Math.max(0, coreStart - overlap);
    const sliceEnd = Math.min(candles.length, coreStart + step + overlap);
    const slice = candles.slice(sliceStart, sliceEnd).map((candle, index) => ({ ...candle, candleIndex: index }));
    const snapshot = buildGoldilocksHistory(slice,options);
    for (const zone of snapshot.history.zones) {
      const globalIndex = sliceStart + zone.candleIndex;
      if (globalIndex < coreStart || globalIndex >= Math.min(candles.length, coreStart + step)) continue;
      const globalZone = { ...zone, candleIndex: globalIndex, reasons: [...zone.reasons] };
      const key = `${zone.kind}:${zone.side}:${zone.candleTime}:${zone.low}:${zone.high}`;
      candidates.set(key, globalZone);
    }
  }

  const zones = [...candidates.values()].sort((a, b) => a.candleTime - b.candleTime);
  const pending = [...zones].sort((a, b) => (a.availableAt ?? a.candleTime) - (b.availableAt ?? b.candleTime));
  const active = new Set<GoldilocksZone>();
  const countingStarted = new Map<GoldilocksZone, boolean>();
  let pendingIndex = 0;
  for (const zone of zones) {
    zone.state = 'fresh';
    zone.touches = 0;
    zone.firstTouchIndex = undefined;
    zone.invalidatedAt = undefined;
    zone.expiredAt = undefined;
    zone.maxPenetration = 0;
  }
  for (let candleIndex = 0; candleIndex < strategyCandles.length; candleIndex += 1) {
    const candle = strategyCandles[candleIndex];
    while (pendingIndex < pending.length && (pending[pendingIndex].availableAt ?? pending[pendingIndex].candleTime) <= candle.time) {
      active.add(pending[pendingIndex]);
      countingStarted.set(pending[pendingIndex], false);
      pendingIndex += 1;
    }
    for (const zone of active) {
      if (candle.time > getGoldilocksZoneExpiresAt(zone.candleTime)) {
        zone.state = 'expired';
        zone.expiredAt = candle.time;
        active.delete(zone);
        continue;
      }
      const invalid = zone.side === 'demand' ? candle.low < zone.low : candle.high > zone.high;
      if (invalid) {
        zone.state = 'invalidated';
        zone.invalidatedAt = candle.time;
        active.delete(zone);
        continue;
      }
      const started=countingStarted.get(zone)===true;
      if (!started) {
        const outside = qualifyGoldilocksDepartureCandle(
          zone,
          strategyCandles,
          candleIndex,
        ).qualifies;
        if(outside)countingStarted.set(zone, true);
        continue;
      }
      const touched = candle.high >= zone.low && candle.low <= zone.high;
      if ((options.trackTouches??true) && touched) {
        zone.state = 'touched';
        zone.touches += 1;
        zone.firstTouchIndex ??= candleIndex;
        if (zone.touches > 3) {
          zone.state = 'invalidated';
          zone.invalidatedAt = candle.time;
          active.delete(zone);
        }
      }
    }
  }
  const activeZones = zones.filter(zone => zone.state !== 'invalidated' && zone.state !== 'expired');
  const newest = (side: GoldilocksZone['side']) => activeZones.filter(zone => zone.side === side).sort((a, b) => b.candleTime - a.candleTime)[0];
  return { zones, activeZones, activeDemand: newest('demand'), activeSupply: newest('supply') };
};

/**
 * Applies the confirmation-timeframe purity ledger to detected zones.
 *
 * Zone detection deliberately runs with `trackTouches:false` for both live and
 * backtest scans. This pass supplies the executable lifecycle from the same
 * lower-timeframe candle contract used by confirmation and research.
 */
export const summarizeGoldilocksCausalZoneLifecycle = (input: {
  zone: GoldilocksZone;
  confirmationCandles: StrategyCandle[];
  confirmationSeconds: number;
  zoneCandles: StrategyCandle[];
  zoneSeconds: number;
  completedBefore?: number;
  maximumTouches?: number;
}) => {
  const completedBefore=input.completedBefore??Number.POSITIVE_INFINITY;
  const maximumTouches=input.maximumTouches??3;
  const candles=[...input.confirmationCandles].sort((left,right)=>left.time-right.time);
  const departure=summarizeZoneTimeframeTouches(
    input.zone,input.zoneCandles,input.zoneSeconds,completedBefore,
  );
  const signalStart=departure.armedAt===undefined?Number.POSITIVE_INFINITY:
    Math.max(departure.armedAt,input.zone.availableAt??input.zone.candleTime);
  let triggerIndex=-1;
  let postTriggerBreakAt:number|undefined;
  for(let index=0;index<candles.length;index+=1){
    const candle=candles[index];
    if(candle.time+input.confirmationSeconds>completedBefore)continue;
    const broken=input.zone.side==='demand'?candle.low<input.zone.low:candle.high>input.zone.high;
    if(triggerIndex>=0){if(broken){postTriggerBreakAt=candle.time;break}continue}
    if(broken)break;
    if(candle.time>=signalStart&&candle.high>=input.zone.low&&candle.low<=input.zone.high){
      triggerIndex=index;
    }
  }
  const triggerTime=triggerIndex>=0?candles[triggerIndex].time:undefined;
  const purity=summarizeConfirmationTimeframeTouches(
    input.zone,candles,input.confirmationSeconds,triggerTime??completedBefore,maximumTouches,
  );
  // A fourth prior touch or distal break before the candidate means that candle
  // can never become the trigger. The trigger itself is deliberately excluded.
  const validTriggerIndex=purity.invalidated?-1:triggerIndex;
  const invalidatedAt=[input.zone.invalidatedAt,departure.invalidatedAt,purity.invalidatedAt,postTriggerBreakAt]
    .filter((time):time is number=>typeof time==='number'&&Number.isFinite(time)&&time<completedBefore)
    .sort((left,right)=>left-right)[0];
  return {departure,purity,triggerIndex:validTriggerIndex,triggerCandle:validTriggerIndex>=0?candles[validTriggerIndex]:undefined,invalidatedAt};
};

export const applyConfirmationTimeframeZoneLifecycle = (
  history: GoldilocksZoneHistory,
  confirmationCandles: StrategyCandle[],
  confirmationSeconds: number,
  zoneCandles: StrategyCandle[],
  zoneSeconds: number,
  completedBefore = Number.POSITIVE_INFINITY,
  maximumTouches = 3,
): GoldilocksZoneHistory => {
  const zones = history.zones.map((zone) => {
    if (zone.kind !== 'base') return zone;
    const lifecycle=summarizeGoldilocksCausalZoneLifecycle({
      zone,confirmationCandles,confirmationSeconds,zoneCandles,zoneSeconds,completedBefore,maximumTouches,
    });
    if (lifecycle.departure.firstOutsideTime === undefined) return {
      ...zone,
      touches: 0,
      state: lifecycle.invalidatedAt!==undefined?'invalidated' as const:'fresh' as const,
      invalidatedAt:lifecycle.invalidatedAt,
    };
    const invalidated=lifecycle.invalidatedAt!==undefined;
    return {
      ...zone,
      touches: lifecycle.purity.touches,
      state: invalidated ? 'invalidated' as const : lifecycle.purity.touches > 0 ? 'touched' as const : 'fresh' as const,
      invalidatedAt:lifecycle.invalidatedAt,
    };
  });
  const activeZones = zones.filter((zone) => zone.state !== 'invalidated' && zone.state !== 'expired');
  const newest = (side: GoldilocksZone['side']) => activeZones
    .filter((zone) => zone.side === side)
    .sort((left, right) => right.candleTime - left.candleTime)[0];
  return { zones, activeZones, activeDemand: newest('demand'), activeSupply: newest('supply') };
};

export interface GoldilocksZoneChartEvidence {
  zoneId: string;
  zoneSide: GoldilocksZone['side'];
  zoneTimeframe: string;
  confirmationTimeframe: string;
  formationCandleDetails: Array<{ time: number; price: number }>;
  departureCandleTime?: number;
  priorTouchDetails: Array<{ time: number; price: number }>;
  touchCount: number;
  triggerTouchTime?: number;
  invalidatedAt?: number;
  invalidationReason?: 'DISTAL BREAK' | 'FOURTH TOUCH';
  approachPressure?: GoldilocksApproachPressure;
}

/**
 * Builds chart diagnostics from the same completed-candle lifecycle used by
 * execution. It is intentionally independent of whether a trade setup fired.
 */
export const buildGoldilocksZoneChartEvidence = (input: {
  history: GoldilocksZoneHistory;
  zoneCandles: StrategyCandle[];
  zoneSeconds: number;
  zoneTimeframe: string;
  confirmationCandles: StrategyCandle[];
  confirmationSeconds: number;
  confirmationTimeframe: string;
  completedBefore?: number;
  maximumTouches?: number;
}): GoldilocksZoneChartEvidence[] => {
  const completedBefore = input.completedBefore ?? Number.POSITIVE_INFINITY;
  const maximumTouches = input.maximumTouches ?? 3;
  const confirmationCandles = [...input.confirmationCandles].sort((a,b)=>a.time-b.time);
  const retainedZoneCandleTimes = new Set(input.zoneCandles.map((candle) => candle.time));
  return input.history.zones
    // A clipped chart tail cannot causally reconstruct an older base. Fail closed
    // instead of relabeling the first retained candle as formation/departure evidence.
    .filter((zone) => zone.kind === 'base' && retainedZoneCandleTimes.has(zone.candleTime))
    .map((zone) => {
      const lifecycle=summarizeGoldilocksCausalZoneLifecycle({
        zone,confirmationCandles,confirmationSeconds:input.confirmationSeconds,
        zoneCandles:input.zoneCandles,zoneSeconds:input.zoneSeconds,completedBefore,maximumTouches,
      });
      const {departure,purity}=lifecycle;
      const departureOpen = departure.firstOutsideTime;
      const formationCandleDetails = input.zoneCandles
        .filter((candle) => candle.time >= zone.candleTime &&
          (departureOpen === undefined || candle.time < departureOpen) &&
          candle.time + input.zoneSeconds <= completedBefore)
        .map((candle) => ({
          time:candle.time,
          price:zone.side==='demand'?candle.low:candle.high,
        }));
      const triggerIndex=lifecycle.triggerIndex;
      let latestCompletedIndex=-1;
      for(let index=0;index<confirmationCandles.length;index+=1){
        if(confirmationCandles[index].time+input.confirmationSeconds<=completedBefore)
          latestCompletedIndex=index;
      }
      const approachPressure = triggerIndex >= 0 && latestCompletedIndex > triggerIndex
        ? measureGoldilocksApproachPressure(
            zone,confirmationCandles,triggerIndex,latestCompletedIndex,
            {firstOutsideTime:purity.firstOutsideTime},
          )
        : undefined;
      const invalidatedAt=lifecycle.invalidatedAt;
      return {
        zoneId:zone.id,
        zoneSide:zone.side,
        zoneTimeframe:input.zoneTimeframe,
        confirmationTimeframe:input.confirmationTimeframe,
        formationCandleDetails,
        departureCandleTime:departure.firstOutsideTime,
        priorTouchDetails:purity.touchDetails,
        touchCount:purity.touches,
        triggerTouchTime:triggerIndex>=0?confirmationCandles[triggerIndex].time:undefined,
        invalidatedAt,
        invalidationReason:invalidatedAt===undefined?undefined:
          purity.touches>maximumTouches&&purity.invalidatedAt===invalidatedAt?'FOURTH TOUCH':'DISTAL BREAK',
        approachPressure,
      };
    });
};

export const getGoldilocksConfirmationHistoryStart = (
  history: GoldilocksZoneHistory,
  defaultStart: number,
  confirmationSeconds: number,
) => {
  const earliestBaseTime = history.activeZones
    .filter((zone) => zone.kind === 'base')
    .reduce((earliest, zone) => Math.min(earliest, zone.candleTime), Number.POSITIVE_INFINITY);
  return Number.isFinite(earliestBaseTime)
    ? Math.min(defaultStart, Math.max(0, earliestBaseTime - confirmationSeconds))
    : defaultStart;
};

export interface FreshGoldilocksConfirmation {
  zone: GoldilocksZone;
  direction: GoldilocksDirection;
  firstOutsideTime: number;
  touchCandle: StrategyCandle;
  confirmationCandle: StrategyCandle;
  priorTouches: number;
  proximity: GoldilocksEntryProximityCheck;
  entryEligibilityTime?: number;
  streamQuote?: {bid:number;ask:number;time:number;receivedAt:number};
}

export const findFreshGoldilocksConfirmations = (
  history: GoldilocksZoneHistory,
  confirmationCandles: StrategyCandle[],
  confirmationSeconds: number,
  nowMs = Date.now(),
  zoneCandles: StrategyCandle[] = confirmationCandles,
  zoneSeconds = confirmationSeconds,
  confirmationMode: 'close-through' | 'touch-entry' = 'close-through',
): FreshGoldilocksConfirmation[] => {
  if (confirmationCandles.length < 2) return [];
  const candles = [...confirmationCandles].sort((a, b) => a.time - b.time);
  const confirmationCandle = candles[candles.length - 1];
  // A completed candle remains actionable only until the next candle completes.
  if (nowMs >= (confirmationCandle.time + confirmationSeconds * 2) * 1000) return [];

  return history.activeZones.filter((zone)=>zone.kind==="base").flatMap((zone) => {
    if ((zone.availableAt ?? zone.candleTime) >= confirmationCandle.time) return [];
    const armed=summarizeZoneTimeframeTouches(zone,zoneCandles,zoneSeconds,confirmationCandle.time);
    if(armed.firstOutsideTime===undefined||armed.armedAt===undefined)return [];
    // A zone cannot be touched, broken, or otherwise evaluated before the
    // structure that created it is causally available to the strategy.
    const signalStartTime=Math.max(armed.armedAt,zone.availableAt??zone.candleTime);
    const signalState=createGoldilocksSignalState();
    let latestObservation:ReturnType<typeof observeGoldilocksSignalCandle>|undefined;
    for (let index=0;index<candles.length;index+=1) {
      const candle=candles[index];
      if (candle.time < signalStartTime || candle.time > confirmationCandle.time) continue;
      const observation=observeGoldilocksSignalCandle({
        zone,candles,candleIndex:index,armedAt:armed.armedAt,state:signalState,confirmationMode,
      });
      if(observation.invalidated){latestObservation=undefined;break}
      if(index===candles.length-1)latestObservation=observation;
    }
    const touchIndex=signalState.touchCandleIndex;
    const touchCandle=touchIndex>=0?candles[touchIndex]:undefined;
    if (!touchCandle||!latestObservation?.confirmed) return [];
    // Purity mirrors the historical backtester: count from the confirmation-
    // timeframe departure after the base, including returns that occurred before
    // structural availability. Availability gates the trigger, not prior history.
    const purity=summarizeConfirmationTimeframeTouches(zone,candles,confirmationSeconds,touchCandle.time);
    if(purity.invalidated)return [];
    const direction: GoldilocksDirection = zone.side === 'demand' ? 'bullish' : 'bearish';
    const proximity=validateGoldilocksEntryProximity(zone,touchCandle,
      confirmationMode==='touch-entry'?(zone.side==='demand'?zone.high:zone.low):confirmationCandle.close);
    return [{
      zone:{...zone,touches:purity.touches,maxPenetration:0},
      direction,firstOutsideTime:purity.firstOutsideTime!,touchCandle,confirmationCandle,
      priorTouches:purity.touches,
      proximity,
    }];
  }).sort((a, b) => b.zone.candleTime - a.zone.candleTime);
};

export const findFreshGoldilocksStreamTouches = (
  history: GoldilocksZoneHistory,
  confirmationCandles: StrategyCandle[],
  confirmationSeconds: number,
  quote: {bid:number;ask:number;time:number;receivedAt:number},
  zoneCandles: StrategyCandle[] = confirmationCandles,
  zoneSeconds = confirmationSeconds,
): FreshGoldilocksConfirmation[] => {
  const completedCandles=[...confirmationCandles]
    .filter(candle=>candle.time+confirmationSeconds<=quote.time)
    .sort((left,right)=>left.time-right.time);
  return history.activeZones.filter(zone=>zone.kind==='base').flatMap(zone=>{
    if((zone.availableAt??zone.candleTime)>quote.time)return [];
    const armed=summarizeZoneTimeframeTouches(zone,zoneCandles,zoneSeconds,quote.time);
    if(armed.firstOutsideTime===undefined||armed.armedAt===undefined)return [];
    const signalStartTime=Math.max(armed.armedAt,zone.availableAt??zone.candleTime);
    const historicalState=createGoldilocksSignalState();
    for(let index=0;index<completedCandles.length;index+=1){
      if(completedCandles[index].time<signalStartTime)continue;
      const observation=observeGoldilocksSignalCandle({
        zone,candles:completedCandles,candleIndex:index,armedAt:armed.armedAt,
        state:historicalState,confirmationMode:'touch-entry',
      });
      // A completed historical first touch is stale and terminal for immediate
      // execution. Live automation must never chase it on a later quote.
      if(observation.invalidated||observation.confirmed)return [];
    }
    const streamObservation=observeGoldilocksStreamTouch(zone,quote);
    if(!streamObservation.touched||streamObservation.broken)return [];
    const purity=summarizeConfirmationTimeframeTouches(
      zone,completedCandles,confirmationSeconds,quote.time,
    );
    if(purity.invalidated)return [];
    const midpoint=(quote.bid+quote.ask)/2;
    const touchCandle:StrategyCandle={
      time:quote.time,open:midpoint,high:quote.ask,low:quote.bid,close:midpoint,
    };
    const direction:GoldilocksDirection=zone.side==='demand'?'bullish':'bearish';
    return [{
      zone:{...zone,touches:purity.touches,maxPenetration:0},direction,
      firstOutsideTime:purity.firstOutsideTime!,touchCandle,
      confirmationCandle:touchCandle,priorTouches:purity.touches,
      proximity:validateGoldilocksEntryProximity(
        zone,touchCandle,streamObservation.executableEntry,
        streamObservation.executableEntry,
      ),
      entryEligibilityTime:quote.time,streamQuote:quote,
    }];
  }).sort((left,right)=>right.zone.candleTime-left.zone.candleTime);
};
