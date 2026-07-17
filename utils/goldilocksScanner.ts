import type { Candle } from './swingLabeler.ts';
import { determineSwingPoints } from './swingLabeler.ts';
import {
  annotateTimeframeConfluence,
  detectGoldilocksZoneHistory,
  type GoldilocksDirection,
  type GoldilocksZone,
  type GoldilocksZoneHistory,
  type StrategyCandle,
  type SwingLeg,
} from './goldilocksStrategy.ts';

export type GoldilocksTrend = 'bullish' | 'bearish' | 'unknown';

export interface GoldilocksRangeAssessment {
  aligned: boolean | null;
  low?: number;
  high?: number;
  midpoint?: number;
  detail: string;
}

export const getGoldilocksTrend = (candles: Candle[], atTime = Number.POSITIVE_INFINITY): GoldilocksTrend => {
  const available = candles.filter(candle => new Date(candle.time).getTime() / 1000 <= atTime);
  const latest = determineSwingPoints(available).filter(swing => ['HH', 'HL', 'LH', 'LL'].includes(swing.swing)).at(-1);
  return latest?.swing === 'HH' || latest?.swing === 'HL'
    ? 'bullish'
    : latest?.swing === 'LH' || latest?.swing === 'LL'
      ? 'bearish'
      : 'unknown';
};

export const zoneUsableAt = (zone: GoldilocksZone, time: number) => {
  const expiry = new Date(zone.candleTime * 1000);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 2);
  return (zone.availableAt ?? zone.candleTime) <= time
    && (!zone.invalidatedAt || zone.invalidatedAt > time)
    && time <= expiry.getTime() / 1000;
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
    .map(item => ({ timeframe: item.timeframe, zones: item.history.zones.filter(candidate => zoneUsableAt(candidate, time)) })),
)[0];

const isBullishPair = (left: string, right: string) =>
  ['LL', 'HL', 'L'].includes(left) && ['HH', 'LH', 'H'].includes(right);
const isBearishPair = (left: string, right: string) =>
  ['HH', 'LH', 'H'].includes(left) && ['LL', 'HL', 'L'].includes(right);

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
    const direction = isBullishPair(left.swing, right.swing)
      ? 'bullish'
      : isBearishPair(left.swing, right.swing)
        ? 'bearish'
        : null;
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

export const getGoldilocksRangeAssessment = (
  candles: Candle[],
  atTime: number,
  entry: number,
  tradeDirection: 'BUY'|'SELL',
):GoldilocksRangeAssessment=>{
  const known=candles.filter(candle=>Math.floor(new Date(candle.time).getTime()/1000)<=atTime);
  const legs=buildGoldilocksLegs(known);
  const leg=legs.at(-1);
  if(!leg)return {aligned:null,detail:'No completed M15 swing range was available.'};
  const rangeCandles=known.slice(leg.startIndex,leg.endIndex+1);
  const low=Math.min(...rangeCandles.map(candle=>candle.low));
  const high=Math.max(...rangeCandles.map(candle=>candle.high));
  const midpoint=low+(high-low)/2;
  const aligned=tradeDirection==='BUY'?entry<=midpoint:entry>=midpoint;
  return {aligned,low,high,midpoint,detail:`${tradeDirection} entry ${entry} is ${aligned?'in the correct':'in the opposite'} half of M15 range ${low}-${high} (midpoint ${midpoint}).`};
};

export const buildGoldilocksHistory = (candles: Candle[]): {
  candles: StrategyCandle[];
  legs: SwingLeg[];
  history: GoldilocksZoneHistory;
} => {
  const strategyCandles = toStrategyCandles(candles);
  const legs = buildGoldilocksLegs(candles);
  return { candles: strategyCandles, legs, history: detectGoldilocksZoneHistory(strategyCandles, legs) };
};

export const buildGoldilocksHistoryChunked = (
  candles: Candle[],
  chunkSize = 5_000,
  overlap = 500,
): GoldilocksZoneHistory => {
  if (candles.length <= chunkSize) {
    const normalized = candles.map((candle, candleIndex) => ({ ...candle, candleIndex }));
    return buildGoldilocksHistory(normalized).history;
  }
  const strategyCandles = toStrategyCandles(candles);
  const candidates = new Map<string, GoldilocksZone>();
  const step = Math.max(1, chunkSize - overlap);
  for (let coreStart = 0; coreStart < candles.length; coreStart += step) {
    const sliceStart = Math.max(0, coreStart - overlap);
    const sliceEnd = Math.min(candles.length, coreStart + step + overlap);
    const slice = candles.slice(sliceStart, sliceEnd).map((candle, index) => ({ ...candle, candleIndex: index }));
    const snapshot = buildGoldilocksHistory(slice);
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
    zone.touchPenetrations = [];
  }
  for (let candleIndex = 0; candleIndex < strategyCandles.length; candleIndex += 1) {
    const candle = strategyCandles[candleIndex];
    while (pendingIndex < pending.length && (pending[pendingIndex].availableAt ?? pending[pendingIndex].candleTime) < candle.time) {
      active.add(pending[pendingIndex]);
      countingStarted.set(pending[pendingIndex], false);
      pendingIndex += 1;
    }
    for (const zone of active) {
      const expires = new Date(zone.candleTime * 1000);
      expires.setUTCFullYear(expires.getUTCFullYear() + 2);
      if (candle.time > expires.getTime() / 1000) {
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
      if (touched && countingStarted.get(zone)) {
        zone.state = 'touched';
        zone.touches += 1;
        zone.firstTouchIndex ??= candleIndex;
        const penetration = zone.side === 'demand'
          ? (zone.high - candle.low) / zone.width
          : (candle.high - zone.low) / zone.width;
        zone.maxPenetration = Math.max(zone.maxPenetration, Math.max(0, penetration));
        zone.touchPenetrations?.push(Math.max(0, penetration));
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
  touchCandle: StrategyCandle;
  confirmationCandle: StrategyCandle;
}

const isOutside = (zone: GoldilocksZone, candle: StrategyCandle) =>
  zone.side === 'demand' ? candle.low > zone.high : candle.high < zone.low;
const touches = (zone: GoldilocksZone, candle: StrategyCandle) =>
  candle.high >= zone.low && candle.low <= zone.high;
const breaks = (zone: GoldilocksZone, candle: StrategyCandle) =>
  zone.side === 'demand' ? candle.low < zone.low : candle.high > zone.high;

export const findFreshGoldilocksConfirmations = (
  history: GoldilocksZoneHistory,
  confirmationCandles: StrategyCandle[],
  confirmationSeconds: number,
  nowMs = Date.now(),
): FreshGoldilocksConfirmation[] => {
  if (confirmationCandles.length < 2) return [];
  const candles = [...confirmationCandles].sort((a, b) => a.time - b.time);
  const confirmationCandle = candles[candles.length - 1];
  // A completed candle remains actionable only until the next candle completes.
  if (nowMs >= (confirmationCandle.time + confirmationSeconds * 2) * 1000) return [];

  return history.activeZones.flatMap((zone) => {
    if (zone.touches > 3 || (zone.availableAt ?? zone.candleTime) >= confirmationCandle.time) return [];
    let departed = false;
    let touchCandle: StrategyCandle | undefined;
    for (const candle of candles) {
      if (candle.time <= (zone.availableAt ?? zone.candleTime) || candle.time >= confirmationCandle.time) continue;
      if (breaks(zone, candle)) {
        touchCandle = undefined;
        break;
      }
      if (isOutside(zone, candle)) {
        departed = true;
        continue;
      }
      if (departed && touches(zone, candle)) {
        touchCandle = candle;
        departed = false;
      }
    }
    if (!touchCandle || breaks(zone, confirmationCandle)) return [];
    const direction: GoldilocksDirection = zone.side === 'demand' ? 'bullish' : 'bearish';
    const confirmed = direction === 'bullish'
      ? confirmationCandle.close > confirmationCandle.open && confirmationCandle.close > touchCandle.high
      : confirmationCandle.close < confirmationCandle.open && confirmationCandle.close < touchCandle.low;
    return confirmed ? [{ zone, direction, touchCandle, confirmationCandle }] : [];
  }).sort((a, b) => b.zone.candleTime - a.zone.candleTime);
};
