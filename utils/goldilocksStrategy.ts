import { GOLDILOCKS_DEPARTURE_QUALITY, GOLDILOCKS_ENTRY_PROXIMITY } from './goldilocksConfig';

export type GoldilocksDirection = 'bullish' | 'bearish';
export type GoldilocksZoneKind = 'base' | 'continuation';
export type GoldilocksZoneState = 'fresh' | 'touched' | 'invalidated' | 'expired';

export interface StrategyCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface GoldilocksEntryProximityCheck {
  allowed: boolean;
  touchRange: number;
  touchRangeZoneFraction: number;
  confirmationDistance: number;
  confirmationDistanceZoneFraction: number;
  executableDistance: number;
  executableDistanceZoneFraction: number;
  maxTouchRangeZoneFraction: number;
  maxEntryDistanceZoneFraction: number;
  reason: string;
}

export interface GoldilocksFirstTouchCheck {
  allowed: boolean;
  touchRange: number;
  touchRangeZoneFraction: number;
  maxTouchRangeZoneFraction: number;
  reason: string;
}

export const validateGoldilocksFirstTouchCandle = (
  zone: GoldilocksZone,
  touchCandle: StrategyCandle,
): GoldilocksFirstTouchCheck => {
  const width=Math.max(Number.EPSILON,zone.width);
  const touchRange=Math.max(0,touchCandle.high-touchCandle.low);
  const touchRangeZoneFraction=touchRange/width;
  const allowed=touchRangeZoneFraction<=GOLDILOCKS_ENTRY_PROXIMITY.maxTouchRangeZoneFraction;
  const percent=(value:number)=>(value*100).toFixed(1);
  return {
    allowed,
    touchRange,
    touchRangeZoneFraction,
    maxTouchRangeZoneFraction:GOLDILOCKS_ENTRY_PROXIMITY.maxTouchRangeZoneFraction,
    reason:allowed
      ?`First M5 touch range ${percent(touchRangeZoneFraction)}% of the M15 zone width.`
      :`The first M5 touch candle spans ${percent(touchRangeZoneFraction)}% of the M15 zone; maximum ${percent(GOLDILOCKS_ENTRY_PROXIMITY.maxTouchRangeZoneFraction)}%.`,
  };
};

export const validateGoldilocksEntryProximity = (
  zone: GoldilocksZone,
  touchCandle: StrategyCandle,
  confirmationClose: number,
  executableEntry = confirmationClose,
): GoldilocksEntryProximityCheck => {
  const width=Math.max(Number.EPSILON,zone.width);
  const firstTouch=validateGoldilocksFirstTouchCandle(zone,touchCandle);
  const touchRange=firstTouch.touchRange;
  const outsideDistance=(price:number)=>zone.side==='demand'
    ?Math.max(0,price-zone.high)
    :Math.max(0,zone.low-price);
  const confirmationDistance=outsideDistance(confirmationClose);
  const executableDistance=outsideDistance(executableEntry);
  const touchRangeZoneFraction=firstTouch.touchRangeZoneFraction;
  const confirmationDistanceZoneFraction=confirmationDistance/width;
  const executableDistanceZoneFraction=executableDistance/width;
  const touchAllowed=firstTouch.allowed;
  const confirmationAllowed=confirmationDistanceZoneFraction<=GOLDILOCKS_ENTRY_PROXIMITY.maxEntryDistanceZoneFraction;
  const executableAllowed=executableDistanceZoneFraction<=GOLDILOCKS_ENTRY_PROXIMITY.maxEntryDistanceZoneFraction;
  const allowed=touchAllowed&&confirmationAllowed&&executableAllowed;
  const percent=(value:number)=>(value*100).toFixed(1);
  const reason=!touchAllowed
    ?firstTouch.reason
    :!confirmationAllowed
      ?`The M5 close-through finished ${percent(confirmationDistanceZoneFraction)}% of one M15 zone width beyond the proximal edge; maximum ${percent(GOLDILOCKS_ENTRY_PROXIMITY.maxEntryDistanceZoneFraction)}%.`
      :!executableAllowed
        ?`The executable entry moved ${percent(executableDistanceZoneFraction)}% of one M15 zone width beyond the proximal edge; maximum ${percent(GOLDILOCKS_ENTRY_PROXIMITY.maxEntryDistanceZoneFraction)}%.`
        :`First M5 touch range ${percent(touchRangeZoneFraction)}%; close-through distance ${percent(confirmationDistanceZoneFraction)}%; executable-entry distance ${percent(executableDistanceZoneFraction)}% of the M15 zone width.`;
  return {
    allowed,touchRange,touchRangeZoneFraction,confirmationDistance,confirmationDistanceZoneFraction,
    executableDistance,executableDistanceZoneFraction,
    maxTouchRangeZoneFraction:GOLDILOCKS_ENTRY_PROXIMITY.maxTouchRangeZoneFraction,
    maxEntryDistanceZoneFraction:GOLDILOCKS_ENTRY_PROXIMITY.maxEntryDistanceZoneFraction,
    reason,
  };
};

export interface SwingLeg {
  direction: GoldilocksDirection;
  startIndex: number;
  endIndex: number;
  startSwing?: string;
  endSwing?: string;
  brokeOppositeLegIn?: boolean;
}

export interface GoldilocksZone {
  id: string;
  kind: GoldilocksZoneKind;
  side: 'demand' | 'supply';
  candleIndex: number;
  candleTime: number;
  availableAt?: number;
  low: number;
  high: number;
  width: number;
  legMidpoint: number;
  legRange: number;
  /** Close-based displacement used by the strength score. */
  departureMultiple: number;
  /** Furthest wick excursion retained for audit; it no longer earns strength points by itself. */
  wickDepartureMultiple?: number;
  departureQuality?: GoldilocksDepartureQuality;
  strength2x: boolean;
  baseCandleCount?: number;
  departureInsideCandleCount?: number;
  brokeOppositeLegIn?: boolean;
  touches: number;
  maxPenetration: number;
  touchPenetrations?: number[];
  state: GoldilocksZoneState;
  invalidatedAt?: number;
  expiredAt?: number;
  firstTouchIndex?: number;
  reasons: string[];
  timeframeConfluence?: ZoneTimeframeConfluence;
}

export interface GoldilocksDepartureQuality {
  departureCandleTime:number;
  departureCandleIndex:number;
  candleRange:number;
  priorAtr14?:number;
  rangeAtrMultiple?:number;
  bodyFraction:number;
  rejectionWickFraction:number;
  closeDepartureZoneMultiple:number;
  wickDepartureZoneMultiple:number;
  shockRejected:boolean;
  reason:string;
}

export interface GoldilocksDepartureQualityCheck {
  allowed:boolean;
  reason:string;
  quality?:GoldilocksDepartureQuality;
}

export const validateGoldilocksDepartureQuality=(zone:GoldilocksZone):GoldilocksDepartureQualityCheck=>{
  const quality=zone.departureQuality;
  if(!quality||quality.rangeAtrMultiple===undefined){
    return {allowed:true,quality,reason:'Departure shock metrics are unavailable; no shock-rejection pattern was identified.'};
  }
  return {allowed:!quality.shockRejected,quality,reason:quality.reason};
};

export interface GoldilocksIntrabarDepartureSpeed {
  fastestCandleTime:number;
  fastestCandleRange:number;
  priorAtr14?:number;
  rangeAtrMultiple?:number;
  departureRangeFraction:number;
}

export const measureGoldilocksIntrabarDepartureSpeed=(
  zone:GoldilocksZone,
  intrabarCandles:StrategyCandle[],
  zoneTimeframeSeconds=15*60,
):GoldilocksIntrabarDepartureSpeed|undefined=>{
  const quality=zone.departureQuality;
  if(!quality)return undefined;
  const ordered=[...intrabarCandles].sort((left,right)=>left.time-right.time);
  const inside=ordered.filter(candle=>candle.time>=quality.departureCandleTime&&candle.time<quality.departureCandleTime+zoneTimeframeSeconds);
  if(!inside.length)return undefined;
  const fastest=inside.reduce((best,candle)=>candle.high-candle.low>best.high-best.low?candle:best);
  const before=ordered.filter(candle=>candle.time<quality.departureCandleTime).slice(-14);
  const priorAtr14=before.length===14?before.reduce((total,candle,index)=>{
    const previousClose=index>0?before[index-1].close:candle.open;
    return total+Math.max(candle.high-candle.low,Math.abs(candle.high-previousClose),Math.abs(candle.low-previousClose));
  },0)/14:undefined;
  const fastestCandleRange=fastest.high-fastest.low;
  return {
    fastestCandleTime:fastest.time,
    fastestCandleRange,
    priorAtr14,
    rangeAtrMultiple:priorAtr14&&priorAtr14>0?fastestCandleRange/priorAtr14:undefined,
    departureRangeFraction:quality.candleRange>0?fastestCandleRange/quality.candleRange:0,
  };
};

export interface ZoneTimeframeConfluence {
  timeframes: string[];
  timeframeCount: number;
  overlaps: Array<{
    timeframe: string;
    zoneId: string;
    relationship: 'inside' | 'contains' | 'overlaps';
    low: number;
    high: number;
  }>;
}

export const annotateTimeframeConfluence = (
  zones: GoldilocksZone[],
  zoneTimeframe: string,
  timeframeZones: Array<{ timeframe: string; zones: GoldilocksZone[] }>,
): GoldilocksZone[] => zones.map(zone=>{
  const overlaps=timeframeZones.flatMap(group=>group.zones
    .filter(other=>other.state!=='invalidated'&&other.state!=='expired'&&other.side===zone.side&&other.high>=zone.low&&other.low<=zone.high)
    .map(other=>({
      timeframe:group.timeframe,
      zoneId:other.id,
      relationship:(zone.low>=other.low&&zone.high<=other.high
        ?'inside'
        :other.low>=zone.low&&other.high<=zone.high
          ?'contains'
          :'overlaps') as 'inside'|'contains'|'overlaps',
      low:other.low,
      high:other.high,
    })));
  const timeframes=[zoneTimeframe,...overlaps.map(item=>item.timeframe)]
    .filter((item,index,items)=>items.indexOf(item)===index);
  return {...zone,timeframeConfluence:{timeframes,timeframeCount:timeframes.length,overlaps}};
});

export interface GoldilocksDetection {
  leg: SwingLeg;
  legLow: number;
  legHigh: number;
  midpoint: number;
  zones: GoldilocksZone[];
  rejected: Array<{ candleIndex: number; reason: string }>;
}

export interface GoldilocksZoneHistory {
  zones: GoldilocksZone[];
  activeZones: GoldilocksZone[];
  activeDemand?: GoldilocksZone;
  activeSupply?: GoldilocksZone;
}

export interface EngulfingConfirmation {
  confirmed: boolean;
  candleIndex?: number;
  reason: string;
}

export interface TradeRunwayCheck {
  allowed: boolean;
  direction: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  risk: number;
  reward: number;
  ratio: number;
  availableReward: number;
  availableRatio: number;
  blockingZoneId?: string;
  reason: string;
}

export interface FinalEntryCheck extends TradeRunwayCheck {
  engulfClose: number;
  actualEntryPrice: number;
  priceMoved: boolean;
}

export const getMostRecentActiveOpposingZone = (
  entryZone: GoldilocksZone,
  knownZones: GoldilocksZone[],
  knownZonesUsableAtEntry=false,
) => knownZones
  .filter((zone) =>
    zone.id !== entryZone.id &&
    zone.side !== entryZone.side &&
    (knownZonesUsableAtEntry || (zone.state !== 'invalidated' && zone.state !== 'expired')),
  )
  .sort((a, b) => b.candleTime - a.candleTime)[0];

const isOpposite = (candle: StrategyCandle, direction: GoldilocksDirection) =>
  direction === 'bullish' ? candle.close < candle.open : candle.close > candle.open;

const rangesOverlap = (a: StrategyCandle, b: StrategyCandle) =>
  Math.max(a.low, b.low) <= Math.min(a.high, b.high);

const bodiesOverlap = (a: StrategyCandle, b: StrategyCandle) =>
  Math.max(Math.min(a.open,a.close),Math.min(b.open,b.close)) <
  Math.min(Math.max(a.open,a.close),Math.max(b.open,b.close));

const candleRange = (candle: StrategyCandle) => candle.high - candle.low;

const twoCalendarYearsBefore = (timestamp: number) => {
  const date = new Date(timestamp * 1000);
  const rawMonth = date.getUTCMonth() - 24;
  const year = date.getUTCFullYear() + Math.floor(rawMonth / 12);
  const month = ((rawMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(
    year,
    month,
    Math.min(date.getUTCDate(), lastDay),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ) / 1000);
};

const atrAt = (candles: StrategyCandle[], candleIndex: number, period = 14) => {
  if (candleIndex < period - 1) return undefined;
  let total = 0;
  for (let index = candleIndex - period + 1; index <= candleIndex; index += 1) {
    const candle = candles[index];
    const previousClose = index > 0 ? candles[index - 1].close : candle.close;
    total += Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  }
  return total / period;
};

const selectLargestOpposite = (
  candles: StrategyCandle[],
  indices: number[],
  direction: GoldilocksDirection,
) =>
  indices
    .filter((index) => isOpposite(candles[index], direction))
    .sort((a, b) => candleRange(candles[b]) - candleRange(candles[a]))[0];

const getZoneBounds = (
  candle: StrategyCandle,
  direction: GoldilocksDirection,
  kind: GoldilocksZoneKind,
  legLow: number,
  legHigh: number,
) =>
  direction === 'bullish'
    ? {
        low: kind === 'base' ? legLow : candle.low,
        high: candle.open,
        side: 'demand' as const,
      }
    : {
        low: candle.open,
        high: kind === 'base' ? legHigh : candle.high,
        side: 'supply' as const,
      };

const getOverlappingContinuationCluster = (
  candles: StrategyCandle[],
  seedIndex: number,
  minIndex: number,
  maxIndex: number,
) => {
  const group = [seedIndex];
  let left = seedIndex - 1;
  while (
    left >= minIndex &&
    bodiesOverlap(candles[left], candles[left + 1])
  ) {
    group.unshift(left);
    left -= 1;
  }
  let right = seedIndex + 1;
  while (
    right <= maxIndex &&
    bodiesOverlap(candles[right], candles[right - 1])
  ) {
    group.push(right);
    right += 1;
  }
  return group;
};

const evaluateZone = (
  candles: StrategyCandle[],
  leg: SwingLeg,
  kind: GoldilocksZoneKind,
  candleIndex: number,
  legLow: number,
  legHigh: number,
  baseCandleCount = 1,
): GoldilocksZone | { rejected: string } => {
  const candle = candles[candleIndex];
  const bounds = getZoneBounds(candle, leg.direction, kind, legLow, legHigh);
  const legRange = legHigh - legLow;
  const midpoint = legLow + legRange / 2;
  const width = bounds.high - bounds.low;
  const atr14 = kind === 'continuation' ? atrAt(candles, candleIndex) : undefined;
  const minimumContinuationWidth = atr14 === undefined
    ? undefined
    : Math.max(legRange * 0.02, atr14 * 0.5);

  if (width <= 0) return { rejected: 'Zone has no measurable width.' };
  if (width > legRange * 0.25) {
    return { rejected: 'Zone width is greater than 25% of the swing leg.' };
  }
  if (minimumContinuationWidth !== undefined && width < minimumContinuationWidth) {
    return {
      rejected: `Continuation zone is too thin: ${((width / atr14!) * 100).toFixed(1)}% of ATR(14); minimum width is the greater of 50% ATR(14) or 2% of the swing leg.`,
    };
  }
  if (
    kind === 'continuation' &&
    ((leg.direction === 'bullish' && bounds.high > midpoint) ||
      (leg.direction === 'bearish' && bounds.low < midpoint))
  ) {
    return {
      rejected:
        leg.direction === 'bullish'
          ? 'Continuation demand is not fully below the 50% discount line.'
          : 'Continuation supply is not fully above the 50% premium line.',
    };
  }

  const futureIndices=Array.from({length:Math.max(0,leg.endIndex-candleIndex)},(_,offset)=>candleIndex+1+offset);
  const future = futureIndices.map(index=>candles[index]);
  const wickDepartureDistance =
    leg.direction === 'bullish'
      ? Math.max(...future.map((item) => item.high), bounds.high) - bounds.high
      : bounds.low - Math.min(...future.map((item) => item.low), bounds.low);
  const closeDepartureDistance=leg.direction==='bullish'
    ?Math.max(...future.map(item=>item.close),bounds.high)-bounds.high
    :bounds.low-Math.min(...future.map(item=>item.close),bounds.low);
  const departureMultiple=closeDepartureDistance/width;
  const wickDepartureMultiple=wickDepartureDistance/width;
  const departureCandleIndex=futureIndices.reduce((best,index)=>{
    if(best<0)return index;
    return leg.direction==='bullish'
      ?candles[index].high>candles[best].high?index:best
      :candles[index].low<candles[best].low?index:best;
  },-1);
  const departureCandle=departureCandleIndex>=0?candles[departureCandleIndex]:candle;
  const candleRange=Math.max(0,departureCandle.high-departureCandle.low);
  const priorAtr14=departureCandleIndex>0?atrAt(candles,departureCandleIndex-1):undefined;
  const rangeAtrMultiple=priorAtr14&&priorAtr14>0?candleRange/priorAtr14:undefined;
  const bodyFraction=candleRange>0?Math.abs(departureCandle.close-departureCandle.open)/candleRange:0;
  const rejectionWick=leg.direction==='bullish'
    ?departureCandle.high-Math.max(departureCandle.open,departureCandle.close)
    :Math.min(departureCandle.open,departureCandle.close)-departureCandle.low;
  const rejectionWickFraction=candleRange>0?Math.max(0,rejectionWick)/candleRange:0;
  const closeDepartureZoneMultiple=leg.direction==='bullish'
    ?Math.max(0,departureCandle.close-bounds.high)/width
    :Math.max(0,bounds.low-departureCandle.close)/width;
  const shockRejected=rangeAtrMultiple!==undefined&&
    rangeAtrMultiple>=GOLDILOCKS_DEPARTURE_QUALITY.shockRangeAtrMultiple&&
    rejectionWickFraction>=GOLDILOCKS_DEPARTURE_QUALITY.rejectionWickFraction&&
    closeDepartureZoneMultiple<GOLDILOCKS_DEPARTURE_QUALITY.minimumShockCloseDepartureZoneMultiple;
  const departureQuality:GoldilocksDepartureQuality={
    departureCandleTime:departureCandle.time,
    departureCandleIndex,
    candleRange,priorAtr14,rangeAtrMultiple,bodyFraction,rejectionWickFraction,
    closeDepartureZoneMultiple,wickDepartureZoneMultiple:wickDepartureMultiple,shockRejected,
    reason:rangeAtrMultiple===undefined
      ?'Departure quality has insufficient completed M15 history for a prior ATR(14) shock comparison.'
      :shockRejected
        ?`Shock/rejection departure rejected: ${rangeAtrMultiple.toFixed(2)}x ATR range, ${(rejectionWickFraction*100).toFixed(1)}% rejection wick, and only ${closeDepartureZoneMultiple.toFixed(2)}x zone-width close displacement.`
        :`Departure quality passed: ${rangeAtrMultiple.toFixed(2)}x ATR range, ${(rejectionWickFraction*100).toFixed(1)}% rejection wick, and ${closeDepartureZoneMultiple.toFixed(2)}x zone-width close displacement.`,
  };
  const strength2x = departureMultiple >= 2;
  let departureConfirmed = false;
  let touchCountingStarted = false;
  let touches = 0;
  let maxPenetration = 0;
  const touchPenetrations:number[]=[];
  let state: GoldilocksZoneState = 'fresh';
  let invalidatedAt: number | undefined;
  let firstTouchIndex: number | undefined;

  for (let index = candleIndex + 1; index <= leg.endIndex; index += 1) {
    const current = candles[index];
    const invalid =
      leg.direction === 'bullish'
        ? current.low < bounds.low
        : current.high > bounds.high;
    if (invalid) {
      state = 'invalidated';
      invalidatedAt = current.time;
      break;
    }
    const moveAway =
      leg.direction === 'bullish'
        ? current.high - bounds.high
        : bounds.low - current.low;
    const outside =
      leg.direction === 'bullish'
        ? current.low > bounds.high
        : current.high < bounds.low;
    if (outside) {
      touchCountingStarted = true;
      if (!departureConfirmed && moveAway >= width * 2) departureConfirmed = true;
      continue;
    }

    if (!departureConfirmed && moveAway >= width * 2) departureConfirmed = true;

    const touched =
      leg.direction === 'bullish'
        ? current.low <= bounds.high
        : current.high >= bounds.low;
    if (touched && touchCountingStarted) {
      touches += 1;
      state = 'touched';
      firstTouchIndex ??= index;
      const penetration =
        leg.direction === 'bullish'
          ? (bounds.high - current.low) / width
          : (current.high - bounds.low) / width;
      maxPenetration = Math.max(maxPenetration, Math.max(0, penetration));
      touchPenetrations.push(Math.max(0,penetration));
    }
  }

  const reasons = [
    kind === 'base'
      ? leg.direction === 'bullish'
        ? 'Body boundary comes from the selected opposite candle; distal boundary uses the leg low.'
        : 'Body boundary comes from the selected opposite candle; distal boundary uses the leg high.'
      : leg.direction === 'bullish'
        ? 'Lowest qualifying opposite-direction continuation candle in discount.'
        : 'Highest qualifying opposite-direction continuation candle in premium.',
    `Zone width is ${((width / legRange) * 100).toFixed(1)}% of the swing leg.`,
    ...(kind === 'continuation' && atr14 !== undefined
      ? [`Zone width is ${((width / atr14) * 100).toFixed(1)}% of ATR(14).`]
      : []),
    strength2x
      ? `Sustained M15 closes reached ${departureMultiple.toFixed(2)}x zone width; furthest wick reached ${wickDepartureMultiple.toFixed(2)}x.`
      : `Sustained M15 closes reached only ${departureMultiple.toFixed(2)}x zone width; furthest wick reached ${wickDepartureMultiple.toFixed(2)}x.`,
    departureQuality.reason,
  ];

  return {
    id: `${kind}-${bounds.side}-${candle.time}`,
    kind,
    side: bounds.side,
    candleIndex,
    candleTime: candle.time,
    availableAt: candles[leg.endIndex].time,
    low: bounds.low,
    high: bounds.high,
    width,
    legMidpoint: midpoint,
    legRange,
    departureMultiple,
    wickDepartureMultiple,
    departureQuality,
    strength2x,
    baseCandleCount,
    brokeOppositeLegIn: leg.brokeOppositeLegIn ?? false,
    touches,
    maxPenetration,
    touchPenetrations,
    state,
    invalidatedAt,
    firstTouchIndex,
    reasons,
  };
};

export const detectGoldilocksZones = (
  candles: StrategyCandle[],
  leg: SwingLeg,
): GoldilocksDetection => {
  if (leg.startIndex < 0 || leg.endIndex >= candles.length || leg.startIndex >= leg.endIndex) {
    throw new Error('Invalid swing leg indices.');
  }

  const legCandles = candles.slice(leg.startIndex, leg.endIndex + 1);
  const legLow = Math.min(...legCandles.map((candle) => candle.low));
  const legHigh = Math.max(...legCandles.map((candle) => candle.high));
  const midpoint = legLow + (legHigh - legLow) / 2;
  const rejected: GoldilocksDetection['rejected'] = [];
  const zones: GoldilocksZone[] = [];

  let baseSeed=leg.startIndex;
  while(baseSeed>=0&&!isOpposite(candles[baseSeed],leg.direction))baseSeed-=1;
  const baseGroup = baseSeed>=0?[baseSeed]:[leg.startIndex];
  for(let index=baseSeed-1;index>=0;index-=1){
    if(!isOpposite(candles[index],leg.direction)||!bodiesOverlap(candles[index],candles[index+1]))break;
    baseGroup.unshift(index);
  }
  for (let index = baseSeed + 1; index < leg.endIndex; index += 1) {
    if (!isOpposite(candles[index], leg.direction)) break;
    if (!bodiesOverlap(candles[index], candles[index - 1])) break;
    baseGroup.push(index);
  }
  const baseIndex = selectLargestOpposite(candles, baseGroup, leg.direction);
  if (baseIndex === undefined) {
    rejected.push({ candleIndex: leg.startIndex, reason: 'Swing base has no opposite-direction candle.' });
  } else {
    const base = evaluateZone(candles, leg, 'base', baseIndex, legLow, legHigh, baseGroup.length);
    if ('rejected' in base) rejected.push({ candleIndex: baseIndex, reason: base.rejected });
    else zones.push(base);
  }

  const candidates: GoldilocksZone[] = [];
  const consumed = new Set<number>();
  const continuationStart = Math.max(...baseGroup) + 1;
  for (let index = continuationStart; index < leg.endIndex; index += 1) {
    if (consumed.has(index) || !isOpposite(candles[index], leg.direction)) continue;
    const group = getOverlappingContinuationCluster(
      candles,
      index,
      leg.startIndex + 1,
      leg.endIndex - 1,
    );
    group.forEach((item) => consumed.add(item));
    const selected = selectLargestOpposite(candles, group, leg.direction);
    if (selected === undefined) continue;
    const result = evaluateZone(candles, leg, 'continuation', selected, legLow, legHigh, group.length);
    if ('rejected' in result) {
      rejected.push({ candleIndex: selected, reason: result.rejected });
    } else if (result.state === 'invalidated') {
      rejected.push({
        candleIndex: selected,
        reason: 'Continuation broke through its distal boundary before it could remain an active zone.',
      });
    } else {
      const position = ((result.low + result.high) / 2 - legLow) / (legHigh - legLow);
      const inContinuationBand =
        leg.direction === 'bullish'
          ? position >= 0.25 && position <= 0.49
          : position >= 0.51 && position <= 0.75;
      const baseZone = zones.find((zone) => zone.kind === 'base');
      const minimumGap = (legHigh - legLow) * 0.05;
      const separatedFromBase =
        !baseZone ||
        (leg.direction === 'bullish'
          ? result.low - baseZone.high >= minimumGap
          : baseZone.low - result.high >= minimumGap);
      if (!inContinuationBand) {
        rejected.push({
          candleIndex: selected,
          reason:
            leg.direction === 'bullish'
              ? 'Continuation demand midpoint is outside the 25%-49% leg band.'
              : 'Continuation supply midpoint is outside the mirrored 51%-75% leg band.',
        });
      } else if (!separatedFromBase) {
        rejected.push({
          candleIndex: selected,
          reason: 'Continuation zone overlaps the base or is within 5% of the leg from it.',
        });
      } else {
        result.reasons.unshift(
          leg.direction === 'bullish'
            ? `Zone midpoint is at ${(position * 100).toFixed(1)}% of the leg (25%-49% discount band).`
            : `Zone midpoint is at ${(position * 100).toFixed(1)}% of the leg (51%-75% premium band).`,
        );
        candidates.push(result);
      }
    }
  }

  candidates.sort((a, b) =>
    leg.direction === 'bullish' ? a.low - b.low : b.high - a.high,
  );
  if (candidates[0]) {
    const continuation = candidates[0];
    const baseZone = zones.find((zone) => zone.kind === 'base');
    if (baseZone) {
      const baseReachedAt = candles.findIndex((candle, index) =>
        index > continuation.candleIndex &&
        index <= leg.endIndex &&
        (leg.direction === 'bullish'
          ? candle.low <= baseZone.high
          : candle.high >= baseZone.low),
      );
      if (baseReachedAt >= 0) {
        continuation.state = 'invalidated';
        continuation.invalidatedAt = candles[baseReachedAt].time;
        continuation.reasons.push('Price later reached the same-side base, so this continuation is no longer active.');
      }
    }
    zones.push(continuation);
  }

  return { leg, legLow, legHigh, midpoint, zones, rejected };
};

export const detectGoldilocksZoneHistory = (
  candles: StrategyCandle[],
  legs: SwingLeg[],
  options: { trackTouches?: boolean } = {},
): GoldilocksZoneHistory => {
  const trackTouches=options.trackTouches??true;
  const byId = new Map<string, GoldilocksZone>();
  const baseByLeg = new Map<string, GoldilocksZone>();

  for (const leg of [...legs].sort((a,b)=>a.endIndex-b.endIndex)) {
    const detection = detectGoldilocksZones(candles, leg);
    const legKey = `${leg.direction}-${leg.startIndex}-${leg.endIndex}`;
    const base = detection.zones.find(zone=>zone.kind==='base');
    if (base) baseByLeg.set(legKey, base);
    for (const detected of detection.zones) {
      const zone:GoldilocksZone={...detected,reasons:[...detected.reasons]};
      if(zone.state==='touched')zone.state='fresh';
      zone.touches=0;
      zone.firstTouchIndex=undefined;
      zone.maxPenetration=0;
      zone.touchPenetrations=[];
      const relatedBase=baseByLeg.get(legKey);
      let touchCountingStarted=candles
        .slice(zone.candleIndex+1,leg.endIndex+1)
        .some(candle=>zone.side==='demand'?candle.low>zone.high:candle.high<zone.low);
      for(let index=leg.endIndex+1;index<candles.length;index+=1){
        const candle=candles[index];
        const invalid=zone.side==='demand'?candle.low<zone.low:candle.high>zone.high;
        const continuationBaseReached=zone.kind==='continuation'&&relatedBase&&(
          zone.side==='demand'?candle.low<=relatedBase.high:candle.high>=relatedBase.low
        );
        if(invalid||continuationBaseReached){
          zone.state='invalidated';
          zone.invalidatedAt=candle.time;
          zone.reasons.push(invalid
            ?'A later candle traded through the distal boundary.'
            :'Price later reached the same-side base, invalidating this continuation.');
          break;
        }
        const outside=zone.side==='demand'?candle.low>zone.high:candle.high<zone.low;
        if(outside){touchCountingStarted=true;continue}
        const touched=zone.side==='demand'?candle.low<=zone.high:candle.high>=zone.low;
        if(trackTouches&&touched&&touchCountingStarted){
          zone.state='touched';
          zone.touches+=1;
          zone.firstTouchIndex??=index;
          const penetration=zone.side==='demand'
            ?(zone.high-candle.low)/zone.width
            :(candle.high-zone.low)/zone.width;
          zone.maxPenetration=Math.max(zone.maxPenetration,Math.max(0,penetration));
          zone.touchPenetrations?.push(Math.max(0,penetration));
          if(zone.touches>3){
            zone.state='invalidated';
            zone.invalidatedAt=candle.time;
            zone.reasons.push('Zone invalidated on its fourth qualifying touch; the maximum is three touches.');
            break;
          }
        }
      }
      byId.set(`${legKey}-${zone.id}`,{...zone,id:`${legKey}-${zone.id}`});
    }
  }

  const zones=[...byId.values()].sort((a,b)=>a.candleTime-b.candleTime);
  const latestCandleTime=candles[candles.length-1]?.time;
  if(latestCandleTime!==undefined){
    const cutoff=twoCalendarYearsBefore(latestCandleTime);
    for(const zone of zones){
      if(zone.state!=='invalidated'&&zone.candleTime<cutoff){
        zone.state='expired';
        zone.expiredAt=latestCandleTime;
        zone.reasons.push('Zone expired because it is more than two calendar years old.');
      }
    }
  }
  const activeZones=zones.filter(zone=>zone.state!=='invalidated'&&zone.state!=='expired');
  const newest=(side:GoldilocksZone['side'])=>activeZones
    .filter(zone=>zone.side===side)
    .sort((a,b)=>b.candleTime-a.candleTime)[0];
  return {zones,activeZones,activeDemand:newest('demand'),activeSupply:newest('supply')};
};

export const validateTwoToOneRunway = (
  entryZone: GoldilocksZone,
  knownZones: GoldilocksZone[],
  confirmedEntryPrice?: number,
  options?:{knownZonesUsableAtEntry?:boolean},
): TradeRunwayCheck => {
  const direction: TradeRunwayCheck['direction'] = entryZone.side === 'demand' ? 'buy' : 'sell';
  const entry = confirmedEntryPrice ?? (direction === 'buy' ? entryZone.high : entryZone.low);
  const stopLoss = direction === 'buy' ? entryZone.low : entryZone.high;
  const risk = direction === 'buy' ? entry - stopLoss : stopLoss - entry;
  const takeProfit = direction === 'buy' ? entry + risk * 2 : entry - risk * 2;
  if (risk <= 0) {
    return {
      allowed: false,
      direction,
      entry,
      stopLoss,
      takeProfit: entry,
      risk,
      reward: 0,
      ratio: 0,
      availableReward: 0,
      availableRatio: 0,
      reason: 'Rejected: engulfing close is beyond the wrong side of the zone stop.',
    };
  }
  const opposingZone = getMostRecentActiveOpposingZone(entryZone, knownZones,options?.knownZonesUsableAtEntry);
  const availableReward = opposingZone
    ? direction === 'buy'
      ? Math.max(0, opposingZone.low - entry)
      : Math.max(0, entry - opposingZone.high)
    : Number.POSITIVE_INFINITY;
  const availableRatio = availableReward / risk;
  const blockingZone = opposingZone && (
    direction === 'buy'
      ? opposingZone.high > entry && opposingZone.low <= takeProfit
      : opposingZone.low < entry && opposingZone.high >= takeProfit
  ) ? opposingZone : undefined;

  const common = { direction, entry, stopLoss, takeProfit, risk, reward: risk * 2, ratio: 2, availableReward, availableRatio };
  return blockingZone
    ? {
        ...common,
        allowed: false,
        blockingZoneId: blockingZone.id,
        reason: `Rejected: ${blockingZone.kind} ${blockingZone.side} zone blocks the clear 2:1 path.`,
      }
    : {
        ...common,
        allowed: true,
        reason: opposingZone
          ? `Clear 2:1 runway: the most recent active ${opposingZone.kind} ${opposingZone.side} zone begins beyond target.`
          : 'Clear 2:1 runway: no active opposing Goldilocks zone is currently stored.',
      };
};

export const validateFinalEntryAfterEngulf = (
  entryZone: GoldilocksZone,
  knownZones: GoldilocksZone[],
  engulfClose: number,
  actualEntryPrice: number,
): FinalEntryCheck => {
  if (entryZone.state === 'invalidated' || entryZone.state === 'expired') {
    const direction:TradeRunwayCheck['direction']=entryZone.side==='demand'?'buy':'sell';
    return {
      allowed:false,direction,entry:actualEntryPrice,actualEntryPrice,engulfClose,
      stopLoss:direction==='buy'?entryZone.low:entryZone.high,takeProfit:actualEntryPrice,
      risk:0,reward:0,ratio:0,availableReward:0,availableRatio:0,priceMoved:actualEntryPrice!==engulfClose,
      reason:entryZone.state==='expired'
        ?'MISSED - DO NOT CHASE: the entry zone expired after two years.'
        :'MISSED - DO NOT CHASE: the entry zone broke after confirmation.',
    };
  }
  const check=validateTwoToOneRunway(entryZone,knownZones,actualEntryPrice);
  return {
    ...check,
    engulfClose,
    actualEntryPrice,
    priceMoved:actualEntryPrice!==engulfClose,
    reason:check.allowed
      ? actualEntryPrice===engulfClose
        ?'Final 2:1 check passed at the engulf close.'
        :'Final 2:1 check passed again at the current market price.'
      :`MISSED - DO NOT CHASE: ${check.reason}`,
  };
};

export interface GoldilocksFinalExecutableEntryCheck {
  allowed: boolean;
  proximity: GoldilocksEntryProximityCheck;
  runway: FinalEntryCheck;
  reason: string;
}

export const validateGoldilocksFinalExecutableEntry = (
  zone: GoldilocksZone,
  knownZones: GoldilocksZone[],
  touchCandle: StrategyCandle,
  confirmationClose: number,
  executableEntry: number,
): GoldilocksFinalExecutableEntryCheck => {
  const proximity=validateGoldilocksEntryProximity(zone,touchCandle,confirmationClose,executableEntry);
  const runway=validateFinalEntryAfterEngulf(zone,knownZones,confirmationClose,executableEntry);
  return {
    allowed:proximity.allowed&&runway.allowed,
    proximity,
    runway,
    reason:!proximity.allowed?proximity.reason:runway.reason,
  };
};

export const countZoneTouchesBefore = (
  zone: GoldilocksZone,
  candles: StrategyCandle[],
  stopBeforeIndex: number,
): number => {
  let countingStarted = false;
  let touches = 0;
  const availableAt = zone.availableAt ?? zone.candleTime;
  for (let index = Math.max(0, zone.candleIndex + 1); index < Math.min(stopBeforeIndex, candles.length); index += 1) {
    const candle = candles[index];
    if (candle.time <= availableAt) continue;
    const invalid = zone.side === 'demand' ? candle.low < zone.low : candle.high > zone.high;
    if (invalid) break;
    const outside = zone.side === 'demand' ? candle.low > zone.high : candle.high < zone.low;
    if (outside) {
      countingStarted = true;
      continue;
    }
    const touched = candle.high >= zone.low && candle.low <= zone.high;
    if (touched && countingStarted) touches += 1;
  }
  return touches;
};

export interface HistoricalZoneTouchState {
  armed: boolean;
  touchCandleIndex: number;
  totalTouches: number;
  maxPenetration: number;
  touchesBeforeTouch: number;
  maxPenetrationBeforeTouch: number;
  invalidated: boolean;
}

export const createHistoricalZoneTouchState = (): HistoricalZoneTouchState => ({
  armed: false,
  touchCandleIndex: -1,
  totalTouches: 0,
  maxPenetration: 0,
  touchesBeforeTouch: 0,
  maxPenetrationBeforeTouch: 0,
  invalidated: false,
});

export interface ZoneTimeframeTouchSummary {
  firstOutsideTime?: number;
  departureInsideCandleCount: number;
  touches: number;
  maxPenetration: number;
  touchDetails: Array<{time:number;penetration:number;price:number}>;
  invalidated: boolean;
}

export const summarizeZoneTimeframeTouches = (
  zone: GoldilocksZone,
  candles: StrategyCandle[],
  candleSeconds: number,
  completedBefore = Number.POSITIVE_INFINITY,
): ZoneTimeframeTouchSummary => {
  const summary:ZoneTimeframeTouchSummary={departureInsideCandleCount:0,touches:0,maxPenetration:0,touchDetails:[],invalidated:false};
  for(const candle of candles){
    if(candle.time<=zone.candleTime||candle.time+candleSeconds>completedBefore)continue;
    const broken=zone.side==='demand'?candle.low<zone.low:candle.high>zone.high;
    if(broken){summary.invalidated=true;break}
    const outside=zone.side==='demand'?candle.low>zone.high:candle.high<zone.low;
    if(summary.firstOutsideTime===undefined){
      if(outside)summary.firstOutsideTime=candle.time;
      else if(candle.high>=zone.low&&candle.low<=zone.high)summary.departureInsideCandleCount+=1;
      continue;
    }
    const touched=candle.high>=zone.low&&candle.low<=zone.high;
    if(!touched)continue;
    const raw=zone.side==='demand'?(zone.high-candle.low)/zone.width:(candle.high-zone.low)/zone.width;
    summary.touches+=1;
    const penetration=Math.max(0,Math.min(1,raw));
    summary.maxPenetration=Math.max(summary.maxPenetration,penetration);
    summary.touchDetails.push({time:candle.time,penetration,price:zone.side==='demand'?candle.low:candle.high});
    if(summary.touches>3){summary.invalidated=true;break}
  }
  return summary;
};

/**
 * Advances the causal trigger-timeframe touch ledger for an already-actionable zone.
 * The caller must evaluate a pending confirmation before observing the same candle,
 * so a confirming candle cannot rewrite the touch it is supposed to close beyond.
 */
export const observeHistoricalZoneCandle = (
  zone: GoldilocksZone,
  candle: StrategyCandle,
  candleIndex: number,
  state: HistoricalZoneTouchState,
): HistoricalZoneTouchState => {
  const outside=zone.side==='demand'?candle.low>zone.high:candle.high<zone.low;
  const touched=candle.high>=zone.low&&candle.low<=zone.high;
  if(outside)state.armed=true;
  if(!touched||!state.armed)return state;
  const rawPenetration=zone.side==='demand'
    ?(zone.high-candle.low)/zone.width
    :(candle.high-zone.low)/zone.width;
  const penetration=Math.max(0,Math.min(1,rawPenetration));
  state.touchesBeforeTouch=state.totalTouches;
  state.maxPenetrationBeforeTouch=state.maxPenetration;
  state.totalTouches+=1;
  state.maxPenetration=Math.max(state.maxPenetration,penetration);
  state.touchCandleIndex=candleIndex;
  state.invalidated=state.totalTouches>3;
  return state;
};

export const findFullCandleEngulfing = (
  candles: StrategyCandle[],
  direction: GoldilocksDirection,
  startIndex = 1,
): EngulfingConfirmation => {
  for (let index = Math.max(1, startIndex); index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    if (
      direction === 'bullish' &&
      previous.close < previous.open &&
      current.close > current.open &&
      current.high > previous.high &&
      current.low < previous.low &&
      current.close > previous.high
    ) {
      return { confirmed: true, candleIndex: index, reason: 'Bullish candle engulfed the complete prior bearish candle.' };
    }
    if (
      direction === 'bearish' &&
      previous.close > previous.open &&
      current.close < current.open &&
      current.high > previous.high &&
      current.low < previous.low &&
      current.close < previous.low
    ) {
      return { confirmed: true, candleIndex: index, reason: 'Bearish candle engulfed the complete prior bullish candle.' };
    }
  }
  return { confirmed: false, reason: 'No complete lower-timeframe candle engulfing was found.' };
};

export const findCloseBeyondTouchedCandle = (
  candles: StrategyCandle[],
  direction: GoldilocksDirection,
  touchCandleIndex: number,
  startIndex = touchCandleIndex + 1,
): EngulfingConfirmation => {
  const touched = candles[touchCandleIndex];
  if (!touched) return { confirmed: false, reason: 'The touched candle could not be found.' };
  for (let index = Math.max(touchCandleIndex + 1, startIndex); index < candles.length; index += 1) {
    const current = candles[index];
    if (direction === 'bullish' && current.close > current.open && current.close > touched.high) {
      return {
        confirmed: true,
        candleIndex: index,
        reason: 'Bullish confirmation closed above the touched candle wick high.',
      };
    }
    if (direction === 'bearish' && current.close < current.open && current.close < touched.low) {
      return {
        confirmed: true,
        candleIndex: index,
        reason: 'Bearish confirmation closed below the touched candle wick low.',
      };
    }
  }
  return {
    confirmed: false,
    reason: direction === 'bullish'
      ? 'No bullish candle closed above the touched candle wick high.'
      : 'No bearish candle closed below the touched candle wick low.',
  };
};
