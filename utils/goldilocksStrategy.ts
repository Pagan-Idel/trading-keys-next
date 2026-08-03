import {
  GOLDILOCKS_BALANCE_DETECTION,
  GOLDILOCKS_DEPARTURE_QUALITY,
  GOLDILOCKS_ENTRY_PROXIMITY,
  type GoldilocksBacktestTweaks,
} from "./goldilocksConfig";
import {
  GOLDILOCKS_MAX_ZONE_AGE_SECONDS,
} from "./zoneAge";

export type GoldilocksDirection = "bullish" | "bearish";
export type GoldilocksZoneKind = "base" | "continuation";
export type GoldilocksZoneState =
  "fresh" | "touched" | "invalidated" | "expired";

export interface StrategyCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export const isZoneAtOrBelowLegMidpoint = (
  zone: Pick<GoldilocksZone, "low" | "high">,
  candles: StrategyCandle[],
  leg: SwingLeg,
): boolean => {
  const legCandles = candles.slice(leg.startIndex, leg.endIndex + 1);
  if (!legCandles.length) return false;
  const legLow = Math.min(...legCandles.map((candle) => candle.low));
  const legHigh = Math.max(...legCandles.map((candle) => candle.high));
  return (zone.low + zone.high) / 2 <= (legLow + legHigh) / 2;
};

export interface GoldilocksEntryProximityCheck {
  allowed: boolean;
  touchRange: number;
  touchRangeZoneFraction: number;
  confirmationDistance: number;
  confirmationDistanceZoneFraction: number;
  executableDistance: number;
  executableDistanceZoneFraction: number;
  executableChecked: boolean;
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

export interface GoldilocksApproachGateCheck {
  allowed: boolean;
  reclaimed: boolean;
  approachDisplacementAtr: number;
  touchRangeAtr: number;
  reason: string;
}

export const validateGoldilocksZoneApproach = (
  zone: GoldilocksZone,
  candles: StrategyCandle[],
  touchIndex: number,
  thresholds: Pick<
    GoldilocksBacktestTweaks,
    | "adverseApproachCandles"
    | "minimumFastApproachAtr"
    | "minimumFastTouchRangeAtr"
  > = GOLDILOCKS_ENTRY_PROXIMITY,
): GoldilocksApproachGateCheck => {
  const touch = candles[touchIndex];
  const priorAtr = atrAt(candles, touchIndex - 1) ?? 0;
  if (!touch || priorAtr <= 0)
    return {
      allowed: true,
      reclaimed: false,
      approachDisplacementAtr: 0,
      touchRangeAtr: 0,
      reason:
        "Insufficient completed M5 history for the adverse-approach ATR gate.",
    };
  const approachStart = Math.max(
    0,
    touchIndex - Math.floor(thresholds.adverseApproachCandles),
  );
  const startPrice = candles[approachStart]?.open ?? touch.open;
  const adverseDisplacement =
    zone.side === "demand"
      ? Math.max(0, startPrice - touch.close)
      : Math.max(0, touch.close - startPrice);
  const approachDisplacementAtr = adverseDisplacement / priorAtr;
  const touchRangeAtr = Math.max(0, touch.high - touch.low) / priorAtr;
  const reclaimed =
    zone.side === "demand" ? touch.close > zone.high : touch.close < zone.low;
  const adverse =
    approachDisplacementAtr >=
      thresholds.minimumFastApproachAtr &&
    touchRangeAtr >= thresholds.minimumFastTouchRangeAtr;
  const allowed = reclaimed || !adverse;
  return {
    allowed,
    reclaimed,
    approachDisplacementAtr,
    touchRangeAtr,
    reason: reclaimed
      ? `Fast M5 wick sweep reclaimed the ${zone.side} proximal edge on the touch close; absorption exception passed.`
      : allowed
        ? `M5 approach passed: ${approachDisplacementAtr.toFixed(2)} ATR approach and ${touchRangeAtr.toFixed(2)} ATR touch.`
        : `Adverse M5 approach rejected: ${approachDisplacementAtr.toFixed(2)} ATR approach and ${touchRangeAtr.toFixed(2)} ATR touch without a proximal reclaim.`,
  };
};

export const validateGoldilocksFirstTouchCandle = (
  zone: GoldilocksZone,
  touchCandle: StrategyCandle,
  thresholds: Pick<
    GoldilocksBacktestTweaks,
    "maxTouchRangeZoneFraction"
  > = GOLDILOCKS_ENTRY_PROXIMITY,
): GoldilocksFirstTouchCheck => {
  const width = Math.max(Number.EPSILON, zone.width);
  const touchRange = Math.max(0, touchCandle.high - touchCandle.low);
  const touchRangeZoneFraction = touchRange / width;
  const percent = (value: number) => (value * 100).toFixed(1);
  return {
    allowed: true,
    touchRange,
    touchRangeZoneFraction,
    maxTouchRangeZoneFraction:
      thresholds.maxTouchRangeZoneFraction,
    reason: `First M5 touch range ${percent(touchRangeZoneFraction)}% of the M15 zone width; touch-candle size is diagnostic only and does not reject the setup.`,
  };
};

export const validateGoldilocksEntryProximity = (
  zone: GoldilocksZone,
  touchCandle: StrategyCandle,
  confirmationClose: number,
  executableEntry?: number,
  thresholds: Pick<
    GoldilocksBacktestTweaks,
    "maxTouchRangeZoneFraction" | "maxEntryDistanceZoneFraction"
  > = GOLDILOCKS_ENTRY_PROXIMITY,
): GoldilocksEntryProximityCheck => {
  const width = Math.max(Number.EPSILON, zone.width);
  const firstTouch = validateGoldilocksFirstTouchCandle(zone, touchCandle, thresholds);
  const touchRange = firstTouch.touchRange;
  const outsideDistance = (price: number) =>
    zone.side === "demand"
      ? Math.max(0, price - zone.high)
      : Math.max(0, zone.low - price);
  const confirmationDistance = outsideDistance(confirmationClose);
  const executableChecked = Number.isFinite(executableEntry);
  const executableDistance = executableChecked
    ? outsideDistance(executableEntry!)
    : 0;
  const touchRangeZoneFraction = firstTouch.touchRangeZoneFraction;
  const confirmationDistanceZoneFraction = confirmationDistance / width;
  const executableDistanceZoneFraction = executableDistance / width;
  const executableAllowed =
    executableDistanceZoneFraction <=
    thresholds.maxEntryDistanceZoneFraction;
  const allowed = !executableChecked || executableAllowed;
  const percent = (value: number) => (value * 100).toFixed(1);
  const reason = executableChecked && !executableAllowed
      ? `The executable entry moved ${percent(executableDistanceZoneFraction)}% of one M15 zone width beyond the proximal edge; maximum ${percent(thresholds.maxEntryDistanceZoneFraction)}%.`
      : executableChecked
        ? `First M5 touch range ${percent(touchRangeZoneFraction)}% (diagnostic only); executable-entry distance ${percent(executableDistanceZoneFraction)}% of the M15 zone width.`
        : `First M5 touch range ${percent(touchRangeZoneFraction)}% (diagnostic only); executable bid/ask will be checked immediately before entry.`;
  return {
    allowed,
    touchRange,
    touchRangeZoneFraction,
    confirmationDistance,
    confirmationDistanceZoneFraction,
    executableDistance,
    executableDistanceZoneFraction,
    executableChecked,
    maxTouchRangeZoneFraction:
      thresholds.maxTouchRangeZoneFraction,
    maxEntryDistanceZoneFraction:
      thresholds.maxEntryDistanceZoneFraction,
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
  side: "demand" | "supply";
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
  /** @deprecated Retained only to deserialize legacy stored runs. */
  maxPenetration: number;
  /** @deprecated Retained only to deserialize legacy stored runs. */
  touchPenetrations?: number[];
  state: GoldilocksZoneState;
  invalidatedAt?: number;
  expiredAt?: number;
  firstTouchIndex?: number;
  reasons: string[];
  timeframeConfluence?: ZoneTimeframeConfluence;
  zoneFamily?: "swing" | "imbalance-balance";
  imbalancePattern?:
    | "up-balance-up"
    | "down-balance-down"
    | "up-balance-down"
    | "down-balance-up";
  balanceMetrics?: {
    candleCount: number;
    bodyWidthAtr: number;
    wickWidthAtr: number;
    closeContainmentFraction: number;
    medianBodyOverlapFraction: number;
    driftAtr: number;
    arrivalDirection: GoldilocksDirection;
    departureDirection: GoldilocksDirection;
    arrivalRangeAtr: number;
    departureRangeAtr: number;
    departureBodyFraction: number;
    departureCloseLocation: number;
  };
}
export const stableZoneLegKey=(direction:string,startTime:number,endTime:number)=>`${direction}-${startTime}-${endTime}`;

export interface GoldilocksDepartureQuality {
  departureCandleTime: number;
  departureCandleIndex: number;
  candleRange: number;
  priorAtr14?: number;
  rangeAtrMultiple?: number;
  bodyFraction: number;
  rejectionWickFraction: number;
  closeDepartureZoneMultiple: number;
  wickDepartureZoneMultiple: number;
  shockRejected: boolean;
  reason: string;
}

export interface GoldilocksDepartureQualityCheck {
  allowed: boolean;
  reason: string;
  quality?: GoldilocksDepartureQuality;
}

const countDepartureShockWarnings = (
  rangeAtrMultiple: number,
  rejectionWickFraction: number,
  closeDepartureZoneMultiple: number,
  thresholds: Pick<
    GoldilocksBacktestTweaks,
    | "shockRangeAtrMultiple"
    | "rejectionWickFraction"
    | "minimumShockCloseDepartureZoneMultiple"
  >,
) =>
  Number(rangeAtrMultiple >= thresholds.shockRangeAtrMultiple) +
  Number(rejectionWickFraction >= thresholds.rejectionWickFraction) +
  Number(
    closeDepartureZoneMultiple <
      thresholds.minimumShockCloseDepartureZoneMultiple,
  );

export const getGoldilocksZoneFormationWindow = (
  zone: GoldilocksZone,
  zoneTimeframeSeconds: number,
) => ({
  start: zone.candleTime,
  end:
    (zone.departureQuality?.departureCandleTime ??
      zone.availableAt ??
      zone.candleTime) + Math.max(1, zoneTimeframeSeconds),
});

export const findGoldilocksZoneDistalBreakTime = (
  zone: Pick<GoldilocksZone, "side" | "low" | "high" | "candleTime">,
  candles: StrategyCandle[],
) =>
  candles.find(
    (candle) =>
      candle.time > zone.candleTime &&
      (zone.side === "demand"
        ? candle.low < zone.low
        : candle.high > zone.high),
  )?.time;

export const validateGoldilocksDepartureQuality = (
  zone: GoldilocksZone,
  thresholds: Pick<
    GoldilocksBacktestTweaks,
    | "shockRangeAtrMultiple"
    | "rejectionWickFraction"
    | "minimumShockCloseDepartureZoneMultiple"
  > = GOLDILOCKS_DEPARTURE_QUALITY,
): GoldilocksDepartureQualityCheck => {
  const quality = zone.departureQuality;
  if (!quality || quality.rangeAtrMultiple === undefined) {
    return {
      allowed: true,
      quality,
      reason:
        "Departure shock metrics are unavailable; no shock-rejection pattern was identified.",
    };
  }
  const warningCount = countDepartureShockWarnings(
    quality.rangeAtrMultiple,
    quality.rejectionWickFraction,
    quality.closeDepartureZoneMultiple,
    thresholds,
  );
  const warned = warningCount >= 2;
  return {
    allowed: true,
    quality: { ...quality, shockRejected: warned },
    reason: warned
      ? `Departure warning diagnostic: ${warningCount}/3 conditions matched · ${quality.rangeAtrMultiple.toFixed(2)}x ATR range · ${(quality.rejectionWickFraction * 100).toFixed(1)}% rejection wick · ${quality.closeDepartureZoneMultiple.toFixed(2)}x zone-width close displacement. This is scored evidence, not a hard rejection.`
      : quality.reason,
  };
};

export interface GoldilocksIntrabarDepartureSpeed {
  fastestCandleTime: number;
  fastestCandleRange: number;
  priorAtr14?: number;
  rangeAtrMultiple?: number;
  departureRangeFraction: number;
}

export const measureGoldilocksIntrabarDepartureSpeed = (
  zone: GoldilocksZone,
  intrabarCandles: StrategyCandle[],
  zoneTimeframeSeconds = 15 * 60,
): GoldilocksIntrabarDepartureSpeed | undefined => {
  const quality = zone.departureQuality;
  if (!quality) return undefined;
  const ordered = [...intrabarCandles].sort(
    (left, right) => left.time - right.time,
  );
  const inside = ordered.filter(
    (candle) =>
      candle.time >= quality.departureCandleTime &&
      candle.time < quality.departureCandleTime + zoneTimeframeSeconds,
  );
  if (!inside.length) return undefined;
  const fastest = inside.reduce((best, candle) =>
    candle.high - candle.low > best.high - best.low ? candle : best,
  );
  const before = ordered
    .filter((candle) => candle.time < quality.departureCandleTime)
    .slice(-14);
  const priorAtr14 =
    before.length === 14
      ? before.reduce((total, candle, index) => {
          const previousClose =
            index > 0 ? before[index - 1].close : candle.open;
          return (
            total +
            Math.max(
              candle.high - candle.low,
              Math.abs(candle.high - previousClose),
              Math.abs(candle.low - previousClose),
            )
          );
        }, 0) / 14
      : undefined;
  const fastestCandleRange = fastest.high - fastest.low;
  return {
    fastestCandleTime: fastest.time,
    fastestCandleRange,
    priorAtr14,
    rangeAtrMultiple:
      priorAtr14 && priorAtr14 > 0
        ? fastestCandleRange / priorAtr14
        : undefined,
    departureRangeFraction:
      quality.candleRange > 0 ? fastestCandleRange / quality.candleRange : 0,
  };
};

export interface ZoneTimeframeConfluence {
  timeframes: string[];
  timeframeCount: number;
  overlaps: Array<{
    timeframe: string;
    zoneId: string;
    relationship: "inside" | "contains" | "overlaps";
    low: number;
    high: number;
  }>;
}

export const annotateTimeframeConfluence = (
  zones: GoldilocksZone[],
  zoneTimeframe: string,
  timeframeZones: Array<{ timeframe: string; zones: GoldilocksZone[] }>,
): GoldilocksZone[] =>
  zones.map((zone) => {
    const overlaps = timeframeZones.flatMap((group) =>
      group.zones
        .filter(
          (other) =>
            other.state !== "invalidated" &&
            other.state !== "expired" &&
            other.side === zone.side &&
            other.high >= zone.low &&
            other.low <= zone.high,
        )
        .map((other) => ({
          timeframe: group.timeframe,
          zoneId: other.id,
          relationship: (zone.low >= other.low && zone.high <= other.high
            ? "inside"
            : other.low >= zone.low && other.high <= zone.high
              ? "contains"
              : "overlaps") as "inside" | "contains" | "overlaps",
          low: other.low,
          high: other.high,
        })),
    );
    const timeframes = [
      zoneTimeframe,
      ...overlaps.map((item) => item.timeframe),
    ].filter((item, index, items) => items.indexOf(item) === index);
    return {
      ...zone,
      timeframeConfluence: {
        timeframes,
        timeframeCount: timeframes.length,
        overlaps,
      },
    };
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
  direction: "buy" | "sell";
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

export const getDrawableGoldilocksZones = (zones: GoldilocksZone[]) =>
  zones.filter((zone) => zone.kind === "base");

export const getMostRecentActiveOpposingZone = (
  entryZone: GoldilocksZone,
  knownZones: GoldilocksZone[],
  knownZonesUsableAtEntry = false,
) =>
  knownZones
    .filter(
      (zone) =>
        zone.id !== entryZone.id &&
        zone.side !== entryZone.side &&
        (knownZonesUsableAtEntry ||
          (zone.state !== "invalidated" && zone.state !== "expired")),
    )
    .sort((a, b) => b.candleTime - a.candleTime)[0];

export const getMostRecentActiveOpposingBase = (
  entryZone: GoldilocksZone,
  knownZones: GoldilocksZone[],
  knownZonesUsableAtEntry = false,
) =>
  knownZones
    .filter(
      (zone) =>
        zone.id !== entryZone.id &&
        zone.kind === "base" &&
        zone.side !== entryZone.side &&
        (knownZonesUsableAtEntry ||
          (zone.state !== "invalidated" && zone.state !== "expired")),
    )
    .sort((a, b) => b.candleTime - a.candleTime)[0];

const isOpposite = (candle: StrategyCandle, direction: GoldilocksDirection) =>
  direction === "bullish"
    ? candle.close < candle.open
    : candle.close > candle.open;

const rangesOverlap = (a: StrategyCandle, b: StrategyCandle) =>
  Math.max(a.low, b.low) <= Math.min(a.high, b.high);

const bodiesOverlap = (a: StrategyCandle, b: StrategyCandle) =>
  Math.max(Math.min(a.open, a.close), Math.min(b.open, b.close)) <
  Math.min(Math.max(a.open, a.close), Math.max(b.open, b.close));

const candleRange = (candle: StrategyCandle) => candle.high - candle.low;

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

const median = (values: number[]) => {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
};

export const annotateResearchZoneLifecycleAt = (
  zone: GoldilocksZone,
  candles: StrategyCandle[],
  completedBefore: number,
  candleSeconds = 15 * 60,
): GoldilocksZone => {
  const copy: GoldilocksZone = {
    ...zone,
    touches: 0,
    maxPenetration: 0,
    state: "fresh",
    invalidatedAt: undefined,
    firstTouchIndex: undefined,
  };
  const availableAt = copy.availableAt ?? copy.candleTime;
  let startIndex = 0;
  let insideVisit = false;
  while (startIndex < candles.length && candles[startIndex].time < availableAt)
    startIndex += 1;
  for (let index = startIndex; index < candles.length; index += 1) {
    const candle = candles[index];
    if (candle.time + candleSeconds > completedBefore) break;
    const invalid =
      copy.side === "demand" ? candle.low < copy.low : candle.high > copy.high;
    if (invalid) {
      copy.state = "invalidated";
      copy.invalidatedAt = candle.time;
      break;
    }
    if (candle.high < copy.low || candle.low > copy.high) {
      insideVisit = false;
      continue;
    }
    if (insideVisit) continue;
    insideVisit = true;
    copy.state = "touched";
    copy.touches += 1;
    copy.firstTouchIndex ??= index;
    if (copy.touches > 3) {
      copy.state = "invalidated";
      copy.invalidatedAt = candle.time;
      break;
    }
  }
  return copy;
};

const measureImbalanceCandle = (
  candles: StrategyCandle[],
  candleIndex: number,
):
  | {
      direction: GoldilocksDirection;
      rangeAtr: number;
      bodyFraction: number;
      closeLocation: number;
    }
  | undefined => {
  const candle = candles[candleIndex];
  const atr = candleIndex > 0 ? atrAt(candles, candleIndex - 1) : undefined;
  const range = candle.high - candle.low;
  if (!atr || atr <= 0 || range <= 0) return undefined;
  const bodyFraction = Math.abs(candle.close - candle.open) / range;
  const closeLocation = (candle.close - candle.low) / range;
  const direction: GoldilocksDirection =
    candle.close > candle.open
      ? "bullish"
      : candle.close < candle.open
        ? "bearish"
        : undefined!;
  if (
    !direction ||
    range / atr < GOLDILOCKS_BALANCE_DETECTION.minimumImbalanceRangeAtr ||
    bodyFraction < GOLDILOCKS_BALANCE_DETECTION.minimumImbalanceBodyFraction
  )
    return undefined;
  const directionalClose =
    direction === "bullish"
      ? closeLocation >=
        GOLDILOCKS_BALANCE_DETECTION.minimumDirectionalCloseLocation
      : closeLocation <=
        1 - GOLDILOCKS_BALANCE_DETECTION.minimumDirectionalCloseLocation;
  return directionalClose
    ? { direction, rangeAtr: range / atr, bodyFraction, closeLocation }
    : undefined;
};

const measureImbalanceSequence = (
  candles: StrategyCandle[],
  startIndex: number,
  referenceAtr: number,
) => {
  const first = candles[startIndex];
  if (!first || referenceAtr <= 0) return undefined;
  const direction: GoldilocksDirection =
    first.close > first.open
      ? "bullish"
      : first.close < first.open
        ? "bearish"
        : undefined!;
  if (!direction) return undefined;
  let high = first.high,
    low = first.low;
  for (let endIndex = startIndex; endIndex < candles.length; endIndex += 1) {
    const candle = candles[endIndex];
    const candleDirection =
      candle.close > candle.open
        ? "bullish"
        : candle.close < candle.open
          ? "bearish"
          : undefined;
    if (candleDirection !== direction) break;
    high = Math.max(high, candle.high);
    low = Math.min(low, candle.low);
    const range = high - low;
    if (range <= 0) continue;
    const bodyFraction = Math.abs(candle.close - first.open) / range;
    const closeLocation = (candle.close - low) / range;
    const directionalClose =
      direction === "bullish"
        ? closeLocation >=
          GOLDILOCKS_BALANCE_DETECTION.minimumDirectionalCloseLocation
        : closeLocation <=
          1 - GOLDILOCKS_BALANCE_DETECTION.minimumDirectionalCloseLocation;
    if (
      range / referenceAtr >=
        GOLDILOCKS_BALANCE_DETECTION.minimumImbalanceRangeAtr &&
      bodyFraction >=
        GOLDILOCKS_BALANCE_DETECTION.minimumImbalanceBodyFraction &&
      directionalClose
    ) {
      return {
        direction,
        rangeAtr: range / referenceAtr,
        bodyFraction,
        closeLocation,
        endIndex,
        open: first.open,
        high,
        low,
        close: candle.close,
      };
    }
  }
  return undefined;
};

/**
 * Finds research-only imbalance -> adaptive balance -> imbalance zones without
 * waiting for a swing/structure break. The balance may contain any number of
 * candles; it survives only while price acceptance remains compact relative to ATR.
 */
export const detectGoldilocksImbalanceBalanceZones = (
  candles: StrategyCandle[],
  candleSeconds = 15 * 60,
): GoldilocksZone[] => {
  const timeframeLabel =
    candleSeconds % 3600 === 0
      ? `H${candleSeconds / 3600}`
      : `M${candleSeconds / 60}`;
  const zones: GoldilocksZone[] = [];
  for (
    let arrivalIndex = 14;
    arrivalIndex <
    candles.length - GOLDILOCKS_BALANCE_DETECTION.minimumBalanceCandles - 1;
    arrivalIndex += 1
  ) {
    const arrival = measureImbalanceCandle(candles, arrivalIndex);
    if (!arrival) continue;
    const referenceAtr = atrAt(candles, arrivalIndex - 1);
    if (!referenceAtr || referenceAtr <= 0) continue;
    const balanceIndices: number[] = [];
    let acceptedInside = 0;
    let departureIndex = -1;
    let departureEndIndex = -1;
    let departure: ReturnType<typeof measureImbalanceSequence>;

    for (let index = arrivalIndex + 1; index < candles.length; index += 1) {
      const candle = candles[index];
      if (
        balanceIndices.length >=
        GOLDILOCKS_BALANCE_DETECTION.minimumBalanceCandles
      ) {
        const candidateDeparture = measureImbalanceSequence(
          candles,
          index,
          referenceAtr,
        );
        const bodyLow = Math.min(
          ...balanceIndices.map((item) =>
            Math.min(candles[item].open, candles[item].close),
          ),
        );
        const bodyHigh = Math.max(
          ...balanceIndices.map((item) =>
            Math.max(candles[item].open, candles[item].close),
          ),
        );
        const startsBeyond =
          candidateDeparture?.direction === "bullish"
            ? candle.close > bodyHigh
            : candidateDeparture?.direction === "bearish"
              ? candle.close < bodyLow
              : false;
        const closesBeyond =
          candidateDeparture?.direction === "bullish"
            ? candidateDeparture.close >=
              bodyHigh +
                referenceAtr *
                  GOLDILOCKS_BALANCE_DETECTION.minimumDepartureCloseBeyondBodyAtr
            : candidateDeparture?.direction === "bearish"
              ? candidateDeparture.close <=
                bodyLow -
                  referenceAtr *
                    GOLDILOCKS_BALANCE_DETECTION.minimumDepartureCloseBeyondBodyAtr
              : false;
        if (candidateDeparture && startsBeyond && closesBeyond) {
          departureIndex = index;
          departureEndIndex = candidateDeparture.endIndex;
          departure = candidateDeparture;
          break;
        }
      }

      if (!balanceIndices.length) {
        balanceIndices.push(index);
        acceptedInside += 1;
        continue;
      }
      const existingBodyLow = Math.min(
        ...balanceIndices.map((item) =>
          Math.min(candles[item].open, candles[item].close),
        ),
      );
      const existingBodyHigh = Math.max(
        ...balanceIndices.map((item) =>
          Math.max(candles[item].open, candles[item].close),
        ),
      );
      const bodyLow = Math.min(candle.open, candle.close);
      const bodyHigh = Math.max(candle.open, candle.close);
      const bodySize = Math.max(Number.EPSILON, bodyHigh - bodyLow);
      const overlap = Math.max(
        0,
        Math.min(existingBodyHigh, bodyHigh) -
          Math.max(existingBodyLow, bodyLow),
      );
      const overlapFraction =
        overlap /
        Math.min(
          bodySize,
          Math.max(Number.EPSILON, existingBodyHigh - existingBodyLow),
        );
      const closeAccepted =
        candle.close >=
          existingBodyLow -
            referenceAtr *
              GOLDILOCKS_BALANCE_DETECTION.closeAcceptanceToleranceAtr &&
        candle.close <=
          existingBodyHigh +
            referenceAtr *
              GOLDILOCKS_BALANCE_DETECTION.closeAcceptanceToleranceAtr;
      const prospective = [...balanceIndices, index];
      const prospectiveBodyLow = Math.min(
        ...prospective.map((item) =>
          Math.min(candles[item].open, candles[item].close),
        ),
      );
      const prospectiveBodyHigh = Math.max(
        ...prospective.map((item) =>
          Math.max(candles[item].open, candles[item].close),
        ),
      );
      const prospectiveWickLow = Math.min(
        ...prospective.map((item) => candles[item].low),
      );
      const prospectiveWickHigh = Math.max(
        ...prospective.map((item) => candles[item].high),
      );
      const drift = Math.abs(candle.close - candles[balanceIndices[0]].close);
      const remainsBalanced =
        (overlapFraction >=
          GOLDILOCKS_BALANCE_DETECTION.minimumBodyOverlapFraction ||
          closeAccepted) &&
        (prospectiveBodyHigh - prospectiveBodyLow) / referenceAtr <=
          GOLDILOCKS_BALANCE_DETECTION.maximumBalanceBodyWidthAtr &&
        (prospectiveWickHigh - prospectiveWickLow) / referenceAtr <=
          GOLDILOCKS_BALANCE_DETECTION.maximumBalanceWickWidthAtr &&
        drift / referenceAtr <=
          GOLDILOCKS_BALANCE_DETECTION.maximumBalanceDriftAtr;
      if (!remainsBalanced) break;
      balanceIndices.push(index);
      if (closeAccepted) acceptedInside += 1;
    }

    if (departureIndex < 0 || !departure) continue;
    const balanceCandles = balanceIndices.map((index) => candles[index]);
    const bodyLow = Math.min(
      ...balanceCandles.map((candle) => Math.min(candle.open, candle.close)),
    );
    const bodyHigh = Math.max(
      ...balanceCandles.map((candle) => Math.max(candle.open, candle.close)),
    );
    const wickLow = Math.min(...balanceCandles.map((candle) => candle.low));
    const wickHigh = Math.max(...balanceCandles.map((candle) => candle.high));
    if (
      balanceCandles.length === 1 &&
      ((bodyHigh - bodyLow) / referenceAtr >
        GOLDILOCKS_BALANCE_DETECTION.maximumSingleBalanceBodyWidthAtr ||
        (wickHigh - wickLow) / referenceAtr >
          GOLDILOCKS_BALANCE_DETECTION.maximumSingleBalanceWickWidthAtr)
    )
      continue;
    const side =
      departure.direction === "bullish"
        ? ("demand" as const)
        : ("supply" as const);
    const low = side === "demand" ? wickLow : bodyLow;
    const high = side === "demand" ? bodyHigh : wickHigh;
    const width = high - low;
    if (width <= 0) continue;
    const arrivalSideOutside =
      arrival.direction === "bullish"
        ? candles[arrivalIndex - 1]?.high < low
        : candles[arrivalIndex - 1]?.low > high;
    const exitIndex = departureEndIndex + 1;
    const exitCandle = candles[exitIndex];
    const holdIndex = exitIndex + 1;
    const holdCandle = candles[holdIndex];
    const departureSideOutside =
      departure.direction === "bullish"
        ? exitCandle?.low > high
        : exitCandle?.high < low;
    const departureSideHeld =
      departure.direction === "bullish"
        ? holdCandle?.low > high
        : holdCandle?.high < low;
    const arrivalCloseStrength =
      arrival.direction === "bullish"
        ? arrival.closeLocation
        : 1 - arrival.closeLocation;
    const departureCloseStrength =
      departure.direction === "bullish"
        ? departure.closeLocation
        : 1 - departure.closeLocation;
    const matchingImpulseSignature =
      departure.rangeAtr / arrival.rangeAtr >=
        GOLDILOCKS_BALANCE_DETECTION.minimumDepartureArrivalRangeRatio &&
      departure.rangeAtr / arrival.rangeAtr <=
        GOLDILOCKS_BALANCE_DETECTION.maximumDepartureArrivalRangeRatio &&
      departure.bodyFraction >=
        arrival.bodyFraction -
          GOLDILOCKS_BALANCE_DETECTION.maximumDepartureBodyFractionDeficit &&
      departureCloseStrength >=
        arrivalCloseStrength -
          GOLDILOCKS_BALANCE_DETECTION.maximumDepartureCloseStrengthDeficit;
    if (
      !arrivalSideOutside ||
      !departureSideOutside ||
      !departureSideHeld ||
      !matchingImpulseSignature
    )
      continue;
    const pattern =
      `${arrival.direction === "bullish" ? "up" : "down"}-balance-${departure.direction === "bullish" ? "up" : "down"}` as NonNullable<
        GoldilocksZone["imbalancePattern"]
      >;
    const departureCandle = {
      time: candles[departureEndIndex].time,
      open: candles[departureIndex].open,
      high: departure.high,
      low: departure.low,
      close: candles[departureEndIndex].close,
    };
    const departureDistance =
      side === "demand"
        ? Math.max(0, exitCandle.close - high)
        : Math.max(0, low - exitCandle.close);
    const wickDepartureDistance =
      side === "demand"
        ? Math.max(0, exitCandle.high - high)
        : Math.max(0, low - exitCandle.low);
    let state: GoldilocksZoneState = "fresh";
    let invalidatedAt: number | undefined;
    let firstTouchIndex: number | undefined;
    let touches = 0;
    let insideVisit = false;
    for (let index = holdIndex + 1; index < candles.length; index += 1) {
      const candle = candles[index];
      const invalid = side === "demand" ? candle.low < low : candle.high > high;
      if (invalid) {
        state = "invalidated";
        invalidatedAt = candle.time;
        break;
      }
      const touched = candle.high >= low && candle.low <= high;
      if (!touched) {
        insideVisit = false;
        continue;
      }
      if (insideVisit) continue;
      insideVisit = true;
      touches += 1;
      state = "touched";
      firstTouchIndex ??= index;
      if (touches > 3) {
        state = "invalidated";
        invalidatedAt = candle.time;
        break;
      }
    }
    const departureRange = departureCandle.high - departureCandle.low;
    const rejectionWick =
      side === "demand"
        ? departureCandle.high -
          Math.max(departureCandle.open, departureCandle.close)
        : Math.min(departureCandle.open, departureCandle.close) -
          departureCandle.low;
    const bodyOverlaps = balanceIndices.slice(1).map((index, offset) => {
      const candle = candles[index];
      const previous = candles[balanceIndices[offset]];
      const candleLow = Math.min(candle.open, candle.close),
        candleHigh = Math.max(candle.open, candle.close);
      const previousLow = Math.min(previous.open, previous.close),
        previousHigh = Math.max(previous.open, previous.close);
      const overlap = Math.max(
        0,
        Math.min(candleHigh, previousHigh) - Math.max(candleLow, previousLow),
      );
      return (
        overlap /
        Math.max(
          Number.EPSILON,
          Math.min(candleHigh - candleLow, previousHigh - previousLow),
        )
      );
    });
    zones.push({
      id: `ibi-${pattern}-${candles[balanceIndices[0]].time}`,
      kind: arrival.direction === departure.direction ? "continuation" : "base",
      side,
      candleIndex: balanceIndices[0],
      candleTime: candles[balanceIndices[0]].time,
      availableAt: holdCandle.time + candleSeconds,
      low,
      high,
      width,
      legMidpoint: (wickLow + wickHigh) / 2,
      legRange: Math.max(
        Number.EPSILON,
        Math.max(candles[arrivalIndex].high, departureCandle.high) -
          Math.min(candles[arrivalIndex].low, departureCandle.low),
      ),
      departureMultiple: departureDistance / width,
      wickDepartureMultiple: wickDepartureDistance / width,
      departureQuality: {
        departureCandleTime: departureCandle.time,
        departureCandleIndex: departureEndIndex,
        candleRange: departureRange,
        priorAtr14: referenceAtr,
        rangeAtrMultiple: departure.rangeAtr,
        bodyFraction: departure.bodyFraction,
        rejectionWickFraction:
          departureRange > 0 ? Math.max(0, rejectionWick) / departureRange : 0,
        closeDepartureZoneMultiple: departureDistance / width,
        wickDepartureZoneMultiple: wickDepartureDistance / width,
        shockRejected: false,
        reason:
          "Research IBI departure passed the adaptive range, body, close-location, and balance-exit measurements.",
      },
      strength2x: departureDistance / width >= 2,
      baseCandleCount: balanceIndices.length,
      brokeOppositeLegIn: false,
      touches,
      maxPenetration: 0,
      state,
      invalidatedAt,
      firstTouchIndex,
      zoneFamily: "imbalance-balance",
      imbalancePattern: pattern,
      balanceMetrics: {
        candleCount: balanceIndices.length,
        bodyWidthAtr: (bodyHigh - bodyLow) / referenceAtr,
        wickWidthAtr: (wickHigh - wickLow) / referenceAtr,
        closeContainmentFraction: acceptedInside / balanceIndices.length,
        medianBodyOverlapFraction: median(bodyOverlaps),
        driftAtr:
          Math.abs(balanceCandles.at(-1)!.close - balanceCandles[0].close) /
          referenceAtr,
        arrivalDirection: arrival.direction,
        departureDirection: departure.direction,
        arrivalRangeAtr: arrival.rangeAtr,
        departureRangeAtr: departure.rangeAtr,
        departureBodyFraction: departure.bodyFraction,
        departureCloseLocation: departure.closeLocation,
      },
      reasons: [
        `Research IBI ${pattern.toUpperCase()} zone drawn from ${balanceIndices.length} adaptively accepted ${timeframeLabel} balance candle(s); no maximum duration is used.`,
        `Balance body width ${((bodyHigh - bodyLow) / referenceAtr).toFixed(2)} ATR; wick width ${((wickHigh - wickLow) / referenceAtr).toFixed(2)} ATR; close containment ${((acceptedInside / balanceIndices.length) * 100).toFixed(1)}%.`,
        `Departure ${departure.rangeAtr.toFixed(2)} ATR with ${(departure.bodyFraction * 100).toFixed(1)}% body and ${(departure.closeLocation * 100).toFixed(1)}% close location; two following ${timeframeLabel} candles completed fully outside the balance.`,
        `Impulse signature retained ${((departure.rangeAtr / arrival.rangeAtr) * 100).toFixed(1)}% of arrival range strength with comparable body efficiency and directional close strength.`,
        "Research display only: this zone does not create live/demo entries or alter the 20-point score.",
      ],
    });
    // A strong candle may depart one balance and simultaneously arrive into the
    // next compact continuation balance, so resume from the end of the impulse.
    arrivalIndex = departureEndIndex - 1;
  }
  return zones;
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
  direction === "bullish"
    ? {
        low: kind === "base" ? legLow : candle.low,
        high: candle.open,
        side: "demand" as const,
      }
    : {
        low: candle.open,
        high: kind === "base" ? legHigh : candle.high,
        side: "supply" as const,
      };

const getOverlappingContinuationCluster = (
  candles: StrategyCandle[],
  seedIndex: number,
  minIndex: number,
  maxIndex: number,
) => {
  const group = [seedIndex];
  let left = seedIndex - 1;
  while (left >= minIndex && bodiesOverlap(candles[left], candles[left + 1])) {
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
  const atr14 =
    kind === "continuation" ? atrAt(candles, candleIndex) : undefined;
  const minimumContinuationWidth =
    atr14 === undefined ? undefined : Math.max(legRange * 0.02, atr14 * 0.5);

  if (width <= 0) return { rejected: "Zone has no measurable width." };
  if (width > legRange * 0.25) {
    return { rejected: "Zone width is greater than 25% of the swing leg." };
  }
  if (
    minimumContinuationWidth !== undefined &&
    width < minimumContinuationWidth
  ) {
    return {
      rejected: `Continuation zone is too thin: ${((width / atr14!) * 100).toFixed(1)}% of ATR(14); minimum width is the greater of 50% ATR(14) or 2% of the swing leg.`,
    };
  }
  if (
    kind === "continuation" &&
    ((leg.direction === "bullish" && bounds.high > midpoint) ||
      (leg.direction === "bearish" && bounds.low < midpoint))
  ) {
    return {
      rejected:
        leg.direction === "bullish"
          ? "Continuation demand is not fully below the 50% discount line."
          : "Continuation supply is not fully above the 50% premium line.",
    };
  }

  const futureIndices = Array.from(
    { length: Math.max(0, leg.endIndex - candleIndex) },
    (_, offset) => candleIndex + 1 + offset,
  );
  const future = futureIndices.map((index) => candles[index]);
  const wickDepartureDistance =
    leg.direction === "bullish"
      ? Math.max(...future.map((item) => item.high), bounds.high) - bounds.high
      : bounds.low - Math.min(...future.map((item) => item.low), bounds.low);
  const closeDepartureDistance =
    leg.direction === "bullish"
      ? Math.max(...future.map((item) => item.close), bounds.high) - bounds.high
      : bounds.low - Math.min(...future.map((item) => item.close), bounds.low);
  const departureMultiple = closeDepartureDistance / width;
  const wickDepartureMultiple = wickDepartureDistance / width;
  const departureCandleIndex =
    futureIndices.find((index) =>
      leg.direction === "bullish"
        ? candles[index].close > bounds.high
        : candles[index].close < bounds.low,
    ) ?? -1;
  const departureCandle =
    departureCandleIndex >= 0 ? candles[departureCandleIndex] : candle;
  const candleRange = Math.max(0, departureCandle.high - departureCandle.low);
  const priorAtr14 =
    departureCandleIndex > 0
      ? atrAt(candles, departureCandleIndex - 1)
      : undefined;
  const rangeAtrMultiple =
    priorAtr14 && priorAtr14 > 0 ? candleRange / priorAtr14 : undefined;
  const bodyFraction =
    candleRange > 0
      ? Math.abs(departureCandle.close - departureCandle.open) / candleRange
      : 0;
  const rejectionWick =
    leg.direction === "bullish"
      ? departureCandle.high -
        Math.max(departureCandle.open, departureCandle.close)
      : Math.min(departureCandle.open, departureCandle.close) -
        departureCandle.low;
  const rejectionWickFraction =
    candleRange > 0 ? Math.max(0, rejectionWick) / candleRange : 0;
  const closeDepartureZoneMultiple =
    leg.direction === "bullish"
      ? Math.max(0, departureCandle.close - bounds.high) / width
      : Math.max(0, bounds.low - departureCandle.close) / width;
  const shockWarningCount =
    rangeAtrMultiple === undefined
      ? 0
      : countDepartureShockWarnings(
          rangeAtrMultiple,
          rejectionWickFraction,
          closeDepartureZoneMultiple,
          GOLDILOCKS_DEPARTURE_QUALITY,
        );
  const shockRejected = shockWarningCount >= 2;
  const departureQuality: GoldilocksDepartureQuality = {
    departureCandleTime: departureCandle.time,
    departureCandleIndex,
    candleRange,
    priorAtr14,
    rangeAtrMultiple,
    bodyFraction,
    rejectionWickFraction,
    closeDepartureZoneMultiple,
    wickDepartureZoneMultiple: wickDepartureMultiple,
    shockRejected,
    reason:
      rangeAtrMultiple === undefined
        ? "Departure quality has insufficient completed M15 history for a prior ATR(14) shock comparison."
        : shockRejected
          ? `Shock/rejection departure rejected: ${shockWarningCount}/3 warnings matched · ${rangeAtrMultiple.toFixed(2)}x ATR range · ${(rejectionWickFraction * 100).toFixed(1)}% rejection wick · ${closeDepartureZoneMultiple.toFixed(2)}x zone-width close displacement.`
          : `Departure quality passed: ${rangeAtrMultiple.toFixed(2)}x ATR range, ${(rejectionWickFraction * 100).toFixed(1)}% rejection wick, and ${closeDepartureZoneMultiple.toFixed(2)}x zone-width close displacement.`,
  };
  const strength2x = departureMultiple >= 2;
  let departureConfirmed = false;
  let touchCountingStarted = false;
  let touches = 0;
  let state: GoldilocksZoneState = "fresh";
  let invalidatedAt: number | undefined;
  let firstTouchIndex: number | undefined;
  let insideVisit = false;

  for (let index = candleIndex + 1; index <= leg.endIndex; index += 1) {
    const current = candles[index];
    const invalid =
      leg.direction === "bullish"
        ? current.low < bounds.low
        : current.high > bounds.high;
    if (invalid) {
      state = "invalidated";
      invalidatedAt = current.time;
      break;
    }
    const moveAway =
      leg.direction === "bullish"
        ? current.high - bounds.high
        : bounds.low - current.low;
    const outside =
      leg.direction === "bullish"
        ? current.low > bounds.high
        : current.high < bounds.low;
    if (outside) {
      touchCountingStarted = true;
      insideVisit = false;
      if (!departureConfirmed && moveAway >= width * 2)
        departureConfirmed = true;
      continue;
    }

    if (!departureConfirmed && moveAway >= width * 2) departureConfirmed = true;

    const touched =
      leg.direction === "bullish"
        ? current.low <= bounds.high
        : current.high >= bounds.low;
    if (touched && touchCountingStarted && !insideVisit) {
      insideVisit = true;
      touches += 1;
      state = "touched";
      firstTouchIndex ??= index;
    }
  }

  const reasons = [
    kind === "base"
      ? leg.direction === "bullish"
        ? "Body boundary comes from the selected opposite candle; distal boundary uses the leg low."
        : "Body boundary comes from the selected opposite candle; distal boundary uses the leg high."
      : leg.direction === "bullish"
        ? "Lowest qualifying opposite-direction continuation candle in discount."
        : "Highest qualifying opposite-direction continuation candle in premium.",
    `Zone width is ${((width / legRange) * 100).toFixed(1)}% of the swing leg.`,
    ...(kind === "continuation" && atr14 !== undefined
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
    maxPenetration: 0,
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
  if (
    leg.startIndex < 0 ||
    leg.endIndex >= candles.length ||
    leg.startIndex >= leg.endIndex
  ) {
    throw new Error("Invalid swing leg indices.");
  }

  const legCandles = candles.slice(leg.startIndex, leg.endIndex + 1);
  const legLow = Math.min(...legCandles.map((candle) => candle.low));
  const legHigh = Math.max(...legCandles.map((candle) => candle.high));
  const midpoint = legLow + (legHigh - legLow) / 2;
  const rejected: GoldilocksDetection["rejected"] = [];
  const zones: GoldilocksZone[] = [];

  let baseSeed = leg.startIndex;
  while (baseSeed >= 0 && !isOpposite(candles[baseSeed], leg.direction))
    baseSeed -= 1;
  const baseGroup = baseSeed >= 0 ? [baseSeed] : [leg.startIndex];
  for (let index = baseSeed - 1; index >= 0; index -= 1) {
    if (
      !isOpposite(candles[index], leg.direction) ||
      !bodiesOverlap(candles[index], candles[index + 1])
    )
      break;
    baseGroup.unshift(index);
  }
  for (let index = baseSeed + 1; index < leg.endIndex; index += 1) {
    if (!isOpposite(candles[index], leg.direction)) break;
    if (!bodiesOverlap(candles[index], candles[index - 1])) break;
    baseGroup.push(index);
  }
  const baseIndex = selectLargestOpposite(candles, baseGroup, leg.direction);
  if (baseIndex === undefined) {
    rejected.push({
      candleIndex: leg.startIndex,
      reason: "Swing base has no opposite-direction candle.",
    });
  } else {
    const base = evaluateZone(
      candles,
      leg,
      "base",
      baseIndex,
      legLow,
      legHigh,
      baseGroup.length,
    );
    if ("rejected" in base)
      rejected.push({ candleIndex: baseIndex, reason: base.rejected });
    else zones.push(base);
  }

  const candidates: GoldilocksZone[] = [];
  const consumed = new Set<number>();
  const continuationStart = Math.max(...baseGroup) + 1;
  for (let index = continuationStart; index < leg.endIndex; index += 1) {
    if (consumed.has(index) || !isOpposite(candles[index], leg.direction))
      continue;
    const group = getOverlappingContinuationCluster(
      candles,
      index,
      leg.startIndex + 1,
      leg.endIndex - 1,
    );
    group.forEach((item) => consumed.add(item));
    const selected = selectLargestOpposite(candles, group, leg.direction);
    if (selected === undefined) continue;
    const result = evaluateZone(
      candles,
      leg,
      "continuation",
      selected,
      legLow,
      legHigh,
      group.length,
    );
    if ("rejected" in result) {
      rejected.push({ candleIndex: selected, reason: result.rejected });
    } else if (result.state === "invalidated") {
      rejected.push({
        candleIndex: selected,
        reason:
          "Continuation broke through its distal boundary before it could remain an active zone.",
      });
    } else {
      const position =
        ((result.low + result.high) / 2 - legLow) / (legHigh - legLow);
      const inContinuationBand =
        leg.direction === "bullish"
          ? position >= 0.25 && position <= 0.49
          : position >= 0.51 && position <= 0.75;
      const baseZone = zones.find((zone) => zone.kind === "base");
      const minimumGap = (legHigh - legLow) * 0.05;
      const separatedFromBase =
        !baseZone ||
        (leg.direction === "bullish"
          ? result.low - baseZone.high >= minimumGap
          : baseZone.low - result.high >= minimumGap);
      if (!inContinuationBand) {
        rejected.push({
          candleIndex: selected,
          reason:
            leg.direction === "bullish"
              ? "Continuation demand midpoint is outside the 25%-49% leg band."
              : "Continuation supply midpoint is outside the mirrored 51%-75% leg band.",
        });
      } else if (!separatedFromBase) {
        rejected.push({
          candleIndex: selected,
          reason:
            "Continuation zone overlaps the base or is within 5% of the leg from it.",
        });
      } else {
        result.reasons.unshift(
          leg.direction === "bullish"
            ? `Zone midpoint is at ${(position * 100).toFixed(1)}% of the leg (25%-49% discount band).`
            : `Zone midpoint is at ${(position * 100).toFixed(1)}% of the leg (51%-75% premium band).`,
        );
        candidates.push(result);
      }
    }
  }

  candidates.sort((a, b) =>
    leg.direction === "bullish" ? a.low - b.low : b.high - a.high,
  );
  if (candidates[0]) {
    const continuation = candidates[0];
    const baseZone = zones.find((zone) => zone.kind === "base");
    if (baseZone) {
      const baseReachedAt = candles.findIndex(
        (candle, index) =>
          index > continuation.candleIndex &&
          index <= leg.endIndex &&
          (leg.direction === "bullish"
            ? candle.low <= baseZone.high
            : candle.high >= baseZone.low),
      );
      if (baseReachedAt >= 0) {
        continuation.state = "invalidated";
        continuation.invalidatedAt = candles[baseReachedAt].time;
        continuation.reasons.push(
          "Price later reached the same-side base, so this continuation is no longer active.",
        );
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
  const trackTouches = options.trackTouches ?? true;
  const byId = new Map<string, GoldilocksZone>();
  const baseByLeg = new Map<string, GoldilocksZone>();

  for (const leg of [...legs].sort((a, b) => a.endIndex - b.endIndex)) {
    const detection = detectGoldilocksZones(candles, leg);
    const legKey=stableZoneLegKey(leg.direction,candles[leg.startIndex]?.time??Number.NaN,candles[leg.endIndex]?.time??Number.NaN);
    const base = detection.zones.find((zone) => zone.kind === "base");
    if (base) baseByLeg.set(legKey, base);
    for (const detected of detection.zones) {
      const zone: GoldilocksZone = {
        ...detected,
        reasons: [...detected.reasons],
      };
      if (zone.state === "touched") zone.state = "fresh";
      zone.touches = 0;
      zone.firstTouchIndex = undefined;
      zone.maxPenetration = 0;
      const relatedBase = baseByLeg.get(legKey);
      let touchCountingStarted = candles
        .slice(zone.candleIndex + 1, leg.endIndex + 1)
        .some((candle) =>
          zone.side === "demand"
            ? candle.low > zone.high
            : candle.high < zone.low,
        );
      let insideVisit = false;
      for (let index = leg.endIndex + 1; index < candles.length; index += 1) {
        const candle = candles[index];
        const invalid =
          zone.side === "demand"
            ? candle.low < zone.low
            : candle.high > zone.high;
        const continuationBaseReached =
          zone.kind === "continuation" &&
          relatedBase &&
          (zone.side === "demand"
            ? candle.low <= relatedBase.high
            : candle.high >= relatedBase.low);
        if (invalid || continuationBaseReached) {
          zone.state = "invalidated";
          zone.invalidatedAt = candle.time;
          zone.reasons.push(
            invalid
              ? "A later candle traded through the distal boundary."
              : "Price later reached the same-side base, invalidating this continuation.",
          );
          break;
        }
        const outside =
          zone.side === "demand"
            ? candle.low > zone.high
            : candle.high < zone.low;
        if (outside) {
          touchCountingStarted = true;
          insideVisit = false;
          continue;
        }
        const touched =
          zone.side === "demand"
            ? candle.low <= zone.high
            : candle.high >= zone.low;
        if (trackTouches && touched && touchCountingStarted && !insideVisit) {
          insideVisit = true;
          zone.state = "touched";
          zone.touches += 1;
          zone.firstTouchIndex ??= index;
          if (zone.touches > 3) {
            zone.state = "invalidated";
            zone.invalidatedAt = candle.time;
            zone.reasons.push(
              "Zone invalidated on its fourth qualifying touch; the maximum is three touches.",
            );
            break;
          }
        }
      }
      byId.set(`${legKey}-${zone.id}`, { ...zone, id: `${legKey}-${zone.id}` });
    }
  }

  const zones = [...byId.values()].sort((a, b) => a.candleTime - b.candleTime);
  const latestCandleTime = candles[candles.length - 1]?.time;
  if (latestCandleTime !== undefined) {
    const cutoff = latestCandleTime-GOLDILOCKS_MAX_ZONE_AGE_SECONDS;
    for (const zone of zones) {
      if (zone.state !== "invalidated" && zone.candleTime < cutoff) {
        zone.state = "expired";
        zone.expiredAt = latestCandleTime;
        zone.reasons.push(
          "Zone expired because it is more than 30 calendar days old.",
        );
      }
    }
  }
  const activeZones = zones.filter(
    (zone) => zone.state !== "invalidated" && zone.state !== "expired",
  );
  const newest = (side: GoldilocksZone["side"]) =>
    activeZones
      .filter((zone) => zone.side === side)
      .sort((a, b) => b.candleTime - a.candleTime)[0];
  return {
    zones,
    activeZones,
    activeDemand: newest("demand"),
    activeSupply: newest("supply"),
  };
};

export const validateTwoToOneRunway = (
  entryZone: GoldilocksZone,
  knownZones: GoldilocksZone[],
  confirmedEntryPrice?: number,
  options?: {
    knownZonesUsableAtEntry?: boolean;
    targetRewardRatio?: number;
    targetOpposingBase?: boolean;
  },
): TradeRunwayCheck => {
  const targetRewardRatio =
    Number.isFinite(options?.targetRewardRatio) &&
    Number(options?.targetRewardRatio) >= 1
      ? Number(options?.targetRewardRatio)
      : 2;
  const direction: TradeRunwayCheck["direction"] =
    entryZone.side === "demand" ? "buy" : "sell";
  const entry =
    confirmedEntryPrice ??
    (direction === "buy" ? entryZone.high : entryZone.low);
  const stopLoss = direction === "buy" ? entryZone.low : entryZone.high;
  const risk = direction === "buy" ? entry - stopLoss : stopLoss - entry;
  const targetBase = options?.targetOpposingBase
    ? getMostRecentActiveOpposingBase(
        entryZone,
        knownZones,
        options.knownZonesUsableAtEntry,
      )
    : undefined;
  const takeProfit = targetBase
    ? direction === "buy"
      ? targetBase.low
      : targetBase.high
    : direction === "buy"
      ? entry + risk * targetRewardRatio
      : entry - risk * targetRewardRatio;
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
      reason:
        "Rejected: engulfing close is beyond the wrong side of the zone stop.",
    };
  }
  if (options?.targetOpposingBase && !targetBase) {
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
      reason:
        "Rejected: no causally available opposing base exists for the fixed target.",
    };
  }
  const selectedReward =
    direction === "buy" ? takeProfit - entry : entry - takeProfit;
  if (selectedReward <= 0) {
    return {
      allowed: false,
      direction,
      entry,
      stopLoss,
      takeProfit,
      risk,
      reward: selectedReward,
      ratio: selectedReward / risk,
      availableReward: 0,
      availableRatio: 0,
      blockingZoneId: targetBase?.id,
      reason: "Rejected: the selected opposing base is not ahead of entry.",
    };
  }
  const selectedRatio = selectedReward / risk;
  if (options?.targetOpposingBase && selectedRatio < 2) {
    return {
      allowed: false,
      direction,
      entry,
      stopLoss,
      takeProfit,
      risk,
      reward: selectedReward,
      ratio: selectedRatio,
      availableReward: selectedReward,
      availableRatio: selectedRatio,
      blockingZoneId: targetBase?.id,
      reason: `Rejected: opposing base offers only ${selectedRatio.toFixed(2)}R; minimum required runway is 2.00R.`,
    };
  }
  const opposingZone = getMostRecentActiveOpposingZone(
    entryZone,
    knownZones,
    options?.knownZonesUsableAtEntry,
  );
  const availableReward = opposingZone
    ? direction === "buy"
      ? Math.max(0, opposingZone.low - entry)
      : Math.max(0, entry - opposingZone.high)
    : Number.POSITIVE_INFINITY;
  const availableRatio = availableReward / risk;
  const blockingZone =
    opposingZone &&
    opposingZone.id !== targetBase?.id &&
    (direction === "buy"
      ? opposingZone.high > entry && opposingZone.low <= takeProfit
      : opposingZone.low < entry && opposingZone.high >= takeProfit)
      ? opposingZone
      : undefined;

  const common = {
    direction,
    entry,
    stopLoss,
    takeProfit,
    risk,
    reward: selectedReward,
    ratio: selectedRatio,
    availableReward,
    availableRatio,
  };
  return blockingZone
    ? {
        ...common,
        allowed: false,
        blockingZoneId: blockingZone.id,
        reason: `Rejected: ${blockingZone.kind} ${blockingZone.side} zone blocks the clear path to ${options?.targetOpposingBase ? "the opposing base" : `1:${targetRewardRatio}`}.`,
      }
    : {
        ...common,
        allowed: true,
        reason: options?.targetOpposingBase
          ? `Clear ${common.ratio.toFixed(2)}R runway to first touch of opposing base ${targetBase!.id}.`
          : opposingZone
          ? `Clear 1:${targetRewardRatio} runway: the most recent active ${opposingZone.kind} ${opposingZone.side} zone begins beyond target.`
          : `Clear 1:${targetRewardRatio} runway: no active opposing Goldilocks zone is currently stored.`,
      };
};

export const validateFinalEntryAfterEngulf = (
  entryZone: GoldilocksZone,
  knownZones: GoldilocksZone[],
  engulfClose: number,
  actualEntryPrice: number,
): FinalEntryCheck => {
  if (entryZone.state === "invalidated" || entryZone.state === "expired") {
    const direction: TradeRunwayCheck["direction"] =
      entryZone.side === "demand" ? "buy" : "sell";
    return {
      allowed: false,
      direction,
      entry: actualEntryPrice,
      actualEntryPrice,
      engulfClose,
      stopLoss: direction === "buy" ? entryZone.low : entryZone.high,
      takeProfit: actualEntryPrice,
      risk: 0,
      reward: 0,
      ratio: 0,
      availableReward: 0,
      availableRatio: 0,
      priceMoved: actualEntryPrice !== engulfClose,
      reason:
        entryZone.state === "expired"
          ? "MISSED - DO NOT CHASE: the entry zone expired after 30 calendar days."
          : "MISSED - DO NOT CHASE: the entry zone broke after confirmation.",
    };
  }
  const check = validateTwoToOneRunway(entryZone, knownZones, actualEntryPrice);
  return {
    ...check,
    engulfClose,
    actualEntryPrice,
    priceMoved: actualEntryPrice !== engulfClose,
    reason: check.allowed
      ? actualEntryPrice === engulfClose
        ? "Final 2:1 check passed at the engulf close."
        : "Final 2:1 check passed again at the current market price."
      : `MISSED - DO NOT CHASE: ${check.reason}`,
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
  const proximity = validateGoldilocksEntryProximity(
    zone,
    touchCandle,
    confirmationClose,
    executableEntry,
  );
  const runway = validateFinalEntryAfterEngulf(
    zone,
    knownZones,
    confirmationClose,
    executableEntry,
  );
  return {
    allowed: proximity.allowed && runway.allowed,
    proximity,
    runway,
    reason: !proximity.allowed ? proximity.reason : runway.reason,
  };
};

export const countZoneTouchesBefore = (
  zone: GoldilocksZone,
  candles: StrategyCandle[],
  stopBeforeIndex: number,
): number => {
  let countingStarted = false;
  let insideVisit = false;
  let touches = 0;
  const availableAt = zone.availableAt ?? zone.candleTime;
  for (
    let index = Math.max(0, zone.candleIndex + 1);
    index < Math.min(stopBeforeIndex, candles.length);
    index += 1
  ) {
    const candle = candles[index];
    if (candle.time <= availableAt) continue;
    const invalid =
      zone.side === "demand" ? candle.low < zone.low : candle.high > zone.high;
    if (invalid) break;
    const outside =
      zone.side === "demand"
        ? candle.close > zone.high
        : candle.close < zone.low;
    if (!countingStarted) {
      if (outside) countingStarted = true;
      continue;
    }
    const touched = candle.high >= zone.low && candle.low <= zone.high;
    if (touched && countingStarted && !insideVisit) {
      touches += 1;
      insideVisit = true;
    }
  }
  return touches;
};

export interface HistoricalZoneTouchState {
  armed: boolean;
  insideVisit: boolean;
  touchCandleIndex: number;
  totalTouches: number;
  touchesBeforeTouch: number;
  invalidated: boolean;
}

export const createHistoricalZoneTouchState = (): HistoricalZoneTouchState => ({
  armed: false,
  insideVisit: false,
  touchCandleIndex: -1,
  totalTouches: 0,
  touchesBeforeTouch: 0,
  invalidated: false,
});

export interface ZoneTimeframeTouchSummary {
  firstOutsideTime?: number;
  departureInsideCandleCount: number;
  touches: number;
  touchDetails: Array<{ time: number; price: number }>;
  invalidated: boolean;
}

export const summarizeZoneTimeframeTouches = (
  zone: GoldilocksZone,
  candles: StrategyCandle[],
  candleSeconds: number,
  completedBefore = Number.POSITIVE_INFINITY,
): ZoneTimeframeTouchSummary => {
  const summary: ZoneTimeframeTouchSummary = {
    departureInsideCandleCount: 0,
    touches: 0,
    touchDetails: [],
    invalidated: false,
  };
  let insideVisit = false;
  for (const candle of candles) {
    if (
      candle.time <= zone.candleTime ||
      candle.time + candleSeconds > completedBefore
    )
      continue;
    const broken =
      zone.side === "demand" ? candle.low < zone.low : candle.high > zone.high;
    if (broken) {
      summary.invalidated = true;
      break;
    }
    const outside =
      zone.side === "demand"
        ? candle.close > zone.high
        : candle.close < zone.low;
    if (summary.firstOutsideTime === undefined) {
      if (outside) {
        summary.firstOutsideTime = candle.time;
        insideVisit = false;
      } else if (candle.high >= zone.low && candle.low <= zone.high)
        summary.departureInsideCandleCount += 1;
      continue;
    }
    const touched = candle.high >= zone.low && candle.low <= zone.high;
    if (!touched) {
      insideVisit = false;
      continue;
    }
    if (insideVisit) continue;
    insideVisit = true;
    summary.touches += 1;
    summary.touchDetails.push({
      time: candle.time,
      price: zone.side === "demand" ? candle.low : candle.high,
    });
    if (summary.touches > 3) {
      summary.invalidated = true;
      break;
    }
  }
  return summary;
};

/**
 * Finds the first completed confirmation-timeframe candle that closes beyond the
 * zone, then counts every later completed confirmation candle intersecting it.
 * Consecutive touching candles count individually. The trigger candle is
 * excluded by passing its open time as completedBefore.
 */
export const summarizeConfirmationTimeframeTouches = (
  zone: GoldilocksZone,
  candles: StrategyCandle[],
  candleSeconds: number,
  completedBefore = Number.POSITIVE_INFINITY,
  maximumTouches = 3,
): ZoneTimeframeTouchSummary => {
  const summary: ZoneTimeframeTouchSummary = {
    departureInsideCandleCount: 0,
    touches: 0,
    touchDetails: [],
    invalidated: false,
  };
  for (const candle of candles) {
    if (
      candle.time <= zone.candleTime ||
      candle.time + candleSeconds > completedBefore
    )
      continue;
    const broken =
      zone.side === "demand" ? candle.low < zone.low : candle.high > zone.high;
    if (broken) {
      summary.invalidated = true;
      break;
    }
    const outside =
      zone.side === "demand"
        ? candle.close > zone.high
        : candle.close < zone.low;
    if (summary.firstOutsideTime === undefined) {
      if (outside) summary.firstOutsideTime = candle.time;
      continue;
    }
    const touched = candle.high >= zone.low && candle.low <= zone.high;
    if (!touched) continue;
    summary.touches += 1;
    summary.touchDetails.push({
      time: candle.time,
      price: zone.side === "demand" ? candle.low : candle.high,
    });
    if (summary.touches > maximumTouches) summary.invalidated = true;
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
  const outside =
    zone.side === "demand" ? candle.low > zone.high : candle.high < zone.low;
  const touched = candle.high >= zone.low && candle.low <= zone.high;
  if (outside) {
    state.armed = true;
    state.insideVisit = false;
  }
  if (!touched || !state.armed || state.insideVisit) return state;
  state.insideVisit = true;
  state.touchesBeforeTouch = state.totalTouches;
  state.totalTouches += 1;
  state.touchCandleIndex = candleIndex;
  state.invalidated = state.totalTouches > 3;
  return state;
};

export const findFullCandleEngulfing = (
  candles: StrategyCandle[],
  direction: GoldilocksDirection,
  startIndex = 1,
): EngulfingConfirmation => {
  for (
    let index = Math.max(1, startIndex);
    index < candles.length;
    index += 1
  ) {
    const previous = candles[index - 1];
    const current = candles[index];
    if (
      direction === "bullish" &&
      previous.close < previous.open &&
      current.close > current.open &&
      current.high > previous.high &&
      current.low < previous.low &&
      current.close > previous.high
    ) {
      return {
        confirmed: true,
        candleIndex: index,
        reason: "Bullish candle engulfed the complete prior bearish candle.",
      };
    }
    if (
      direction === "bearish" &&
      previous.close > previous.open &&
      current.close < current.open &&
      current.high > previous.high &&
      current.low < previous.low &&
      current.close < previous.low
    ) {
      return {
        confirmed: true,
        candleIndex: index,
        reason: "Bearish candle engulfed the complete prior bullish candle.",
      };
    }
  }
  return {
    confirmed: false,
    reason: "No complete lower-timeframe candle engulfing was found.",
  };
};

export const findCloseBeyondTouchedCandle = (
  candles: StrategyCandle[],
  direction: GoldilocksDirection,
  touchCandleIndex: number,
  startIndex = touchCandleIndex + 1,
): EngulfingConfirmation => {
  const touched = candles[touchCandleIndex];
  if (!touched)
    return {
      confirmed: false,
      reason: "The touched candle could not be found.",
    };
  for (
    let index = Math.max(touchCandleIndex + 1, startIndex);
    index < candles.length;
    index += 1
  ) {
    const current = candles[index];
    if (
      direction === "bullish" &&
      current.close > current.open &&
      current.close > touched.high
    ) {
      return {
        confirmed: true,
        candleIndex: index,
        reason:
          "Bullish confirmation closed above the touched candle wick high.",
      };
    }
    if (
      direction === "bearish" &&
      current.close < current.open &&
      current.close < touched.low
    ) {
      return {
        confirmed: true,
        candleIndex: index,
        reason:
          "Bearish confirmation closed below the touched candle wick low.",
      };
    }
  }
  return {
    confirmed: false,
    reason:
      direction === "bullish"
        ? "No bullish candle closed above the touched candle wick high."
        : "No bearish candle closed below the touched candle wick low.",
  };
};
