import {
  determineSwingPoints,
  type Candle,
  type SwingResult,
} from "./swingLabeler.ts";
import {
  annotateConfluenceAt,
  buildGoldilocksHistoryChunked,
  buildGoldilocksLegs,
  buildProtectedStructureTrendTimeline,
  toStrategyCandles,
  zoneUsableAt,
  type GoldilocksTrend,
} from "./goldilocksScanner.ts";
import {
  createHistoricalZoneTouchState,
  getGoldilocksZoneFormationWindow,
  summarizeConfirmationTimeframeTouches,
  validateGoldilocksDepartureQuality,
  validateGoldilocksEntryProximity,
  validateGoldilocksZoneApproach,
  validateTwoToOneRunway,
  type GoldilocksDepartureQualityCheck,
  type GoldilocksEntryProximityCheck,
  type GoldilocksZone,
  type HistoricalZoneTouchState,
  type StrategyCandle,
} from "./goldilocksStrategy.ts";
import { scoreGoldilocksSetup } from "./goldilocksScoring.ts";
import {
  GOLDILOCKS_DEMO_TIMEFRAMES,
  GOLDILOCKS_BACKTEST_GATE_DEFAULTS,
  GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS,
  GOLDILOCKS_TIMEFRAME_SECONDS,
  normalizeGoldilocksBacktestGates,
  type GoldilocksBacktestTweaks,
  type GoldilocksBacktestGates,
  type GoldilocksScoreWeights,
  type GoldilocksTimeframeContract,
} from "./goldilocksConfig.ts";
import type { BacktestTradeInput } from "./backtestStore.ts";
import {
  getGoldilocksZoneAgeSeconds,
  getGoldilocksZoneExpiresAt,
} from "./zoneAge.ts";
import type { HistoricalNewsGateResult } from "./historicalNewsStore.ts";
import {
  getForexHolidayStatusAt,
  isForexMarketOpenAt,
  isForexWeekendEntryBlocked,
  nextForexWeekendLiquidationTime,
} from "./forexMarketHours.ts";
import { measureGoldilocksApproachPressure } from "./approachPressure.ts";
import {
  evaluateGoldilocksManagementPolicies,
  summarizeTradeMarketPath,
} from "./tradeManagementResearch.ts";
import {
  GOLDILOCKS_DEFAULT_MANAGEMENT,
  GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID,
  goldilocksRealizedRAtTarget,
  goldilocksSecuredRAtBreakEven,
  normalizeGoldilocksBacktestManager,
  type GoldilocksBacktestManagerId,
} from "./goldilocksTradeManagement.ts";
import { measureZoneCorridor } from "./zoneCorridor.ts";
import { isTradeSessionOpen } from "./sessionUtils.ts";

export interface GoldilocksBacktestInput {
  runId: string;
  pair: string;
  minimumScore: number;
  zoneCandles: Candle[];
  confirmationCandles: Candle[];
  trendCandles: Candle[];
  outcomeCandles: Candle[];
  timeframes?: GoldilocksTimeframeContract;
  strategyTweaks?: GoldilocksBacktestTweaks;
  gateSettings?: GoldilocksBacktestGates;
  scoreWeights?: GoldilocksScoreWeights;
  tradeManager?: GoldilocksBacktestManagerId;
  onProgress?: (progress: {
    stage: string;
    completed: number;
    total: number;
    percent: number;
  }) => void;
  historicalNewsGate?: (
    pair: string,
    time: number,
    startTime?: number,
  ) => HistoricalNewsGateResult;
  onNewsRejected?: (result: HistoricalNewsGateResult, time: number) => void;
  onProximityRejected?: (
    result: GoldilocksEntryProximityCheck,
    confirmationTime: number,
    touchTime: number,
  ) => void;
  onMarketHoursRejected?: (confirmationTime: number, reason: string) => void;
  onHolidayRejected?: (confirmationTime: number, reason: string) => void;
  onSessionRejected?: (confirmationTime: number, reason: string) => void;
  onDepartureQualityRejected?: (
    result: GoldilocksDepartureQualityCheck,
    confirmationTime: number,
  ) => void;
  onExecutionCoverageRejected?: (
    confirmationTime: number,
    reason: string,
  ) => void;
}
const lastAtOrBefore = <T extends { time: number }>(
  items: T[],
  time: number,
) => {
  let low = 0,
    high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  return low - 1;
};
const firstAtOrAfter = <T extends { time: number }>(
  items: T[],
  time: number,
) => {
  let low = 0,
    high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
};
const expiresAt = getGoldilocksZoneExpiresAt;

interface MarketContextPoint {
  time: number;
  candleIndex: number;
  trend: GoldilocksTrend;
  low: number;
  high: number;
  midpoint: number;
}
const buildMarketContextIndex = (
  candles: Candle[],
  chunkSize = 1_000,
  overlap = 200,
): MarketContextPoint[] => {
  const points: MarketContextPoint[] = [];
  const swingCandidates = new Map<string, SwingResult>();
  const step = Math.max(1, chunkSize - overlap);
  for (let coreStart = 0; coreStart < candles.length; coreStart += step) {
    const sliceStart = Math.max(0, coreStart - overlap);
    const sliceEnd = Math.min(candles.length, coreStart + step + overlap);
    const slice = candles
      .slice(sliceStart, sliceEnd)
      .map((candle, index) => ({ ...candle, candleIndex: index }));
    for (const swing of determineSwingPoints(slice)) {
      const globalIndex = sliceStart + swing.candleIndex;
      if (
        globalIndex < coreStart ||
        globalIndex >= Math.min(candles.length, coreStart + step)
      )
        continue;
      swingCandidates.set(`${globalIndex}:${swing.swing}`, {
        ...swing,
        candleIndex: globalIndex,
      });
    }
    for (const leg of buildGoldilocksLegs(slice)) {
      const globalEnd = sliceStart + leg.endIndex;
      if (
        globalEnd < coreStart ||
        globalEnd >= Math.min(candles.length, coreStart + step)
      )
        continue;
      const completed = slice[leg.endIndex];
      const range = slice.slice(leg.startIndex, leg.endIndex + 1);
      if (!completed || !range.length) continue;
      const low = Math.min(...range.map((candle) => candle.low));
      const high = Math.max(...range.map((candle) => candle.high));
      points.push({
        time: Math.floor(new Date(completed.time).getTime() / 1000),
        candleIndex: globalEnd,
        trend: "unknown",
        low,
        high,
        midpoint: low + (high - low) / 2,
      });
    }
  }
  const normalizedCandles = candles.map((candle, candleIndex) => ({
    ...candle,
    candleIndex,
  }));
  const trendTimeline = buildProtectedStructureTrendTimeline(
    normalizedCandles,
    [...swingCandidates.values()],
  );
  for (const point of points)
    point.trend = trendTimeline[point.candleIndex] ?? "unknown";
  points.sort((left, right) => left.time - right.time);
  const deduped: MarketContextPoint[] = [];
  for (const point of points) {
    if (deduped.at(-1)?.time === point.time)
      deduped[deduped.length - 1] = point;
    else deduped.push(point);
  }
  return deduped;
};
const marketContextAt = (
  index: MarketContextPoint[],
  time: number,
): { trend: GoldilocksTrend } => {
  const position = lastAtOrBefore(index, time);
  const point = position >= 0 ? index[position] : undefined;
  if (!point)
    return { trend: "unknown" };
  return { trend: point.trend };
};
const legacyRunnerFractionForScore = (score?: number) =>
  score == null || score < 16 ? 0 : score < 18 ? 0.25 : 0.5;
const legacyBlendedRunnerR = (
  runnerFraction: number,
  runnerExitR: number,
) => (1 - runnerFraction) * 2 + runnerFraction * runnerExitR;

const resolveLegacyScoreTieredOutcome = (
  candles: StrategyCandle[],
  startIndex: number,
  direction: "BUY" | "SELL",
  stopLoss: number,
  oneR: number,
  takeProfit?: number,
  score?: number,
  weekendLiquidationTime?: number,
) => {
  const entry = (stopLoss + oneR) / 2;
  const risk = Math.abs(entry - stopLoss);
  const target =
    takeProfit ??
    (direction === "BUY" ? entry + risk * 2 : entry - risk * 2);
  const runnerTarget =
    direction === "BUY" ? entry + risk * 4 : entry - risk * 4;
  const runnerFraction = legacyRunnerFractionForScore(score);
  let protectedAt = -1;
  let partialAt = -1;
  for (let index = startIndex; index < candles.length; index += 1) {
    const candle = candles[index];
    if (
      weekendLiquidationTime !== undefined &&
      candle.time >= weekendLiquidationTime
    ) {
      const rawOpenR =
        (direction === "BUY" ? candle.open - entry : entry - candle.open) /
        risk;
      const stopFloor = partialAt >= 0 ? 1 : protectedAt >= 0 ? 0 : -1;
      const boundedOpenR = Math.max(stopFloor, rawOpenR);
      const realizedR =
        partialAt >= 0
          ? legacyBlendedRunnerR(runnerFraction, boundedOpenR)
          : boundedOpenR;
      return {
        outcome: (realizedR > 0 || partialAt >= 0 || protectedAt >= 0
          ? "WIN"
          : "LOSS") as "WIN" | "LOSS",
        outcomeTime: candle.time,
        exitReason: "weekend_close" as const,
        realizedR,
      };
    }
    if (partialAt >= 0) {
      const runnerStopped =
        direction === "BUY" ? candle.low <= oneR : candle.high >= oneR;
      const runnerWon =
        direction === "BUY"
          ? candle.high >= runnerTarget
          : candle.low <= runnerTarget;
      if (runnerStopped)
        return {
          outcome: "WIN" as const,
          outcomeTime: candle.time,
          exitReason: "runner_stop" as const,
          realizedR: legacyBlendedRunnerR(runnerFraction, 1),
        };
      if (runnerWon)
        return {
          outcome: "WIN" as const,
          outcomeTime: candle.time,
          exitReason: "runner_target" as const,
          realizedR: legacyBlendedRunnerR(runnerFraction, 4),
        };
      continue;
    }
    if (protectedAt < 0) {
      const stopped =
        direction === "BUY" ? candle.low <= stopLoss : candle.high >= stopLoss;
      const reachedOneR =
        direction === "BUY" ? candle.high >= oneR : candle.low <= oneR;
      const reachedTarget =
        direction === "BUY" ? candle.high >= target : candle.low <= target;
      if (stopped)
        return {
          outcome: "LOSS" as const,
          outcomeTime: candle.time,
          exitReason: "stop" as const,
          realizedR: -1,
        };
      if (reachedTarget) {
        if (!runnerFraction)
          return {
            outcome: "WIN" as const,
            outcomeTime: candle.time,
            exitReason: "target" as const,
            realizedR: 2,
          };
        partialAt = index;
        continue;
      }
      if (reachedOneR) protectedAt = index;
      continue;
    }
    const breakEven =
      direction === "BUY" ? candle.low <= entry : candle.high >= entry;
    const reachedTarget =
      direction === "BUY" ? candle.high >= target : candle.low <= target;
    if (breakEven)
      return {
        outcome: "WIN" as const,
        outcomeTime: candle.time,
        exitReason: "break_even" as const,
        realizedR: 0,
      };
    if (reachedTarget) {
      if (!runnerFraction)
        return {
          outcome: "WIN" as const,
          outcomeTime: candle.time,
          exitReason: "target" as const,
          realizedR: 2,
        };
      partialAt = index;
    }
  }
  if (partialAt >= 0 && candles.length)
    return {
      outcome: "WIN" as const,
      outcomeTime: candles[candles.length - 1].time,
      exitReason: "runner_open" as const,
      realizedR: legacyBlendedRunnerR(runnerFraction, 1),
    };
  return protectedAt >= 0 && candles.length
    ? {
        outcome: "WIN" as const,
        outcomeTime: candles[candles.length - 1].time,
        exitReason: "one_r_protected" as const,
        realizedR: 0,
      }
    : null;
};

export const resolveProtectedOutcome = (
  candles: StrategyCandle[],
  startIndex: number,
  direction: "BUY" | "SELL",
  stopLoss: number,
  oneR: number,
  takeProfit?: number,
  score?: number,
  weekendLiquidationTime?: number,
  tradeManager?: GoldilocksBacktestManagerId,
) => {
  if (
    normalizeGoldilocksBacktestManager(tradeManager) ===
    GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID
  )
    return resolveLegacyScoreTieredOutcome(
      candles,
      startIndex,
      direction,
      stopLoss,
      oneR,
      takeProfit,
      score,
      weekendLiquidationTime,
    );
  const entry = (stopLoss + oneR) / 2;
  const risk = Math.abs(entry - stopLoss);
  const target =
    takeProfit ??
    (direction === "BUY"
      ? entry + Math.abs(entry - stopLoss) * 2
      : entry - Math.abs(entry - stopLoss) * 2);
  const securedR = goldilocksSecuredRAtBreakEven();
  const targetR = goldilocksRealizedRAtTarget();
  let partialAt = -1;
  for (let index = startIndex; index < candles.length; index += 1) {
    const candle = candles[index];
    if (
      weekendLiquidationTime !== undefined &&
      candle.time >= weekendLiquidationTime
    ) {
      const rawOpenR =
        (direction === "BUY" ? candle.open - entry : entry - candle.open) /
        risk;
      const activeStopFloor = partialAt >= 0 ? 0 : -1;
      const boundedOpenR = Math.max(activeStopFloor, rawOpenR);
      const realizedR =
        partialAt >= 0
          ? securedR +
            (1 - GOLDILOCKS_DEFAULT_MANAGEMENT.partialCloseFraction) *
              boundedOpenR
          : boundedOpenR;
      const protectedWin = partialAt >= 0;
      return {
        outcome: (realizedR > 0 || protectedWin ? "WIN" : "LOSS") as
          "WIN" | "LOSS",
        outcomeTime: candle.time,
        exitReason: "weekend_close" as const,
        realizedR,
      };
    }
    if (partialAt >= 0) {
      const remainingStopped =
        direction === "BUY" ? candle.low <= entry : candle.high >= entry;
      const remainingWon =
        direction === "BUY" ? candle.high >= target : candle.low <= target;
      if (remainingStopped)
        return {
          outcome: "WIN" as const,
          outcomeTime: candle.time,
          exitReason: "break_even" as const,
          realizedR: securedR,
        };
      if (remainingWon)
        return {
          outcome: "WIN" as const,
          outcomeTime: candle.time,
          exitReason: "target" as const,
          realizedR: targetR,
        };
      continue;
    }
    const stopped =
      direction === "BUY" ? candle.low <= stopLoss : candle.high >= stopLoss;
    const reachedOneR =
      direction === "BUY" ? candle.high >= oneR : candle.low <= oneR;
    const reachedTarget =
      direction === "BUY" ? candle.high >= target : candle.low <= target;
    if (stopped)
      return {
        outcome: "LOSS" as const,
        outcomeTime: candle.time,
        exitReason: "stop" as const,
        realizedR: -1,
      };
    if (reachedTarget) {
      return {
        outcome: "WIN" as const,
        outcomeTime: candle.time,
        exitReason: "target" as const,
        realizedR: targetR,
      };
    }
    if (reachedOneR) partialAt = index;
  }
  if (partialAt >= 0 && candles.length)
    return {
      outcome: "WIN" as const,
      outcomeTime: candles[candles.length - 1].time,
      exitReason: "one_r_protected" as const,
      realizedR: securedR,
    };
  return null;
};

export const validateGoldilocksExecutionCoverageAtEntry = (
  candles: StrategyCandle[],
  startIndex: number,
  entryTime: number,
  maximumDelaySeconds = 60,
  executionTimeframe = "M1",
): { allowed: boolean; reason: string } => {
  const first = candles[startIndex];
  const delay = first ? first.time - entryTime : Number.POSITIVE_INFINITY;
  const allowed = Boolean(first) && delay >= 0 && delay <= maximumDelaySeconds;
  return {
    allowed,
    reason: allowed
      ? `${executionTimeframe} execution coverage begins ${delay} second(s) after entry eligibility.`
      : first
        ? `Missing ${executionTimeframe} execution coverage at entry: first available candle is ${delay} seconds late (${new Date(first.time * 1000).toISOString()}).`
        : `Missing ${executionTimeframe} execution coverage at entry: no later candle is available.`,
  };
};

export const buildProtectedOutcomeResolver = (candles: StrategyCandle[]) => {
  let size = 1;
  while (size < candles.length) size *= 2;
  const maximumHigh = new Float64Array(size * 2);
  maximumHigh.fill(Number.NEGATIVE_INFINITY);
  const minimumLow = new Float64Array(size * 2);
  minimumLow.fill(Number.POSITIVE_INFINITY);
  for (let index = 0; index < candles.length; index += 1) {
    maximumHigh[size + index] = candles[index].high;
    minimumLow[size + index] = candles[index].low;
  }
  for (let node = size - 1; node > 0; node -= 1) {
    maximumHigh[node] = Math.max(
      maximumHigh[node * 2],
      maximumHigh[node * 2 + 1],
    );
    minimumLow[node] = Math.min(minimumLow[node * 2], minimumLow[node * 2 + 1]);
  }
  const firstHighAtLeast = (
    start: number,
    value: number,
    node = 1,
    left = 0,
    right = size - 1,
  ): number => {
    if (right < start || maximumHigh[node] < value) return -1;
    if (left === right) return left < candles.length ? left : -1;
    const midpoint = (left + right) >>> 1;
    const first = firstHighAtLeast(start, value, node * 2, left, midpoint);
    return first >= 0
      ? first
      : firstHighAtLeast(start, value, node * 2 + 1, midpoint + 1, right);
  };
  const firstLowAtMost = (
    start: number,
    value: number,
    node = 1,
    left = 0,
    right = size - 1,
  ): number => {
    if (right < start || minimumLow[node] > value) return -1;
    if (left === right) return left < candles.length ? left : -1;
    const midpoint = (left + right) >>> 1;
    const first = firstLowAtMost(start, value, node * 2, left, midpoint);
    return first >= 0
      ? first
      : firstLowAtMost(start, value, node * 2 + 1, midpoint + 1, right);
  };
  return (
    startIndex: number,
    direction: "BUY" | "SELL",
    stopLoss: number,
    oneR: number,
    takeProfit?: number,
    score?: number,
    weekendLiquidationTime?: number,
    tradeManager?: GoldilocksBacktestManagerId,
  ) => {
    if (weekendLiquidationTime !== undefined)
      return resolveProtectedOutcome(
        candles,
        startIndex,
        direction,
        stopLoss,
        oneR,
        takeProfit,
        score,
        weekendLiquidationTime,
        tradeManager,
      );
    const entry = (stopLoss + oneR) / 2;
    const risk = Math.abs(entry - stopLoss);
    const target =
      takeProfit ??
      (direction === "BUY"
        ? entry + Math.abs(entry - stopLoss) * 2
        : entry - Math.abs(entry - stopLoss) * 2);
    if (
      normalizeGoldilocksBacktestManager(tradeManager) ===
      GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID
    ) {
      const runnerTarget =
        direction === "BUY" ? entry + risk * 4 : entry - risk * 4;
      const runnerFraction = legacyRunnerFractionForScore(score);
      const stopIndex =
        direction === "BUY"
          ? firstLowAtMost(startIndex, stopLoss)
          : firstHighAtLeast(startIndex, stopLoss);
      const protectedIndex =
        direction === "BUY"
          ? firstHighAtLeast(startIndex, oneR)
          : firstLowAtMost(startIndex, oneR);
      if (protectedIndex < 0)
        return stopIndex >= 0
          ? {
              outcome: "LOSS" as const,
              outcomeTime: candles[stopIndex].time,
              exitReason: "stop" as const,
              realizedR: -1,
            }
          : null;
      if (stopIndex >= 0 && stopIndex <= protectedIndex)
        return {
          outcome: "LOSS" as const,
          outcomeTime: candles[stopIndex].time,
          exitReason: "stop" as const,
          realizedR: -1,
        };
      const directTargetIndex =
        direction === "BUY"
          ? firstHighAtLeast(startIndex, target)
          : firstLowAtMost(startIndex, target);
      const finishRunner = (targetIndex: number) => {
        if (!runnerFraction)
          return {
            outcome: "WIN" as const,
            outcomeTime: candles[targetIndex].time,
            exitReason: "target" as const,
            realizedR: 2,
          };
        const runnerAfter = targetIndex + 1;
        const runnerStopIndex =
          direction === "BUY"
            ? firstLowAtMost(runnerAfter, oneR)
            : firstHighAtLeast(runnerAfter, oneR);
        const runnerTargetIndex =
          direction === "BUY"
            ? firstHighAtLeast(runnerAfter, runnerTarget)
            : firstLowAtMost(runnerAfter, runnerTarget);
        if (runnerStopIndex < 0 && runnerTargetIndex < 0)
          return {
            outcome: "WIN" as const,
            outcomeTime: candles[candles.length - 1].time,
            exitReason: "runner_open" as const,
            realizedR: legacyBlendedRunnerR(runnerFraction, 1),
          };
        if (
          runnerStopIndex >= 0 &&
          (runnerTargetIndex < 0 || runnerStopIndex <= runnerTargetIndex)
        )
          return {
            outcome: "WIN" as const,
            outcomeTime: candles[runnerStopIndex].time,
            exitReason: "runner_stop" as const,
            realizedR: legacyBlendedRunnerR(runnerFraction, 1),
          };
        return {
          outcome: "WIN" as const,
          outcomeTime: candles[runnerTargetIndex].time,
          exitReason: "runner_target" as const,
          realizedR: legacyBlendedRunnerR(runnerFraction, 4),
        };
      };
      if (directTargetIndex === protectedIndex)
        return finishRunner(directTargetIndex);
      const after = protectedIndex + 1;
      const breakEvenIndex =
        direction === "BUY"
          ? firstLowAtMost(after, entry)
          : firstHighAtLeast(after, entry);
      const targetIndex =
        direction === "BUY"
          ? firstHighAtLeast(after, target)
          : firstLowAtMost(after, target);
      if (breakEvenIndex < 0 && targetIndex < 0)
        return {
          outcome: "WIN" as const,
          outcomeTime: candles[candles.length - 1].time,
          exitReason: "one_r_protected" as const,
          realizedR: 0,
        };
      if (
        breakEvenIndex >= 0 &&
        (targetIndex < 0 || breakEvenIndex <= targetIndex)
      )
        return {
          outcome: "WIN" as const,
          outcomeTime: candles[breakEvenIndex].time,
          exitReason: "break_even" as const,
          realizedR: 0,
        };
      return finishRunner(targetIndex);
    }
    const securedR = goldilocksSecuredRAtBreakEven();
    const targetR = goldilocksRealizedRAtTarget();
    const stopIndex =
      direction === "BUY"
        ? firstLowAtMost(startIndex, stopLoss)
        : firstHighAtLeast(startIndex, stopLoss);
    const protectedIndex =
      direction === "BUY"
        ? firstHighAtLeast(startIndex, oneR)
        : firstLowAtMost(startIndex, oneR);
    if (protectedIndex < 0)
      return stopIndex >= 0
        ? {
            outcome: "LOSS" as const,
            outcomeTime: candles[stopIndex].time,
            exitReason: "stop" as const,
            realizedR: -1,
          }
        : null;
    if (stopIndex >= 0 && stopIndex <= protectedIndex)
      return {
        outcome: "LOSS" as const,
        outcomeTime: candles[stopIndex].time,
        exitReason: "stop" as const,
        realizedR: -1,
      };
    const directTargetIndex =
      direction === "BUY"
        ? firstHighAtLeast(startIndex, target)
        : firstLowAtMost(startIndex, target);
    if (directTargetIndex === protectedIndex)
      return {
        outcome: "WIN" as const,
        outcomeTime: candles[directTargetIndex].time,
        exitReason: "target" as const,
        realizedR: targetR,
      };
    const after = protectedIndex + 1;
    const breakEvenIndex =
      direction === "BUY"
        ? firstLowAtMost(after, entry)
        : firstHighAtLeast(after, entry);
    const targetIndex =
      direction === "BUY"
        ? firstHighAtLeast(after, target)
        : firstLowAtMost(after, target);
    if (breakEvenIndex < 0 && targetIndex < 0)
      return {
        outcome: "WIN" as const,
        outcomeTime: candles[candles.length - 1].time,
        exitReason: "one_r_protected" as const,
        realizedR: securedR,
      };
    if (
      breakEvenIndex >= 0 &&
      (targetIndex < 0 || breakEvenIndex <= targetIndex)
    )
      return {
        outcome: "WIN" as const,
        outcomeTime: candles[breakEvenIndex].time,
        exitReason: "break_even" as const,
        realizedR: securedR,
      };
    return {
      outcome: "WIN" as const,
      outcomeTime: candles[targetIndex].time,
      exitReason: "target" as const,
      realizedR: targetR,
    };
  };
};

export const simulateGoldilocksPair = (
  input: GoldilocksBacktestInput,
): BacktestTradeInput[] => {
  const timeframes = input.timeframes ?? GOLDILOCKS_DEMO_TIMEFRAMES;
  const strategyTweaks =
    input.strategyTweaks ?? GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS;
  const gateSettings = normalizeGoldilocksBacktestGates(
    input.gateSettings ?? GOLDILOCKS_BACKTEST_GATE_DEFAULTS,
  );
  const zoneSeconds = GOLDILOCKS_TIMEFRAME_SECONDS[timeframes.zone];
  const confirmationSeconds =
    GOLDILOCKS_TIMEFRAME_SECONDS[timeframes.confirmation];
  const executionSeconds = GOLDILOCKS_TIMEFRAME_SECONDS[timeframes.execution];
  if (!zoneSeconds || !confirmationSeconds || !executionSeconds)
    throw new Error(
      `Unsupported Goldilocks backtest timeframe contract: ${JSON.stringify(timeframes)}`,
    );
  input.onProgress?.({
    stage: `building ${timeframes.zone} zones`,
    completed: 0,
    total: 4,
    percent: 0,
  });
  const zoneHistory = buildGoldilocksHistoryChunked(
    input.zoneCandles,
    1_000,
    200,
    { trackTouches: false },
  );
  input.onProgress?.({
    stage: `building ${timeframes.confirmation} confluence`,
    completed: 1,
    total: 4,
    percent: 5,
  });
  const confirmation = toStrategyCandles(input.confirmationCandles);
  const zoneSignalCandles = toStrategyCandles(input.zoneCandles);
  const confirmationHistory = buildGoldilocksHistoryChunked(
    input.confirmationCandles,
    1_000,
    200,
  );
  const outcomeCandles = toStrategyCandles(input.outcomeCandles);
  const resolveOutcome = buildProtectedOutcomeResolver(outcomeCandles);
  input.onProgress?.({
    stage: `building ${timeframes.trend} context`,
    completed: 2,
    total: 4,
    percent: 10,
  });
  const trendHistory = buildGoldilocksHistoryChunked(
    input.trendCandles,
    1_000,
    200,
  );
  const marketContext = buildMarketContextIndex(input.trendCandles, 1_000, 200);
  const sources = [
    {
      timeframe: timeframes.confirmation,
      candles: input.confirmationCandles,
      history: confirmationHistory,
    },
    {
      timeframe: timeframes.zone,
      candles: input.zoneCandles,
      history: zoneHistory,
    },
    {
      timeframe: timeframes.trend,
      candles: input.trendCandles,
      history: trendHistory,
    },
  ];
  const candidates: BacktestTradeInput[] = [];
  type ZoneScanState = {
    zone: GoldilocksZone;
    touch: HistoricalZoneTouchState;
    zoneArmedAt?: number;
    invalidatedBeforeArmed: boolean;
  };
  const zoneArmingState = (zone: GoldilocksZone) => {
    const firstIndex = firstAtOrAfter(zoneSignalCandles, zone.candleTime + 1);
    for (let index = firstIndex; index < zoneSignalCandles.length; index += 1) {
      const candle = zoneSignalCandles[index];
      const broken =
        zone.side === "demand" ? candle.low < zone.low : candle.high > zone.high;
      if (broken)
        return { zoneArmedAt: undefined, invalidatedBeforeArmed: true };
      const outside =
        zone.side === "demand"
          ? candle.low > zone.high
          : candle.high < zone.low;
      if (outside)
        return {
          zoneArmedAt: candle.time + zoneSeconds,
          invalidatedBeforeArmed: false,
        };
    }
    return { zoneArmedAt: undefined, invalidatedBeforeArmed: false };
  };
  const pending = zoneHistory.zones.filter((zone)=>zone.kind==="base").sort(
    (left, right) =>
      (left.availableAt ?? left.candleTime) -
      (right.availableAt ?? right.candleTime),
  );
  const active = new Map<string, ZoneScanState>();
  let pendingIndex = 0;
  const progressEvery = Math.max(1, Math.floor(confirmation.length / 100));
  for (let index = 0; index < confirmation.length; index += 1) {
    const candle = confirmation[index];
    while (
      pendingIndex < pending.length &&
      (pending[pendingIndex].availableAt ?? pending[pendingIndex].candleTime) <
        candle.time
    ) {
      const zone = pending[pendingIndex++];
      if (zoneUsableAt(zone, candle.time))
        active.set(zone.id, {
          zone,
          touch: createHistoricalZoneTouchState(),
          ...zoneArmingState(zone),
        });
    }
    if (index % progressEvery === 0 || index === confirmation.length - 1) {
      input.onProgress?.({
        stage: `scanning ${timeframes.confirmation} confirmations`,
        completed: index + 1,
        total: confirmation.length,
        percent:
          10 +
          Math.round(((index + 1) / Math.max(1, confirmation.length)) * 85),
      });
    }
    for (const [zoneId, state] of active) {
      const { zone } = state;
      if (
        candle.time > expiresAt(zone.candleTime) ||
        (zone.invalidatedAt && candle.time >= zone.invalidatedAt)
      ) {
        active.delete(zoneId);
        continue;
      }
      const broken =
        zone.side === "demand"
          ? candle.low < zone.low
          : candle.high > zone.high;
      if (broken) {
        active.delete(zoneId);
        continue;
      }
      const pendingTouch =
        state.touch.touchCandleIndex >= 0
          ? confirmation[state.touch.touchCandleIndex]
          : undefined;
      const confirmed =
        pendingTouch !== undefined &&
        (zone.side === "demand"
          ? candle.close > candle.open && candle.close > pendingTouch.high
          : candle.close < candle.open && candle.close < pendingTouch.low);
      if (!confirmed) {
        if (state.touch.touchCandleIndex < 0) {
          const touched = candle.high >= zone.low && candle.low <= zone.high;
          if (state.invalidatedBeforeArmed) {
            active.delete(zoneId);
            continue;
          }
          if (
            state.zoneArmedAt !== undefined &&
            candle.time >= state.zoneArmedAt &&
            touched
          )
            state.touch.touchCandleIndex = index;
        }
        continue;
      }
      const confirmationCloseTime = candle.time + confirmationSeconds;
      const entryDate = new Date(confirmationCloseTime * 1000);
      const marketHoursAllowed =
        isForexMarketOpenAt(entryDate) &&
        !isForexWeekendEntryBlocked(entryDate);
      if (gateSettings.weeklyMarketHours && !marketHoursAllowed) {
        input.onMarketHoursRejected?.(
          confirmationCloseTime,
          "Weekly market-hours gate blocks entries from Friday 16:00 through Sunday 18:00 America/New_York.",
        );
        state.touch.touchCandleIndex = -1;
        continue;
      }
      const holidayStatus = getForexHolidayStatusAt(entryDate);
      if (gateSettings.holiday && holidayStatus.blocked) {
        input.onHolidayRejected?.(confirmationCloseTime, holidayStatus.reason);
        state.touch.touchCandleIndex = -1;
        continue;
      }
      if (gateSettings.pairSession && !isTradeSessionOpen(input.pair, entryDate)) {
        input.onSessionRejected?.(
          confirmationCloseTime,
          "Neither pair currency is inside its DST-aware local trading session at entry eligibility.",
        );
        state.touch.touchCandleIndex = -1;
        continue;
      }
      const departureQuality = validateGoldilocksDepartureQuality(
        zone,
        strategyTweaks,
      );
      if (gateSettings.departureQuality && !departureQuality.allowed) {
        input.onDepartureQualityRejected?.(
          departureQuality,
          confirmationCloseTime,
        );
        active.delete(zoneId);
        continue;
      }
      const formationWindow = getGoldilocksZoneFormationWindow(
        zone,
        zoneSeconds,
      );
      const formationNewsGate = input.historicalNewsGate?.(
        input.pair,
        formationWindow.end,
        formationWindow.start,
      ) ?? {
        allowed: true,
        covered: true,
        reason: "Zone-formation news gate was not configured.",
      };
      if (gateSettings.zoneFormationNews && !formationNewsGate.allowed) {
        input.onNewsRejected?.(formationNewsGate, formationWindow.end);
        active.delete(zoneId);
        continue;
      }
      const purity = summarizeConfirmationTimeframeTouches(
        zone,
        confirmation,
        confirmationSeconds,
        pendingTouch.time,
        strategyTweaks?.maximumPriorTouches,
      );
      if (purity.invalidated) {
        active.delete(zoneId);
        continue;
      }
      const proximity = validateGoldilocksEntryProximity(
        zone,
        pendingTouch,
        candle.close,
        candle.close,
        strategyTweaks,
      );
      const entryProximityAllowed = proximity.allowed;
      const approachGate = validateGoldilocksZoneApproach(
        zone,
        confirmation,
        state.touch.touchCandleIndex,
        strategyTweaks,
      );
      if (gateSettings.adverseApproach && !approachGate.allowed) {
        proximity.allowed = false;
        proximity.reason = approachGate.reason;
      }
      if (
        (gateSettings.entryProximity && !entryProximityAllowed) ||
        (gateSettings.adverseApproach && !approachGate.allowed)
      ) {
        input.onProximityRejected?.(proximity, candle.time, pendingTouch.time);
        active.delete(zoneId);
        continue;
      }
      const newsGate = input.historicalNewsGate?.(
        input.pair,
        confirmationCloseTime,
        timeframes.confirmation === "H1" ? candle.time : undefined,
      ) ?? {
        allowed: true,
        covered: true,
        reason: "Historical news gate was not configured.",
      };
      if (gateSettings.entryNews && !newsGate.allowed) {
        input.onNewsRejected?.(newsGate, confirmationCloseTime);
        state.touch.touchCandleIndex = -1;
        continue;
      }
      const known = zoneHistory.zones.filter((item) =>
        zoneUsableAt(item, candle.time),
      );
      const runway = validateTwoToOneRunway(zone, known, candle.close, {
        knownZonesUsableAtEntry: true,
      });
      if (runway.allowed || !gateSettings.twoToOneRunway) {
        const scoredZone = annotateConfluenceAt(
          {
            ...zone,
            touches: purity.touches,
            maxPenetration: 0,
          },
          timeframes.zone,
          candle.time,
          sources,
        );
        const direction = zone.side === "demand" ? "BUY" : "SELL";
        const context = marketContextAt(
          marketContext,
          candle.time,
        );
        const trend = context.trend;
        const approachPressure = measureGoldilocksApproachPressure(
          zone,
          confirmation,
          state.touch.touchCandleIndex,
          index,
        );
        const score = scoreGoldilocksSetup({
          zone: scoredZone,
          tradeDirection: direction,
          trend,
          minimumScore: input.minimumScore,
          purityTouches: purity.touches,
          adverseWarningCount: approachPressure.adversePressureScore,
            strategyTweaks,
            scoreWeights: input.scoreWeights,
          timeframes,
          gates: [
            {
              name: "Zone validity",
              passed: true,
              reason: "Historically active at confirmation.",
            },
            {
              name: "Confirmation freshness",
              passed: true,
              reason: `${timeframes.confirmation} close-through completed after its touch candle.`,
            },
            { name: "Entry proximity", passed: true, reason: proximity.reason },
            {
              name: "Zone formation news",
              passed: true,
              reason: formationNewsGate.reason,
            },
            {
              name: "Weekly market hours",
              passed: true,
              reason:
                "Entry is outside the Friday-close and Sunday-reopen safety window.",
            },
            {
              name: "Historical holiday",
              passed: true,
              reason: holidayStatus.reason,
            },
            {
              name: "Historical pair session",
              passed: true,
              reason:
                "At least one pair currency is inside its DST-aware local trading session.",
            },
            { name: "Historical news", passed: true, reason: newsGate.reason },
            { name: "2:1 runway", passed: true, reason: runway.reason },
          ],
        });
        if (score.eligible) {
          const oneR =
            direction === "BUY"
              ? runway.entry + runway.risk
              : runway.entry - runway.risk;
          const outcomeStart = firstAtOrAfter(
            outcomeCandles,
            confirmationCloseTime,
          );
          const executionCoverage = validateGoldilocksExecutionCoverageAtEntry(
            outcomeCandles,
            outcomeStart,
            confirmationCloseTime,
            executionSeconds,
            timeframes.execution,
          );
          if (!executionCoverage.allowed) {
            input.onExecutionCoverageRejected?.(
              confirmationCloseTime,
              executionCoverage.reason,
            );
            state.touch.touchCandleIndex = -1;
            continue;
          }
          const weekendLiquidationTime = nextForexWeekendLiquidationTime(
            confirmationCloseTime,
          );
          const resolved = resolveOutcome(
            outcomeStart,
            direction,
            runway.stopLoss,
            oneR,
            runway.takeProfit,
            score.total,
            weekendLiquidationTime,
            input.tradeManager,
          );
          const zoneCorridors = sources.map((source) =>
            measureZoneCorridor({
              pair: input.pair,
              timeframe: source.timeframe,
              measuredAt: confirmationCloseTime,
              entry: runway.entry,
              stopLoss: runway.stopLoss,
              takeProfit: runway.takeProfit,
              zones: source.history.zones,
              candles: toStrategyCandles(source.candles),
            }),
          );
          const result: BacktestTradeInput | null = resolved
            ? {
                runId: input.runId,
                pair: input.pair,
                zoneId: zone.id,
                zoneKind: zone.kind,
                direction,
                confirmationTime: candle.time,
                zoneAgeSeconds: getGoldilocksZoneAgeSeconds(
                  zone.candleTime,
                  confirmationCloseTime,
                ),
                firstOutsideTime: purity.firstOutsideTime,
                ...resolved,
                entry: runway.entry,
                stopLoss: runway.stopLoss,
                oneR,
                takeProfit: runway.takeProfit,
                score: score.total,
                scoreJson: score,
                priorTouches: purity.touches,
                maxPenetration: 0,
                availableRrr: runway.availableRatio,
                confluenceCount:
                  scoredZone.timeframeConfluence?.timeframeCount ?? 1,
                trend,
                approachPressure,
                zoneCorridors,
              }
            : null;
          if (result) candidates.push(result);
        }
      }
      state.touch.touchCandleIndex = -1;
    }
  }
  candidates.sort(
    (a, b) => a.confirmationTime - b.confirmationTime || b.score - a.score,
  );
  const selected: BacktestTradeInput[] = [];
  let availableAfter = 0;
  for (const trade of candidates) {
    if (trade.confirmationTime <= availableAfter) continue;
    selected.push(trade);
    availableAfter = trade.outcomeTime;
  }
  for (const trade of selected) {
    const entryEligibilityTime = trade.confirmationTime + confirmationSeconds;
    const startIndex = firstAtOrAfter(outcomeCandles, entryEligibilityTime);
    const weekendLiquidationTime =
      nextForexWeekendLiquidationTime(entryEligibilityTime);
    trade.marketPath = summarizeTradeMarketPath({
      candles: outcomeCandles,
      startIndex,
      direction: trade.direction,
      entry: trade.entry,
      stopLoss: trade.stopLoss,
      endTime: weekendLiquidationTime,
    });
    trade.managementPolicyResults = evaluateGoldilocksManagementPolicies({
      candles: outcomeCandles,
      startIndex,
      direction: trade.direction,
      entry: trade.entry,
      stopLoss: trade.stopLoss,
      weekendLiquidationTime,
    });
  }
  input.onProgress?.({
    stage: "complete",
    completed: 1,
    total: 1,
    percent: 100,
  });
  return selected;
};
