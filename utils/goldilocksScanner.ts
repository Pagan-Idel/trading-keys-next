import type { Candle } from './swingLabeler.ts';
import { GOLDILOCKS_DEMO_TIMEFRAMES } from './goldilocksConfig.ts';
import { getGoldilocksZoneExpiresAt } from './zoneAge.ts';
import { determineSwingPoints, type SwingResult } from './swingLabeler.ts';
import {
  annotateTimeframeConfluence,
  detectGoldilocksZoneHistory,
  summarizeZoneTimeframeTouches,
  summarizeConfirmationTimeframeTouches,
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
    while (pendingIndex < pending.length && (pending[pendingIndex].availableAt ?? pending[pendingIndex].candleTime) < candle.time) {
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
      const outside = zone.side === 'demand' ? candle.low > zone.high : candle.high < zone.low;
      if (outside) {
        countingStarted.set(zone, true);
        continue;
      }
      const touched = candle.high >= zone.low && candle.low <= zone.high;
      if ((options.trackTouches??true) && touched && countingStarted.get(zone)) {
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

export interface FreshGoldilocksConfirmation {
  zone: GoldilocksZone;
  direction: GoldilocksDirection;
  firstOutsideTime: number;
  touchCandle: StrategyCandle;
  confirmationCandle: StrategyCandle;
  priorTouches: number;
  proximity: GoldilocksEntryProximityCheck;
}

const breaks = (zone: GoldilocksZone, candle: StrategyCandle) =>
  zone.side === 'demand' ? candle.low < zone.low : candle.high > zone.high;

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
    if(armed.firstOutsideTime===undefined)return [];
    let touchCandle:StrategyCandle|undefined;
    let touchIndex=-1;
    for (let index=0;index<candles.length;index+=1) {
      const candle=candles[index];
      if (candle.time < armed.firstOutsideTime || candle.time > confirmationCandle.time ||
        (confirmationMode==='close-through'&&candle.time===confirmationCandle.time)) continue;
      if (breaks(zone, candle)) {touchCandle=undefined;break}
      if(!touchCandle&&candle.high>=zone.low&&candle.low<=zone.high){touchCandle=candle;touchIndex=index}
    }
    if (!touchCandle || (confirmationMode==='close-through'&&breaks(zone, confirmationCandle))) return [];
    const purity=summarizeConfirmationTimeframeTouches(zone,candles,confirmationSeconds,touchCandle.time);
    if(purity.invalidated)return [];
    const direction: GoldilocksDirection = zone.side === 'demand' ? 'bullish' : 'bearish';
    const confirmed = confirmationMode==='touch-entry'&&touchCandle.time===confirmationCandle.time?true:direction === 'bullish'
      ? confirmationCandle.close > confirmationCandle.open && confirmationCandle.close > touchCandle.high
      : confirmationCandle.close < confirmationCandle.open && confirmationCandle.close < touchCandle.low;
    const proximity=validateGoldilocksEntryProximity(zone,touchCandle,
      confirmationMode==='touch-entry'?(zone.side==='demand'?zone.high:zone.low):confirmationCandle.close);
    return confirmed ? [{
      zone:{...zone,touches:purity.touches,maxPenetration:0},
      direction,firstOutsideTime:purity.firstOutsideTime!,touchCandle,confirmationCandle,
      priorTouches:purity.touches,
      proximity,
    }] : [];
  }).sort((a, b) => b.zone.candleTime - a.zone.candleTime);
};
