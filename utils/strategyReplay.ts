import {
  summarizeZoneTimeframeTouches,
  type GoldilocksZone,
  type StrategyCandle,
} from "./goldilocksStrategy.ts";
import { zoneUsableAt } from "./goldilocksScanner.ts";

export interface StrategyReplayWindow {
  chartStart: number;
  chartEnd: number;
  confirmationStart: number;
  confirmationEnd: number;
}

export const STRATEGY_REPLAY_BASE_CONTEXT_SECONDS = 12 * 60 * 60;

const formatEpochInZone = (epochSeconds: number, timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      hourCycle: "h23",
      timeZoneName: "short",
    })
      .formatToParts(new Date(epochSeconds * 1000))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${timeZone === "UTC" ? "UTC" : parts.timeZoneName}`;
};

export const formatStrategyReplayUtc = (epochSeconds: number) =>
  formatEpochInZone(epochSeconds, "UTC");
export const formatStrategyReplayNewYork = (epochSeconds: number) =>
  formatEpochInZone(epochSeconds, "America/New_York");
export const ENID_TIME_ZONE = "America/Chicago";
export const formatStrategyReplayEnid = (epochSeconds: number) =>
  formatEpochInZone(epochSeconds, ENID_TIME_ZONE);
const enidChartTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ENID_TIME_ZONE,
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  hourCycle: "h23",
});
export const formatStrategyChartTimeEnid = (epochSeconds: number) =>
  enidChartTimeFormatter.format(new Date(epochSeconds * 1000));

export const annotateReplayZonePurityAt = (
  zone: GoldilocksZone,
  zoneCandles: StrategyCandle[],
  candleSeconds: number,
  completedBefore: number,
): GoldilocksZone => {
  const purity = summarizeZoneTimeframeTouches(
    zone,
    zoneCandles,
    candleSeconds,
    completedBefore,
  );
  return {
    ...zone,
    touches: purity.touches,
    maxPenetration: 0,
    departureInsideCandleCount: purity.departureInsideCandleCount,
  };
};

export const getStrategyReplayBaseContextStart = (zoneBaseTime: number) =>
  zoneBaseTime - STRATEGY_REPLAY_BASE_CONTEXT_SECONDS;

export const buildStoredReplayZoneFallback = (trade: {
  zoneId: string;
  zoneKind: GoldilocksZone["kind"];
  direction: "BUY" | "SELL";
  zoneCandleTime: number;
  firstOutsideTime?: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  priorTouches: number;
  maxPenetration: number;
  demandHigh?: number;
  supplyLow?: number;
}): GoldilocksZone => {
  const low =
    trade.direction === "BUY"
      ? trade.stopLoss
      : (trade.supplyLow ?? trade.entry);
  const high =
    trade.direction === "BUY"
      ? (trade.demandHigh ?? trade.entry)
      : trade.stopLoss;
  return {
    id: trade.zoneId,
    kind: trade.zoneKind,
    side: trade.direction === "BUY" ? "demand" : "supply",
    candleIndex: 0,
    candleTime: trade.zoneCandleTime,
    availableAt: trade.firstOutsideTime ?? trade.zoneCandleTime,
    low,
    high,
    width: high - low,
    legMidpoint: trade.entry,
    legRange: Math.abs(trade.takeProfit - trade.stopLoss),
    departureMultiple: 0,
    strength2x: false,
    touches: trade.priorTouches,
    maxPenetration: trade.maxPenetration,
    state: "fresh",
    reasons: [
      "Replay fallback restored from the immutable stored trade and entry-time zone corridor because current reconstruction did not reproduce the historical zone.",
    ],
  };
};

export const getStrategyReplayContextAnchor = (
  tradeZoneBaseTime: number,
  priorTouchTimes: number[] = [],
  displayedZoneBaseTimes: number[] = [],
): number | undefined => {
  const candidates = [
    tradeZoneBaseTime,
    ...priorTouchTimes,
    ...displayedZoneBaseTimes,
  ].filter(Number.isFinite);
  return candidates.length ? Math.min(...candidates) : undefined;
};

export const getStrategyReplayRequestEnd = (
  requestedEnd: number,
  nowSeconds = Math.floor(Date.now() / 1000),
) => Math.min(requestedEnd, Math.floor(nowSeconds / 60) * 60 - 1);

export const getReplayCandleIndexAtOrBefore = (
  candles: Array<{ time: number }>,
  eventTime: number,
): number => {
  if (!candles.length) return -1;
  let result = 0;
  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index].time > eventTime) break;
    result = index;
  }
  return result;
};

export const getReplayExitMarkerPrice = (trade: {
  exitReason?: string;
  exitPrice?: number;
  runway: { entry: number; stopLoss: number; takeProfit: number };
}) =>
  Number.isFinite(trade.exitPrice)
    ? trade.exitPrice!
    : trade.exitReason === "stop"
      ? trade.runway.stopLoss
      : trade.exitReason === "target"
        ? trade.runway.takeProfit
        : trade.runway.entry;

const formatReplayR = (value: number) =>
  `${value > 0 ? "+" : ""}${value.toFixed(2)}R`;

export const getReplayPartialExitMarkerText = (partial: {
  fraction: number;
  realizedR: number;
}) =>
  `PARTIAL EXIT · ${Math.round(partial.fraction * 100)}% AT +1R · BANKED ${formatReplayR(partial.realizedR)}`;

export const getReplayScaleOutMarkerText = (partial: {
  fraction: number;
  realizedR: number;
  milestoneR?: number;
  momentum?: "fast" | "slow";
}) =>
  `SCALE OUT · ${Math.round(partial.fraction * 100)}% AT +${partial.milestoneR ?? 1}R · BANKED ${formatReplayR(partial.realizedR)}${partial.momentum ? ` · ${partial.momentum.toUpperCase()} ATTACK` : ""}`;

export const getReplayFinalExitMarkerText = (trade: {
  outcome: string;
  exitReason?: string;
  realizedR?: number | null;
  partialExit?: { fraction: number };
  partialExits?: Array<{ fraction: number }>;
}) => {
  const realized =
    trade.realizedR == null ? "" : ` · TOTAL ${formatReplayR(trade.realizedR)}`;
  if (trade.partialExit) {
    const closedFraction = trade.partialExits?.length
      ? trade.partialExits.reduce((sum, partial) => sum + partial.fraction, 0)
      : trade.partialExit.fraction;
    const remaining = Math.round((1 - closedFraction) * 100);
    const location =
      trade.exitReason === "break_even" || trade.exitReason === "one_r_protected"
        ? "AT ENTRY"
        : trade.exitReason === "target"
          ? "AT TARGET"
          : trade.exitReason === "runner_target"
            ? "AT RUNNER TARGET"
            : trade.exitReason === "runner_stop"
              ? "AT RUNNER STOP"
              : trade.exitReason === "stop"
                ? "AT ORIGINAL STOP"
                : (trade.exitReason ?? "closed")
                    .replaceAll("_", " ")
                    .toUpperCase();
    return `FINAL ${remaining}% EXIT · ${location}${realized}`;
  }
  return `FINAL EXIT · ${trade.outcome.toUpperCase()} · ${(trade.exitReason ?? "closed").replaceAll("_", " ").toUpperCase()}${realized}`;
};

export const getReplayVisibleEnd = (
  lastCandleIndex: number,
  entryIndex: number,
  exitIndex: number,
  timeframe?: string,
) => {
  const normalPadding = 20;
  const minimumPostExitBars =
    timeframe === "H1" ? 3 : timeframe === "M15" ? 4 : 6;
  const normalEnd = Math.min(
    lastCandleIndex,
    Math.max(entryIndex, exitIndex) + normalPadding,
  );
  return Math.max(normalEnd, exitIndex + minimumPostExitBars);
};

export const getStrategyReplayForwardPageWindow = (
  after: number,
  timeframeSeconds: number,
  pageCandles = 1500,
) => {
  const safeTimeframeSeconds = Math.max(1, timeframeSeconds);
  const minimumWeekendSpanSeconds = 4 * 24 * 60 * 60;
  return {
    start: after + safeTimeframeSeconds,
    end:
      after +
      Math.max(
        safeTimeframeSeconds * Math.max(1, pageCandles),
        minimumWeekendSpanSeconds,
      ),
  };
};

export const getReplayVisibleStart = (
  zoneBaseIndex: number,
  entryIndex: number,
  exitIndex: number,
  padding = 20,
) => Math.max(0, Math.min(zoneBaseIndex, entryIndex, exitIndex) - padding);

export const sortUniqueReplayCandleItems = <
  T extends { candle: { time: unknown } },
>(
  items: T[],
): T[] => {
  const byTime = new Map<number, T>();
  for (const item of items) byTime.set(Number(item.candle.time), item);
  return [...byTime.values()].sort(
    (left, right) => Number(left.candle.time) - Number(right.candle.time),
  );
};

export const reconcileStoredReplayPriorTouchDetails = <
  T extends { time: number },
>(
  storedTouchCount: number,
  storedFirstOutsideTime: number | undefined,
  tradeTouchTime: number | undefined,
  reconstructedDetails: T[],
): T[] => {
  const causalDetails = reconstructedDetails.filter(
    (detail) =>
      (storedFirstOutsideTime === undefined ||
        detail.time >= storedFirstOutsideTime) &&
      (tradeTouchTime === undefined || detail.time < tradeTouchTime),
  );
  return causalDetails.length === storedTouchCount ? causalDetails : [];
};

export const isStoredReplayZoneMatch = (
  zone: Pick<GoldilocksZone, "id" | "kind" | "side" | "candleTime" | "low" | "high">,
  stored: {
    zoneId: string;
    zoneKind: string;
    direction: string;
    stopLoss: number;
  } | undefined,
) => {
  if (!stored) return false;
  if (zone.id === stored.zoneId) return true;
  const storedCandleTime = Number(stored.zoneId.match(/(\d+)$/)?.[1]);
  return (
    Number.isFinite(storedCandleTime) &&
    zone.kind === stored.zoneKind &&
    zone.side === (stored.direction === "BUY" ? "demand" : "supply") &&
    zone.candleTime === storedCandleTime &&
    Math.abs((zone.side === "demand" ? zone.low : zone.high) - stored.stopLoss) <
      1e-9
  );
};

export const getStrategyReplayZoneFormationDetails = (
  zone: Pick<GoldilocksZone, "side" | "low" | "high" | "candleTime">,
  zoneTimeframeCandles: StrategyCandle[],
  firstOutsideTime: number | undefined,
) =>
  firstOutsideTime === undefined
    ? []
    : zoneTimeframeCandles
        .filter(
          (candle) =>
            candle.time >= zone.candleTime &&
            candle.time < firstOutsideTime &&
            candle.high >= zone.low &&
            candle.low <= zone.high,
        )
        .map((candle) => ({
          time: candle.time,
          price: zone.side === "demand" ? candle.low : candle.high,
        }));

export const filterReplayRejectedFirstTouchesAt = <
  T extends { zoneId: string },
>(
  items: T[],
  zones: GoldilocksZone[],
  displayTime: number,
  displayedZoneIds?: ReadonlySet<string>,
): T[] => {
  const zonesById = new Map(zones.map((zone) => [zone.id, zone]));
  return items.filter((item) => {
    const zone = zonesById.get(item.zoneId);
    return Boolean(
      zone &&
      zoneUsableAt(zone, displayTime) &&
      (!displayedZoneIds || displayedZoneIds.has(item.zoneId)),
    );
  });
};

export const formatStrategyZoneLabel = (zone: {
  historicalTradeZone: boolean;
  historicalContextZone?: boolean;
  kind: "base" | "continuation";
  side: "demand" | "supply";
  departureMultiple: number;
  touches: number;
  zoneFamily?: "swing" | "imbalance-balance";
  imbalancePattern?:
    | "up-balance-up"
    | "down-balance-down"
    | "up-balance-down"
    | "down-balance-up";
  balanceMetrics?: { candleCount: number };
  state?: "fresh" | "touched" | "invalidated" | "expired";
  timeframeConfluence?: { timeframeCount: number; timeframes: string[] };
}) => {
  const prefix = zone.historicalTradeZone
    ? "HISTORY TRADE ZONE · "
    : zone.historicalContextZone
      ? "HISTORY CONTEXT ZONE · "
      : "";
  if (zone.zoneFamily === "imbalance-balance") {
    const pattern =
      zone.imbalancePattern
        ?.split("-")
        .map((part) => (part === "balance" ? "B" : part === "up" ? "U" : "D"))
        .join("") ?? "IBI";
    const lifecycle =
      zone.state === "invalidated"
        ? " · INVALIDATED"
        : zone.state === "expired"
          ? " · EXPIRED"
          : "";
    return `${prefix}RESEARCH IBI ${pattern} ${zone.side} · ${zone.balanceMetrics?.candleCount ?? "?"}-bar balance · ${zone.departureMultiple.toFixed(1)}x · ${zone.touches} touch${zone.touches === 1 ? "" : "es"}${lifecycle}`;
  }
  const zoneKind = zone.kind === "base" ? "Base" : "Continuation";
  const touchLabel = zone.historicalTradeZone
    ? `${zone.touches} prior touch${zone.touches === 1 ? "" : "es"}`
    : `${zone.touches} touch${zone.touches === 1 ? "" : "es"}`;
  const confluence = zone.timeframeConfluence
    ? ` · ZIZ ${zone.timeframeConfluence.timeframeCount}/3${zone.timeframeConfluence.timeframes.length === zone.timeframeConfluence.timeframeCount ? ` · ${zone.timeframeConfluence.timeframes.join("+")}` : ""}`
    : "";
  return `${prefix}${zoneKind} ${zone.side} · ${zone.departureMultiple.toFixed(1)}x · ${touchLabel}${confluence}`;
};

export const getStrategyReplayWindow = (
  confirmationTime: number,
  outcomeTime: number,
  zoneBaseTime?: number,
): StrategyReplayWindow => ({
  chartStart: Number.isFinite(zoneBaseTime)
    ? Math.min(
        confirmationTime - 7 * 24 * 60 * 60,
        getStrategyReplayBaseContextStart(zoneBaseTime!),
      )
    : confirmationTime - 7 * 24 * 60 * 60,
  chartEnd: outcomeTime + 24 * 60 * 60,
  confirmationStart: confirmationTime - 2 * 24 * 60 * 60,
  confirmationEnd: confirmationTime + 12 * 60 * 60,
});
