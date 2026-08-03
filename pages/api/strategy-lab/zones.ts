import type { NextApiRequest, NextApiResponse } from "next";
import { forexPairs } from "../../../utils/constants";
import {
  annotateTimeframeConfluence,
  createHistoricalZoneTouchState,
  detectGoldilocksZoneHistory,
  detectGoldilocksZones,
  findCloseBeyondTouchedCandle,
  getDrawableGoldilocksZones,
  getGoldilocksZoneFormationWindow,
  measureGoldilocksIntrabarDepartureSpeed,
  summarizeZoneTimeframeTouches,
  summarizeConfirmationTimeframeTouches,
  validateFinalEntryAfterEngulf,
  validateGoldilocksDepartureQuality,
  validateGoldilocksEntryProximity,
  validateGoldilocksZoneApproach,
  validateTwoToOneRunway,
  type GoldilocksEntryProximityCheck,
  type GoldilocksZone,
  type StrategyCandle,
  type SwingLeg,
} from "../../../utils/goldilocksStrategy";
import { getHistoricalNewsGateForRange } from "../../../utils/historicalNewsStore";
import { fetchCandles } from "../../../utils/oanda/api/fetchCandles";
import { fetchCandleHistory } from "../../../utils/oanda/api/fetchCandleHistory";
import { determineSwingPoints } from "../../../utils/swingLabeler";
import {
  annotateConfluenceAt,
  buildGoldilocksHistoryChunked,
  buildGoldilocksLegs,
  getGoldilocksStructureBreakingLegDirection,
  getGoldilocksTrend,
  toStrategyCandles,
} from "../../../utils/goldilocksScanner";
import {
  GOLDILOCKS_DEMO_TIMEFRAMES,
  GOLDILOCKS_LIVE_CANDLE_LIMITS,
  GOLDILOCKS_STRATEGY_VERSION,
  GOLDILOCKS_TIMEFRAME_SECONDS,
  getGoldilocksChartStack,
  getGoldilocksMinimumScore,
  isGoldilocksReplayStrategyCompatible,
} from "../../../utils/goldilocksConfig";
import { scoreGoldilocksSetup } from "../../../utils/goldilocksScoring";
import { getBacktestTradeReplay } from "../../../utils/backtestStore";
import {
  annotateReplayZonePurityAt,
  buildStoredReplayZoneFallback,
  filterReplayRejectedFirstTouchesAt,
  getStrategyReplayZoneFormationDetails,
  getStrategyReplayBaseContextStart,
  getStrategyReplayContextAnchor,
  getStrategyReplayForwardPageWindow,
  getStrategyReplayRequestEnd,
  getStrategyReplayWindow,
  isStoredReplayZoneMatch,
  reconcileStoredReplayPriorTouchDetails,
} from "../../../utils/strategyReplay";
import {
  getForexHolidayStatusAt,
  isForexWeekendEntryBlocked,
} from "../../../utils/forexMarketHours";
import {
  GOLDILOCKS_MAX_ZONE_AGE_SECONDS,
  getGoldilocksZoneAgeSeconds,
  getGoldilocksZoneExpiresAt,
} from "../../../utils/zoneAge";
import { measureGoldilocksApproachPressure } from "../../../utils/approachPressure";
import {
  GOLDILOCKS_DEFAULT_MANAGEMENT,
  GOLDILOCKS_ADAPTIVE_SCALE_OUT_MANAGEMENT_ID,
  GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID,
  GOLDILOCKS_UNTOUCHED_STOP_RUNNER_MANAGEMENT_ID,
} from "../../../utils/goldilocksTradeManagement";

const replayCache = new Map<string, { expiresAt: number; payload: unknown }>();

const zoneExpiresAt = getGoldilocksZoneExpiresAt;

const zoneWasUsableAt = (
  zone: ReturnType<typeof detectGoldilocksZoneHistory>["zones"][number],
  time: number,
) =>
  (zone.availableAt ?? zone.candleTime) <= time &&
  (!zone.invalidatedAt || zone.invalidatedAt > time) &&
  time <= zoneExpiresAt(zone.candleTime);

const firstCandleAfter = (candles: Array<{ time: number }>, time: number) => {
  let low = 0,
    high = candles.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (candles[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  return low;
};

const buildZoneHistory = (
  candles: Awaited<ReturnType<typeof fetchCandles>>,
) => {
  const swings = determineSwingPoints(candles);
  const legs: SwingLeg[] = [];
  for (let index = 0; index < swings.length - 1; index += 1) {
    const left = swings[index];
    const right = swings[index + 1];
    const direction = getGoldilocksStructureBreakingLegDirection(
      left.swing,
      right.swing,
    );
    if (!direction) continue;
    const startIndex = candles.findIndex((candle) => candle.time === left.time);
    const endIndex = candles.findIndex((candle) => candle.time === right.time);
    if (startIndex >= 0 && endIndex > startIndex)
      legs.push({
        direction,
        startIndex,
        endIndex,
        startSwing: left.swing,
        endSwing: right.swing,
        brokeOppositeLegIn:
          (left.swing === "LL" && right.swing === "HH") ||
          (left.swing === "HH" && right.swing === "LL"),
      });
  }
  const strategyCandles = candles.map((candle) => ({
    time: Math.floor(new Date(candle.time).getTime() / 1000),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
  return detectGoldilocksZoneHistory(strategyCandles, legs);
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const pair = String(req.query.pair ?? "EUR/USD").toUpperCase();
  if (!forexPairs.includes(pair))
    return res.status(400).json({ error: "Unsupported pair" });
  const timeframe = String(
    req.query.timeframe ?? GOLDILOCKS_DEMO_TIMEFRAMES.confirmation,
  ).toUpperCase();
  const strategyStack = getGoldilocksChartStack(req.query.stack);
  const requestedTradeTime = Number(req.query.tradeTime);
  const requestedZoneTime = Number(req.query.zoneTime);
  const requestedBefore = Number(req.query.before);
  const requestedAfter = Number(req.query.after);
  const weekView = req.query.view === "week";
  const requestedExitTime = Number(req.query.exitTime);
  const requestedTradeId =
    typeof req.query.tradeId === "string" ? req.query.tradeId : undefined;
  const storedReplayForRequest = Number.isFinite(requestedTradeTime)
    ? getBacktestTradeReplay(pair, requestedTradeTime, requestedTradeId)
    : undefined;
  const storedZoneCandleTime = Number(
    storedReplayForRequest?.zoneId.match(/(\d+)$/)?.[1],
  );
  const storedTargetZoneCandleTime = Number(
    storedReplayForRequest?.setAndForgetTargetZoneId?.match(/(\d+)$/)?.[1],
  );
  const supportedTimeframes = ["M1", "M5", "M15", "H1"];
  if (!supportedTimeframes.includes(timeframe)) {
    return res.status(400).json({ error: "Unsupported timeframe" });
  }
  const replayCacheKey = Number.isFinite(requestedTradeTime)
    ? `stored-zone-fallback-v9:${strategyStack.id}:${pair}:${timeframe}:${requestedTradeTime}:${requestedTradeId ?? "latest"}:${Number.isFinite(requestedExitTime) ? requestedExitTime : "stored"}`
    : "";
  const cachedReplay = replayCacheKey
    ? replayCache.get(replayCacheKey)
    : undefined;
  if (cachedReplay && cachedReplay.expiresAt > Date.now()) {
    res.setHeader("Cache-Control", "private, max-age=60");
    return res.status(200).json(cachedReplay.payload);
  }

  try {
    const researchZoneWindow = Number.isFinite(requestedZoneTime)
      ? {
          chartStart: requestedZoneTime - (weekView ? 7 * 24 : 12) * 60 * 60,
          chartEnd: requestedZoneTime + (weekView ? 24 : 18) * 60 * 60,
          confirmationStart:
            requestedZoneTime - (weekView ? 7 * 24 : 12) * 60 * 60,
          confirmationEnd: requestedZoneTime + (weekView ? 24 : 18) * 60 * 60,
        }
      : Number.isFinite(requestedBefore)
        ? {
            chartStart:
              requestedBefore -
              (GOLDILOCKS_TIMEFRAME_SECONDS[timeframe] ?? 300) * 1500,
            chartEnd: requestedBefore,
            confirmationStart:
              requestedBefore -
              (GOLDILOCKS_TIMEFRAME_SECONDS[timeframe] ?? 300) * 1500,
            confirmationEnd: requestedBefore,
          }
        : Number.isFinite(requestedAfter)
          ? (() => {
              const forward = getStrategyReplayForwardPageWindow(
                requestedAfter,
                GOLDILOCKS_TIMEFRAME_SECONDS[timeframe] ?? 300,
              );
              return {
                chartStart: forward.start,
                chartEnd: forward.end,
                confirmationStart: forward.start,
                confirmationEnd: forward.end,
              };
            })()
          : undefined;
    const replayWindow = storedReplayForRequest
      ? getStrategyReplayWindow(
          storedReplayForRequest.confirmationTime,
          Number.isFinite(requestedExitTime)
            ? requestedExitTime
            : storedReplayForRequest.outcomeTime,
          Number.isFinite(storedTargetZoneCandleTime)
            ? Math.min(storedZoneCandleTime, storedTargetZoneCandleTime)
            : Number.isFinite(storedZoneCandleTime)
              ? storedZoneCandleTime
              : undefined,
        )
      : researchZoneWindow;
    const replayWindowStart = replayWindow?.chartStart;
    const replayWindowEnd = replayWindow
      ? getStrategyReplayRequestEnd(replayWindow.chartEnd)
      : undefined;
    const replayConfirmationEnd = replayWindow
      ? getStrategyReplayRequestEnd(replayWindow.confirmationEnd)
      : undefined;
    const candles =
      req.query.chartOnly === "1" && !replayWindow
        ? await fetchCandleHistory(pair, timeframe, {
            lookbackDays: 730,
            mode: "demo",
            backfillPages: 0,
            maxCandles: GOLDILOCKS_LIVE_CANDLE_LIMITS[timeframe],
          })
        : await fetchCandles(
            pair,
            timeframe,
            3000,
            replayWindowStart
              ? new Date(replayWindowStart * 1000).toISOString()
              : undefined,
            replayWindowEnd
              ? new Date(replayWindowEnd * 1000).toISOString()
              : undefined,
            "demo",
          );
    if (candles.length < 20)
      return res.status(422).json({ error: `Not enough ${timeframe} candles` });
    const swings = determineSwingPoints(candles);
    const historicalLegs: SwingLeg[] = [];
    for (let index = 0; index < swings.length - 1; index += 1) {
      const left = swings[index];
      const right = swings[index + 1];
      const direction = getGoldilocksStructureBreakingLegDirection(
        left.swing,
        right.swing,
      );
      if (!direction) continue;
      const startIndex = candles.findIndex(
        (candle) => candle.time === left.time,
      );
      const endIndex = candles.findIndex(
        (candle) => candle.time === right.time,
      );
      if (startIndex >= 0 && endIndex > startIndex)
        historicalLegs.push({
          direction,
          startIndex,
          endIndex,
          startSwing: left.swing,
          endSwing: right.swing,
          brokeOppositeLegIn:
            (left.swing === "LL" && right.swing === "HH") ||
            (left.swing === "HH" && right.swing === "LL"),
        });
    }
    let leg: SwingLeg | null = null;
    let swingA = null;
    let swingB = null;

    for (let index = swings.length - 2; index >= 0; index -= 1) {
      const left = swings[index];
      const right = swings[index + 1];
      const direction = getGoldilocksStructureBreakingLegDirection(
        left.swing,
        right.swing,
      );
      if (!direction) continue;
      const startIndex = candles.findIndex(
        (candle) => candle.time === left.time,
      );
      const endIndex = candles.findIndex(
        (candle) => candle.time === right.time,
      );
      if (startIndex < 0 || endIndex <= startIndex) continue;
      leg = {
        direction,
        startIndex,
        endIndex,
        startSwing: left.swing,
        endSwing: right.swing,
        brokeOppositeLegIn:
          (left.swing === "LL" && right.swing === "HH") ||
          (left.swing === "HH" && right.swing === "LL"),
      };
      swingA = left;
      swingB = right;
      break;
    }

    if (!leg)
      return res
        .status(422)
        .json({ error: `No completed ${timeframe} swing leg was found` });
    const strategyCandles = candles.map((candle) => ({
      time: Math.floor(new Date(candle.time).getTime() / 1000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    // Always build the authoritative M15 zones from the same depth/source. Reusing
    // the display candles on M15 produced different zone IDs than M5/H1 views.
    const deepZoneRaw = replayWindow
      ? await fetchCandles(
          pair,
          strategyStack.zone,
          5_000,
          new Date(replayWindowStart! * 1000).toISOString(),
          new Date(replayWindowEnd! * 1000).toISOString(),
          "demo",
        )
      : await fetchCandleHistory(pair, strategyStack.zone, {
          lookbackDays: strategyStack.id === "multiDay" ? 3650 : 730,
          mode: "demo",
          backfillPages: 0,
          maxCandles: GOLDILOCKS_LIVE_CANDLE_LIMITS[strategyStack.zone],
        });
    const deepZoneHistory = buildGoldilocksHistoryChunked(
      deepZoneRaw,
      1_000,
      200,
      { trackTouches: false },
    );
    const deepZoneStrategy = toStrategyCandles(deepZoneRaw);
    const deepZoneLegs = buildGoldilocksLegs(deepZoneRaw);
    const imbalanceBalanceZones: GoldilocksZone[] = [];
    const latestZoneLeg = deepZoneLegs.at(-1);
    const detection = latestZoneLeg
      ? detectGoldilocksZones(deepZoneStrategy, latestZoneLeg)
      : detectGoldilocksZones(strategyCandles, leg);
    const zoneHistory = deepZoneHistory;
    const replayDisplayTime = Number.isFinite(requestedTradeTime)
      ? (storedReplayForRequest?.confirmationTime ?? requestedTradeTime)
      : Number.isFinite(requestedZoneTime)
        ? requestedZoneTime
        : undefined;
    const replayDisplayCandle =
      replayDisplayTime === undefined
        ? undefined
        : [...strategyCandles]
            .reverse()
            .find((candle) => candle.time <= replayDisplayTime);
    const currentPrice =
      storedReplayForRequest?.entry ??
      replayDisplayCandle?.close ??
      strategyCandles[strategyCandles.length - 1].close;
    // A historical replay must never draw a zone from the final state of the
    // downloaded history. Select only zones that were known and usable when the
    // stored M5 confirmation completed; otherwise future bases appear as ghosts.
    const displayZonePool =
      replayDisplayTime === undefined
        ? zoneHistory.activeZones
        : zoneHistory.zones.filter((zone) =>
            zoneWasUsableAt(zone, replayDisplayTime),
          );
    const nearestDemand = displayZonePool
      .filter((zone) => zone.side === "demand" && zone.low <= currentPrice)
      .sort(
        (a, b) =>
          Math.max(0, currentPrice - a.high) -
          Math.max(0, currentPrice - b.high),
      )[0];
    const nearestSupply = displayZonePool
      .filter((zone) => zone.side === "supply" && zone.high >= currentPrice)
      .sort(
        (a, b) =>
          Math.max(0, a.low - currentPrice) - Math.max(0, b.low - currentPrice),
      )[0];
    const nearestZones = [nearestDemand, nearestSupply].filter(
      (zone): zone is NonNullable<typeof zone> => Boolean(zone),
    );
    const storedTargetZone =
      storedReplayForRequest?.setAndForgetTargetMode === "opposing-base"
        ? displayZonePool.find(
            (zone) =>
              zone.kind === "base" &&
              zone.side !==
                (storedReplayForRequest.direction === "BUY"
                  ? "demand"
                  : "supply") &&
              (zone.id === storedReplayForRequest.setAndForgetTargetZoneId ||
                (Number.isFinite(storedTargetZoneCandleTime) &&
                  zone.candleTime === storedTargetZoneCandleTime)) &&
              (storedReplayForRequest.direction === "SELL"
                ? zone.high === storedReplayForRequest.takeProfit
                : zone.low === storedReplayForRequest.takeProfit),
          )
        : undefined;
    const detectedRecentBase = detection.zones.find(
      (zone) => zone.kind === "base",
    );
    const recentSwingBase =
      replayDisplayTime === undefined && detectedRecentBase
        ? displayZonePool.find(
            (zone) =>
              zone.kind === "base" &&
              zone.side === detectedRecentBase.side &&
              zone.candleTime === detectedRecentBase.candleTime,
          )
        : undefined;
    const recentDemandBase = displayZonePool
      .filter((zone) => zone.kind === "base" && zone.side === "demand")
      .sort((a, b) => b.candleTime - a.candleTime)[0];
    const recentSupplyBase = displayZonePool
      .filter((zone) => zone.kind === "base" && zone.side === "supply")
      .sort((a, b) => b.candleTime - a.candleTime)[0];
    const zoneCandleSeconds =
      GOLDILOCKS_TIMEFRAME_SECONDS[strategyStack.zone] ?? 900;
    const displayPurityCutoff = replayDisplayTime ?? Number.POSITIVE_INFINITY;
    const displayZones = [
      ...nearestZones,
      ...(storedTargetZone ? [storedTargetZone] : []),
      ...(recentSwingBase ? [recentSwingBase] : []),
      ...(recentDemandBase ? [recentDemandBase] : []),
      ...(recentSupplyBase ? [recentSupplyBase] : []),
    ]
      .filter(
        (zone, index, items) =>
          items.findIndex((item) => item.id === zone.id) === index,
      )
      .map((zone) => {
        if (
          storedReplayForRequest &&
          isStoredReplayZoneMatch(zone, storedReplayForRequest)
        ) {
          return {
            ...zone,
            touches: storedReplayForRequest.priorTouches,
            maxPenetration: 0,
          };
        }
        return annotateReplayZonePurityAt(
          zone,
          deepZoneStrategy,
          zoneCandleSeconds,
          displayPurityCutoff,
        );
      });
    const researchDisplayZones: GoldilocksZone[] = [];
    const scoringTimeframes: string[] = [...strategyStack.confluence];
    const otherTimeframeHistories = await Promise.all(
      scoringTimeframes
        .filter((item) => item !== strategyStack.zone)
        .map(async (item) => {
          const timeframeCandles = storedReplayForRequest
            ? await fetchCandles(
                pair,
                item,
                5_000,
                new Date(replayWindowStart! * 1000).toISOString(),
                new Date(
                  (item === strategyStack.confirmation
                    ? replayConfirmationEnd!
                    : replayWindowEnd!) * 1000,
                ).toISOString(),
                "demo",
              )
            : await fetchCandleHistory(pair, item, {
                lookbackDays:
                  item === strategyStack.confirmation
                    ? 90
                    : strategyStack.id === "multiDay"
                      ? 3650
                      : 730,
                mode: "demo",
                backfillPages: 0,
                maxCandles: GOLDILOCKS_LIVE_CANDLE_LIMITS[item],
              });
          return {
            timeframe: item,
            candles: timeframeCandles,
            history: buildGoldilocksHistoryChunked(
              timeframeCandles,
              1_000,
              200,
            ),
          };
        }),
    );
    const confluenceSources = [
      {
        timeframe: strategyStack.zone,
        candles: deepZoneRaw,
        history: deepZoneHistory,
      },
      ...otherTimeframeHistories,
    ];
    const annotatedDisplayZones =
      replayDisplayTime === undefined
        ? annotateTimeframeConfluence(
            displayZones,
            strategyStack.zone,
            confluenceSources
              .filter((group) => group.timeframe !== strategyStack.zone)
              .map((group) => ({
                timeframe: group.timeframe,
                zones: group.history.activeZones,
              })),
          )
        : displayZones.map((zone) =>
            annotateConfluenceAt(
              zone,
              strategyStack.zone,
              replayDisplayTime,
              confluenceSources,
            ),
          );
    // The stored backtest score is authoritative for the selected trade zone's
    // entry-time ZIZ count. A bounded chart replay may not contain the much older
    // M5/H1 source zones even though they were present in the full backtest history.
    const displayZonesWithConfluence = annotatedDisplayZones.map((zone) => {
      const storedCount = isStoredReplayZoneMatch(zone, storedReplayForRequest)
        ? storedReplayForRequest?.confluenceCount
        : undefined;
      const currentCount = zone.timeframeConfluence?.timeframeCount ?? 1;
      if (!storedCount || storedCount <= currentCount) return zone;
      return {
        ...zone,
        timeframeConfluence: {
          timeframes:
            storedCount === scoringTimeframes.length
              ? [...scoringTimeframes]
              : (zone.timeframeConfluence?.timeframes ?? [strategyStack.zone]),
          timeframeCount: storedCount,
          overlaps: zone.timeframeConfluence?.overlaps ?? [],
        },
      };
    });
    const displayZonesWithResearch = [
      ...displayZonesWithConfluence,
      ...researchDisplayZones,
    ];
    const drawableZones = getDrawableGoldilocksZones(displayZonesWithResearch);
    const drawableNearestZones = getDrawableGoldilocksZones(nearestZones);
    const deepConfirmationRaw =
      timeframe === strategyStack.confirmation
        ? candles
        : (otherTimeframeHistories.find(
            (source) => source.timeframe === strategyStack.confirmation,
          )?.candles ?? []);
    const historicalCandles = toStrategyCandles(deepConfirmationRaw).filter(
      (candle) =>
        candle.time >=
        Math.floor(
          new Date(deepZoneRaw[0]?.time ?? candles[0].time).getTime() / 1000,
        ),
    );
    const zoneTouchCandles = toStrategyCandles(deepZoneRaw);
    const confirmationCandleSeconds =
      GOLDILOCKS_TIMEFRAME_SECONDS[strategyStack.confirmation] ?? 300;
    const historicalConfluenceSources = confluenceSources;
    const currentTrend = getGoldilocksTrend(
      historicalConfluenceSources.find(
        (source) => source.timeframe === strategyStack.trend,
      )?.candles ?? [],
      strategyCandles.at(-1)?.time,
    );
    const rejectedFirstTouches: Array<{
      zoneId: string;
      zoneSide: "demand" | "supply";
      time: number;
      candle: (typeof historicalCandles)[number];
      touchRangeZoneFraction: number;
      maxTouchRangeZoneFraction: number;
      reason: string;
    }> = [];
    const historicalEntrySetups = deepZoneHistory.zones.flatMap((zone) => {
      if (zone.kind !== "base") return [];
      const departureQuality = validateGoldilocksDepartureQuality(zone);
      if (!departureQuality.allowed) return [];
      const formationWindow = getGoldilocksZoneFormationWindow(
        zone,
        zoneCandleSeconds,
      );
      const formationNewsGate = getHistoricalNewsGateForRange(
        pair,
        formationWindow.start,
        formationWindow.end,
      );
      if (!formationNewsGate.allowed) return [];
      const touchState = createHistoricalZoneTouchState();
      const completedSetups: Array<Record<string, unknown>> = [];
      for (
        let index = firstCandleAfter(
          historicalCandles,
          zone.availableAt ?? zone.candleTime,
        );
        index < historicalCandles.length;
        index += 1
      ) {
        const candle = historicalCandles[index];
        if (candle.time > zoneExpiresAt(zone.candleTime)) break;
        if (zone.invalidatedAt && candle.time >= zone.invalidatedAt) break;
        const broken =
          zone.side === "demand"
            ? candle.low < zone.low
            : candle.high > zone.high;
        if (broken) break;
        const touchedCandle =
          touchState.touchCandleIndex >= 0
            ? historicalCandles[touchState.touchCandleIndex]
            : undefined;
        const confirmed =
          touchedCandle !== undefined &&
          (zone.side === "demand"
            ? candle.close > candle.open && candle.close > touchedCandle.high
            : candle.close < candle.open && candle.close < touchedCandle.low);
        if (!confirmed) {
          if (touchState.touchCandleIndex < 0) {
            const armed = summarizeZoneTimeframeTouches(
              zone,
              zoneTouchCandles,
              zoneCandleSeconds,
              candle.time,
            );
            if (armed.invalidated) break;
            if (
              armed.firstOutsideTime !== undefined &&
              candle.time >= armed.firstOutsideTime &&
              candle.high >= zone.low &&
              candle.low <= zone.high
            ) {
              touchState.touchCandleIndex = index;
            }
          }
          continue;
        }
        const purity = summarizeConfirmationTimeframeTouches(
          zone,
          historicalCandles,
          confirmationCandleSeconds,
          touchedCandle.time,
        );
        if (purity.invalidated) break;
        const proximity = validateGoldilocksEntryProximity(
          zone,
          touchedCandle,
          candle.close,
          candle.close,
        );
        const approachGate = validateGoldilocksZoneApproach(
          zone,
          historicalCandles,
          touchState.touchCandleIndex,
        );
        if (!approachGate.allowed) {
          proximity.allowed = false;
          proximity.reason = approachGate.reason;
        }
        if (!proximity.allowed) break;
        const knownAtConfirmation = deepZoneHistory.zones.filter((item) =>
          zoneWasUsableAt(item, candle.time),
        );
        const check = validateTwoToOneRunway(
          zone,
          knownAtConfirmation,
          candle.close,
          { knownZonesUsableAtEntry: true },
        );
        if (check.allowed) {
          const confluenceZone = annotateConfluenceAt(
            {
              ...zone,
              touches: purity.touches,
              maxPenetration: 0,
            },
            strategyStack.zone,
            candle.time,
            historicalConfluenceSources,
          );
          const trendSource =
            historicalConfluenceSources.find(
              (source) => source.timeframe === strategyStack.trend,
            )?.candles ?? [];
          const trend = getGoldilocksTrend(trendSource, candle.time);
          const approachPressure = measureGoldilocksApproachPressure(
            confluenceZone,
            historicalCandles,
            touchState.touchCandleIndex,
            index,
          );
          const score = scoreGoldilocksSetup({
            zone: confluenceZone,
            tradeDirection: zone.side === "demand" ? "BUY" : "SELL",
            trend,
            minimumScore: getGoldilocksMinimumScore(),
            purityTouches: purity.touches,
            adverseWarningCount: approachPressure.adversePressureScore,
            gates: [
              {
                name: "Zone validity",
                passed: true,
                reason: "Zone was usable at confirmation time.",
              },
              {
                name: "Confirmation freshness",
                passed: true,
                reason: `Historical ${strategyStack.confirmation} confirmation completed after its touch candle.`,
              },
              {
                name: "Entry proximity",
                passed: true,
                reason: proximity.reason,
              },
              {
                name: "Zone formation news",
                passed: true,
                reason: formationNewsGate.reason,
              },
              { name: "2:1 runway", passed: true, reason: check.reason },
            ],
          });
          let outcomeIndex = -1;
          let outcome: "win" | "loss" | "open" = "open";
          let exitReason: "target" | "stop" | "break_even" | "open" = "open";
          let breakEvenActivated = false;
          const oneR =
            zone.side === "demand"
              ? check.entry + (check.entry - check.stopLoss)
              : check.entry - (check.stopLoss - check.entry);
          for (
            let futureIndex = index + 1;
            futureIndex < historicalCandles.length;
            futureIndex += 1
          ) {
            const future = historicalCandles[futureIndex];
            const activeStop = breakEvenActivated
              ? check.entry
              : check.stopLoss;
            const stopped =
              zone.side === "demand"
                ? future.low <= activeStop
                : future.high >= activeStop;
            const targeted =
              zone.side === "demand"
                ? future.high >= check.takeProfit
                : future.low <= check.takeProfit;
            if (stopped || targeted) {
              outcomeIndex = futureIndex;
              outcome = stopped && !breakEvenActivated ? "loss" : "win";
              exitReason = stopped
                ? breakEvenActivated
                  ? "break_even"
                  : "stop"
                : "target";
              break;
            }
            const reachedOneR =
              zone.side === "demand" ? future.high >= oneR : future.low <= oneR;
            if (reachedOneR) breakEvenActivated = true;
          }
          const setup = {
            zone: confluenceZone,
            zoneAgeSeconds: getGoldilocksZoneAgeSeconds(
              zone.candleTime,
              candle.time +
                (GOLDILOCKS_TIMEFRAME_SECONDS[strategyStack.confirmation] ??
                  300),
            ),
            firstOutsideTime: purity.firstOutsideTime,
            priorTouchDetails: purity.touchDetails,
            confirmationTimeframe: strategyStack.confirmation,
            confirmationTime: candle.time,
            confirmationCandle: candle,
            touchCandle: touchedCandle,
            proximity,
            runway: check,
            trend,
            score,
            outcome,
            exitReason,
            breakEvenActivated,
            outcomeTime:
              outcomeIndex >= 0
                ? historicalCandles[outcomeIndex].time
                : undefined,
          };
          if (outcomeIndex < 0) return [setup];
          completedSetups.push(setup);
          index = outcomeIndex;
        }
        touchState.touchCandleIndex = -1;
      }
      return completedSetups;
    }) as Array<{
      zone: (typeof zoneHistory.activeZones)[number];
      firstOutsideTime?: number;
      priorTouchDetails: Array<{
        time: number;
        price: number;
      }>;
      confirmationTimeframe: string;
      confirmationTime: number;
      confirmationCandle: (typeof strategyCandles)[number];
      touchCandle: (typeof strategyCandles)[number];
      proximity: GoldilocksEntryProximityCheck;
      runway: ReturnType<typeof validateTwoToOneRunway>;
      trend: ReturnType<typeof getGoldilocksTrend>;
      score: ReturnType<typeof scoreGoldilocksSetup>;
      outcome: "win" | "loss" | "open";
      exitReason: "target" | "stop" | "break_even" | "open";
      breakEvenActivated: boolean;
      outcomeTime?: number;
    }>;
    const eligibleHistoricalEntrySetups = historicalEntrySetups.filter(
      (setup) => setup.score.eligible,
    );
    const openHistoricalSetups = eligibleHistoricalEntrySetups
      .filter((setup) => setup.outcome === "open")
      .sort((a, b) => a.confirmationTime - b.confirmationTime);
    const nearestRequestedSetup = Number.isFinite(requestedTradeTime)
      ? ([...eligibleHistoricalEntrySetups].sort(
          (a, b) =>
            Math.abs(a.confirmationTime - requestedTradeTime) -
            Math.abs(b.confirmationTime - requestedTradeTime),
        )[0] ?? null)
      : null;
    const requestedHistoricalEntrySetup =
      nearestRequestedSetup &&
      Math.abs(nearestRequestedSetup.confirmationTime - requestedTradeTime) <=
        60
        ? nearestRequestedSetup
        : null;
    const currentStrategyVersion =
      "strategyVersion" in strategyStack
        ? strategyStack.strategyVersion
        : GOLDILOCKS_STRATEGY_VERSION;
    const currentStrategyReplay =
      storedReplayForRequest?.strategyVersion === currentStrategyVersion;
    const compatibleTimeframeReplay = isGoldilocksReplayStrategyCompatible(
      storedReplayForRequest?.strategyVersion,
      currentStrategyVersion,
    );
    const storedZoneForReplay = compatibleTimeframeReplay
      ? deepZoneHistory.zones.find((zone) =>
          isStoredReplayZoneMatch(zone, storedReplayForRequest),
        )
      : undefined;
    const storedZoneCorridor = storedReplayForRequest?.zoneCorridors?.find(
      (corridor) => corridor.timeframe === strategyStack.zone,
    );
    const storedReplayZone: GoldilocksZone | undefined =
      storedZoneForReplay ??
      (compatibleTimeframeReplay &&
      storedReplayForRequest &&
      Number.isFinite(storedZoneCandleTime)
        ? buildStoredReplayZoneFallback({
            zoneId: storedReplayForRequest.zoneId,
            zoneKind: storedReplayForRequest.zoneKind as GoldilocksZone["kind"],
            direction: storedReplayForRequest.direction,
            zoneCandleTime: storedZoneCandleTime,
            firstOutsideTime: storedReplayForRequest.firstOutsideTime,
            entry: storedReplayForRequest.entry,
            stopLoss: storedReplayForRequest.stopLoss,
            takeProfit: storedReplayForRequest.takeProfit,
            priorTouches: storedReplayForRequest.priorTouches,
            maxPenetration: storedReplayForRequest.maxPenetration,
            demandHigh: storedZoneCorridor?.demandHigh,
            supplyLow: storedZoneCorridor?.supplyLow,
          })
        : undefined);
    const storedConfirmationIndex = compatibleTimeframeReplay
      ? historicalCandles.findIndex(
          (candle) => candle.time === storedReplayForRequest!.confirmationTime,
        )
      : -1;
    const storedTouchState = createHistoricalZoneTouchState();
    if (storedReplayZone && storedConfirmationIndex > 0) {
      for (
        let index = firstCandleAfter(
          historicalCandles,
          storedReplayZone.availableAt ?? storedReplayZone.candleTime,
        );
        index < storedConfirmationIndex;
        index += 1
      ) {
        const candle = historicalCandles[index];
        if (
          storedReplayZone.invalidatedAt &&
          candle.time >= storedReplayZone.invalidatedAt
        )
          break;
        const broken =
          storedReplayZone.side === "demand"
            ? candle.low < storedReplayZone.low
            : candle.high > storedReplayZone.high;
        if (broken) break;
        if (storedTouchState.touchCandleIndex < 0) {
          const armed = summarizeZoneTimeframeTouches(
            storedReplayZone,
            zoneTouchCandles,
            zoneCandleSeconds,
            candle.time,
          );
          if (
            armed.firstOutsideTime !== undefined &&
            candle.time >= armed.firstOutsideTime &&
            candle.high >= storedReplayZone.low &&
            candle.low <= storedReplayZone.high
          )
            storedTouchState.touchCandleIndex = index;
        }
      }
    }
    const storedConfirmationCandle =
      storedConfirmationIndex >= 0
        ? historicalCandles[storedConfirmationIndex]
        : undefined;
    if (
      storedReplayForRequest?.confirmationMode === "touch-entry" &&
      storedConfirmationIndex >= 0
    ) {
      storedTouchState.touchCandleIndex = storedConfirmationIndex;
    }
    const storedTouchCandle =
      storedTouchState.touchCandleIndex >= 0
        ? historicalCandles[storedTouchState.touchCandleIndex]
        : undefined;
    const storedZoneAgeSeconds =
      storedReplayForRequest && storedReplayZone
        ? (storedReplayForRequest.zoneAgeSeconds ??
          getGoldilocksZoneAgeSeconds(
            storedReplayZone.candleTime,
            storedReplayForRequest.confirmationTime +
              (storedReplayForRequest.confirmationMode === "touch-entry"
                ? 0
                : (GOLDILOCKS_TIMEFRAME_SECONDS[strategyStack.confirmation] ??
                  300)),
          ))
        : undefined;
    const storedZoneMeetsCurrentAgeRule =
      storedZoneAgeSeconds !== undefined &&
      storedZoneAgeSeconds <= GOLDILOCKS_MAX_ZONE_AGE_SECONDS;
    const storedApproachPressure =
      storedZoneMeetsCurrentAgeRule &&
      storedReplayZone &&
      storedTouchState.touchCandleIndex >= 0 &&
      storedConfirmationIndex >= storedTouchState.touchCandleIndex
        ? measureGoldilocksApproachPressure(
            storedReplayZone,
            historicalCandles,
            storedTouchState.touchCandleIndex,
            storedConfirmationIndex,
          )
        : undefined;
    const storedPurity =
      storedReplayZone && storedTouchCandle
        ? summarizeConfirmationTimeframeTouches(
            storedReplayZone,
            historicalCandles,
            confirmationCandleSeconds,
            storedTouchCandle.time,
          )
        : undefined;
    const storedZoneFormation =
      storedZoneForReplay && storedTouchCandle
        ? summarizeZoneTimeframeTouches(
            storedZoneForReplay,
            deepZoneStrategy,
            zoneCandleSeconds,
            storedTouchCandle.time,
          )
        : undefined;
    const storedFormationCandleDetails = storedZoneForReplay
      ? getStrategyReplayZoneFormationDetails(
          storedZoneForReplay,
          deepZoneStrategy,
          storedZoneFormation?.firstOutsideTime ??
            storedReplayForRequest?.firstOutsideTime,
        )
      : [];
    const storedProximity =
      storedReplayZone && storedTouchCandle && storedConfirmationCandle
        ? validateGoldilocksEntryProximity(
            storedReplayZone,
            storedTouchCandle,
            storedConfirmationCandle.close,
            storedReplayForRequest?.entry,
          )
        : undefined;
    const storedRisk = storedReplayForRequest
      ? Math.abs(storedReplayForRequest.entry - storedReplayForRequest.stopLoss)
      : 0;
    const storedReward = storedReplayForRequest
      ? Math.abs(
          storedReplayForRequest.takeProfit - storedReplayForRequest.entry,
        )
      : 0;
    const storedManagerHasOneRPartial =
      storedReplayForRequest?.tradeManager ===
        GOLDILOCKS_DEFAULT_MANAGEMENT.policyId ||
      storedReplayForRequest?.tradeManager ===
        GOLDILOCKS_UNTOUCHED_STOP_RUNNER_MANAGEMENT_ID ||
      storedReplayForRequest?.tradeManager ===
        GOLDILOCKS_ADAPTIVE_SCALE_OUT_MANAGEMENT_ID;
    const storedPartialExitTime =
      storedManagerHasOneRPartial &&
      storedReplayForRequest.exitReason !== "stop" &&
      Number.isFinite(
        storedReplayForRequest.marketPath?.firstReachedAt?.["+1R"],
      )
        ? storedReplayForRequest.marketPath?.firstReachedAt?.["+1R"]
        : undefined;
    const storedAdaptiveScaleOuts =
      storedReplayForRequest?.tradeManager ===
      GOLDILOCKS_ADAPTIVE_SCALE_OUT_MANAGEMENT_ID
        ? (() => {
            const reached =
              storedReplayForRequest.marketPath?.firstReachedAt ?? {};
            const exits: Array<{
              time: number;
              price: number;
              fraction: number;
              realizedR: number;
              milestoneR: number;
              momentum: "fast" | "slow";
              attackSeconds: number | null;
            }> = [];
            let remaining = 1;
            for (const milestoneR of [1, 2, 3]) {
              const time = reached[`+${milestoneR}R`];
              if (!Number.isFinite(time) || remaining <= 0.25) continue;
              const halfTime = reached[`+${milestoneR - 0.5}R`];
              const attackSeconds = Number.isFinite(halfTime)
                ? Math.max(0, time - halfTime)
                : null;
              const momentum =
                attackSeconds !== null && attackSeconds <= 30 * 60
                  ? ("fast" as const)
                  : ("slow" as const);
              const fraction = Math.min(
                momentum === "fast" ? 0.25 : 0.5,
                remaining - 0.25,
              );
              if (fraction <= 0) continue;
              remaining -= fraction;
              exits.push({
                time,
                price:
                  storedReplayForRequest.direction === "BUY"
                    ? storedReplayForRequest.entry + milestoneR * storedRisk
                    : storedReplayForRequest.entry - milestoneR * storedRisk,
                fraction,
                realizedR: fraction * milestoneR,
                milestoneR,
                momentum,
                attackSeconds,
              });
            }
            return exits;
          })()
        : undefined;
    const storedExitR = (() => {
      if (!storedReplayForRequest) return undefined;
      switch (storedReplayForRequest.exitReason) {
        case "stop":
          return -1;
        case "break_even":
        case "one_r_protected":
          return 0;
        case "target":
          return storedReward / storedRisk;
        case "runner_stop":
          if (
            storedReplayForRequest.tradeManager ===
              GOLDILOCKS_UNTOUCHED_STOP_RUNNER_MANAGEMENT_ID ||
            storedReplayForRequest.tradeManager ===
              GOLDILOCKS_ADAPTIVE_SCALE_OUT_MANAGEMENT_ID
          )
            return -1;
          if (
            storedReplayForRequest.tradeManager ===
            GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID
          )
            return 1;
          return (
            ((storedReplayForRequest.realizedR ?? 0) -
              GOLDILOCKS_DEFAULT_MANAGEMENT.partialAtR *
                GOLDILOCKS_DEFAULT_MANAGEMENT.partialCloseFraction) /
            (1 - GOLDILOCKS_DEFAULT_MANAGEMENT.partialCloseFraction)
          );
        case "runner_target":
          return storedReplayForRequest.tradeManager ===
            GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID
            ? 4
            : 2;
        case "weekend_close":
          return Number.isFinite(storedPartialExitTime)
            ? ((storedReplayForRequest.realizedR ?? 0) -
                GOLDILOCKS_DEFAULT_MANAGEMENT.partialAtR *
                  GOLDILOCKS_DEFAULT_MANAGEMENT.partialCloseFraction) /
                (1 - GOLDILOCKS_DEFAULT_MANAGEMENT.partialCloseFraction)
            : storedReplayForRequest.realizedR;
        default:
          return undefined;
      }
    })();
    const storedExitPrice =
      storedReplayForRequest && Number.isFinite(storedExitR)
        ? storedReplayForRequest.direction === "BUY"
          ? storedReplayForRequest.entry + storedExitR! * storedRisk
          : storedReplayForRequest.entry - storedExitR! * storedRisk
        : undefined;
    const storedEntrySetup =
      compatibleTimeframeReplay &&
      storedReplayForRequest &&
      storedReplayZone &&
      storedTouchCandle &&
      storedConfirmationCandle &&
      storedProximity?.allowed
        ? {
            tradeId: storedReplayForRequest.tradeId,
            firstOutsideTime: currentStrategyReplay
              ? storedReplayForRequest.firstOutsideTime
              : (storedPurity?.firstOutsideTime ??
                storedReplayForRequest.firstOutsideTime),
            priorTouchDetails: reconcileStoredReplayPriorTouchDetails(
              currentStrategyReplay
                ? storedReplayForRequest.priorTouches
                : (storedPurity?.touches ??
                    storedReplayForRequest.priorTouches),
              currentStrategyReplay
                ? storedReplayForRequest.firstOutsideTime
                : (storedPurity?.firstOutsideTime ??
                    storedReplayForRequest.firstOutsideTime),
              storedTouchCandle.time,
              storedPurity?.touchDetails ?? [],
            ),
            formationCandleDetails: storedFormationCandleDetails,
            zone: {
              ...storedReplayZone,
              touches: currentStrategyReplay
                ? storedReplayForRequest.priorTouches
                : (storedPurity?.touches ??
                  storedReplayForRequest.priorTouches),
              maxPenetration: 0,
              departureInsideCandleCount:
                storedZoneFormation?.departureInsideCandleCount ?? 0,
              timeframeConfluence: displayZonesWithConfluence.find(
                (zone) => zone.id === storedReplayZone.id,
              )?.timeframeConfluence,
            },
            zoneAgeSeconds: storedZoneAgeSeconds,
            confirmationTimeframe: strategyStack.confirmation,
            confirmationMode:
              storedReplayForRequest.confirmationMode ?? "close-through",
            confirmationTime: storedReplayForRequest.confirmationTime,
            confirmationCandle: storedConfirmationCandle,
            touchCandle: storedTouchCandle,
            proximity: storedProximity,
            runway: {
              direction:
                storedReplayForRequest.direction === "BUY"
                  ? ("buy" as const)
                  : ("sell" as const),
              entry: storedReplayForRequest.entry,
              stopLoss: storedReplayForRequest.stopLoss,
              takeProfit: storedReplayForRequest.takeProfit,
              risk: storedRisk,
              reward: storedReward,
              ratio: storedRisk ? storedReward / storedRisk : 0,
              availableReward: Number.isFinite(
                storedReplayForRequest.availableRrr,
              )
                ? storedRisk * storedReplayForRequest.availableRrr
                : Infinity,
              availableRatio: storedReplayForRequest.availableRrr ?? Infinity,
              allowed: true,
              reason: `Stored backtest entry, stop, and target at the recorded ${strategyStack.confirmation} confirmation.`,
            },
            trend: (storedReplayForRequest.trend === "bullish" ||
            storedReplayForRequest.trend === "bearish"
              ? storedReplayForRequest.trend
              : "unknown") as ReturnType<typeof getGoldilocksTrend>,
            score: storedReplayForRequest.scoreJson as ReturnType<
              typeof scoreGoldilocksSetup
            >,
            realizedR: storedReplayForRequest.realizedR,
            tradeManager: storedReplayForRequest.tradeManager,
            setAndForgetTargetMode:
              storedReplayForRequest.setAndForgetTargetMode,
            setAndForgetTargetZoneId:
              storedReplayForRequest.setAndForgetTargetZoneId,
            partialExit: Number.isFinite(storedPartialExitTime)
              ? {
                  time: storedPartialExitTime!,
                  price: storedReplayForRequest.oneR,
                  fraction: GOLDILOCKS_DEFAULT_MANAGEMENT.partialCloseFraction,
                  realizedR:
                    GOLDILOCKS_DEFAULT_MANAGEMENT.partialAtR *
                    GOLDILOCKS_DEFAULT_MANAGEMENT.partialCloseFraction,
                }
              : undefined,
            partialExits:
              storedReplayForRequest.partialExits?.map((partial) => ({
                ...partial,
                price:
                  storedReplayForRequest.direction === "BUY"
                    ? storedReplayForRequest.entry +
                      partial.milestoneR * storedRisk
                    : storedReplayForRequest.entry -
                      partial.milestoneR * storedRisk,
              })) ?? storedAdaptiveScaleOuts,
            approachPressure: storedApproachPressure,
            zoneCorridors: storedReplayForRequest.zoneCorridors,
            marketPath: storedReplayForRequest.marketPath,
            managementPolicyResults:
              storedReplayForRequest.managementPolicyResults,
            outcome:
              storedReplayForRequest.outcome === "WIN"
                ? ("win" as const)
                : ("loss" as const),
            exitReason: storedReplayForRequest.exitReason,
            exitPrice: storedExitPrice,
            breakEvenActivated: storedReplayForRequest.exitReason !== "stop",
            outcomeTime: storedReplayForRequest.outcomeTime,
          }
        : null;
    const reconstructedEntrySetup = Number.isFinite(requestedZoneTime)
      ? null
      : Number.isFinite(requestedTradeTime)
        ? (storedEntrySetup ?? requestedHistoricalEntrySetup)
        : (openHistoricalSetups[0] ??
          eligibleHistoricalEntrySetups.sort(
            (a, b) => b.confirmationTime - a.confirmationTime,
          )[0] ??
          null);
    const storedReplay = storedReplayForRequest;
    const replayExitTime = Number.isFinite(requestedExitTime)
      ? requestedExitTime
      : storedReplay?.outcomeTime;
    const historicalEntrySetup =
      reconstructedEntrySetup && Number.isFinite(replayExitTime)
        ? {
            ...reconstructedEntrySetup,
            outcomeTime: replayExitTime,
            outcome:
              storedReplay?.outcome === "LOSS"
                ? ("loss" as const)
                : storedReplay?.outcome === "WIN"
                  ? ("win" as const)
                  : reconstructedEntrySetup.outcome,
            exitReason:
              storedReplay?.exitReason ?? reconstructedEntrySetup.exitReason,
            exitPrice: storedExitPrice,
          }
        : reconstructedEntrySetup;
    const replayEntryEligibilityTime = historicalEntrySetup
      ? historicalEntrySetup.confirmationTime +
        (GOLDILOCKS_TIMEFRAME_SECONDS[strategyStack.confirmation] ?? 300)
      : undefined;
    const marketTimeAudit =
      replayEntryEligibilityTime === undefined
        ? null
        : (() => {
            const date = new Date(replayEntryEligibilityTime * 1000);
            const holiday = getForexHolidayStatusAt(date);
            return {
              entryEligibilityTime: replayEntryEligibilityTime,
              marketTimeZone: "America/New_York",
              weeklyBlocked: isForexWeekendEntryBlocked(date),
              holiday,
            };
          })();
    let departureSpeed: ReturnType<
      typeof measureGoldilocksIntrabarDepartureSpeed
    >;
    const departureTime =
      historicalEntrySetup?.zone.departureQuality?.departureCandleTime;
    if (
      Number.isFinite(requestedTradeTime) &&
      historicalEntrySetup &&
      departureTime !== undefined
    ) {
      try {
        const intrabarRaw = await fetchCandles(
          pair,
          "M1",
          100,
          new Date((departureTime - 30 * 60) * 1000).toISOString(),
          new Date((departureTime + 15 * 60) * 1000).toISOString(),
          "demo",
        );
        departureSpeed = measureGoldilocksIntrabarDepartureSpeed(
          historicalEntrySetup.zone,
          intrabarRaw.map((candle) => ({
            time: Math.floor(new Date(candle.time).getTime() / 1000),
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          })),
        );
      } catch {
        departureSpeed = undefined;
      }
    }
    const historicalEntrySetupWithAudit = historicalEntrySetup
      ? { ...historicalEntrySetup, departureSpeed }
      : historicalEntrySetup;
    const runwayChecks = detection.zones.map((zone) => ({
      zoneId: zone.id,
      ...validateTwoToOneRunway(zone, zoneHistory.activeZones),
    }));
    const displayIndexAtOrAfter = (time: number) => {
      const index = strategyCandles.findIndex((candle) => candle.time >= time);
      return index >= 0 ? index : strategyCandles.length - 1;
    };
    const earliestActiveIndex = zoneHistory.activeZones.length
      ? Math.min(
          ...zoneHistory.activeZones.map((zone) =>
            displayIndexAtOrAfter(zone.candleTime),
          ),
        )
      : leg.startIndex;
    const replayContextAnchor = historicalEntrySetup
      ? getStrategyReplayContextAnchor(
          historicalEntrySetup.zone.candleTime,
          historicalEntrySetup.priorTouchDetails.map((touch) => touch.time),
          drawableZones.map((zone) => zone.candleTime),
        )
      : undefined;
    const replayBaseContextIndex =
      replayContextAnchor !== undefined
        ? displayIndexAtOrAfter(
            getStrategyReplayBaseContextStart(replayContextAnchor),
          )
        : undefined;
    const researchZoneContextIndex = Number.isFinite(requestedZoneTime)
      ? weekView
        ? 0
        : Math.max(0, displayIndexAtOrAfter(requestedZoneTime) - 48)
      : undefined;
    const viewEnd = candles.length - 1;
    const viewStart =
      replayBaseContextIndex ??
      researchZoneContextIndex ??
      Math.max(0, Math.min(leg.startIndex - 200, earliestActiveIndex - 20));
    const finalEntryChecks = detection.zones.map((zone) => {
      const storedZone =
        zoneHistory.zones.find(
          (item) =>
            item.kind === zone.kind &&
            item.side === zone.side &&
            item.candleTime === zone.candleTime,
        ) ?? zone;
      if (storedZone.firstTouchIndex === undefined) {
        return {
          zoneId: zone.id,
          confirmed: false,
          reason: "The zone has not been touched after price left it.",
        };
      }
      const confirmation = findCloseBeyondTouchedCandle(
        strategyCandles,
        storedZone.side === "demand" ? "bullish" : "bearish",
        storedZone.firstTouchIndex,
      );
      if (!confirmation.confirmed || confirmation.candleIndex === undefined) {
        return {
          zoneId: zone.id,
          confirmed: false,
          reason: confirmation.reason,
        };
      }
      const engulfClose = strategyCandles[confirmation.candleIndex].close;
      return {
        zoneId: zone.id,
        confirmed: true,
        confirmationCandleIndex: confirmation.candleIndex - viewStart,
        ...validateFinalEntryAfterEngulf(
          storedZone,
          zoneHistory.activeZones,
          engulfClose,
          currentPrice,
        ),
      };
    });
    const visibleCandles = candles
      .slice(viewStart, viewEnd + 1)
      .map((candle) => ({
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
      .filter((swing) => ["HH", "HL", "LH", "LL"].includes(swing.swing))
      .filter(
        (swing) =>
          swing.candleIndex >= viewStart && swing.candleIndex <= viewEnd,
      )
      .map((swing) => ({
        swing: swing.swing,
        price: swing.price,
        candleIndex: swing.candleIndex - viewStart,
        time: Math.floor(new Date(swing.time!).getTime() / 1000),
      }));

    res.setHeader("Cache-Control", "no-store");
    const payload = {
      pair,
      timeframe,
      strategyStack,
      currentTrend,
      fetchedAt: new Date().toISOString(),
      pagination: {
        nextBefore: strategyCandles[0]?.time ?? null,
        nextAfter: strategyCandles.at(-1)?.time ?? null,
        hasMore: candles.length >= 100,
        hasNewer:
          (strategyCandles.at(-1)?.time ?? Number.POSITIVE_INFINITY) <
          Math.floor(Date.now() / 1000) -
            (GOLDILOCKS_TIMEFRAME_SECONDS[timeframe] ?? 300),
      },
      candles: visibleCandles,
      chartViews: Object.fromEntries(
        confluenceSources.map((source) => [
          source.timeframe,
          {
            candles: toStrategyCandles(source.candles),
            swings: determineSwingPoints(source.candles)
              .filter((swing) => ["HH", "HL", "LH", "LL"].includes(swing.swing))
              .map((swing) => ({
                swing: swing.swing,
                price: swing.price,
                candleIndex: swing.candleIndex,
                time: Math.floor(new Date(swing.time!).getTime() / 1000),
              })),
          },
        ]),
      ),
      confirmationCandles: Number.isFinite(requestedTradeTime)
        ? historicalCandles
        : null,
      displayTimeframe: timeframe,
      leg: visibleLeg,
      swingA,
      swingB,
      swings: visibleSwings,
      runwayChecks,
      finalEntryChecks,
      historicalEntrySetup: historicalEntrySetupWithAudit,
      marketTimeAudit,
      requestedTradeTime: Number.isFinite(requestedTradeTime)
        ? requestedTradeTime
        : null,
      requestedZoneTime: Number.isFinite(requestedZoneTime)
        ? requestedZoneTime
        : null,
      replayStrategyVersion:
        storedReplayForRequest?.strategyVersion ?? "legacy-m15-m5-m1",
      currentStrategyVersion,
      legacyReplay: Boolean(storedReplayForRequest && !currentStrategyReplay),
      historicalMatchDeltaSeconds: requestedHistoricalEntrySetup
        ? Math.abs(
            requestedHistoricalEntrySetup.confirmationTime - requestedTradeTime,
          )
        : null,
      historicalEntrySetups: eligibleHistoricalEntrySetups,
      rejectedFirstTouches: filterReplayRejectedFirstTouchesAt(
        rejectedFirstTouches,
        zoneHistory.zones,
        replayDisplayTime ??
          strategyCandles.at(-1)?.time ??
          Number.NEGATIVE_INFINITY,
        new Set(drawableZones.map((zone) => zone.id)),
      ).filter(
        (rejected) =>
          rejected.time >=
            (visibleCandles[0]?.time ?? Number.NEGATIVE_INFINITY) &&
          rejected.time <=
            (visibleCandles.at(-1)?.time ?? Number.POSITIVE_INFINITY),
      ),
      backtestCoverage: {
        from: historicalCandles[0]?.time ?? null,
        to: historicalCandles.at(-1)?.time ?? null,
        candles: historicalCandles.length,
        trendTimeframe: strategyStack.trend,
        zoneTimeframe: strategyStack.zone,
        confirmationTimeframe: strategyStack.confirmation,
      },
      zoneHistory: {
        zones: zoneHistory.zones.map((zone) => ({
          ...zone,
          candleIndex: displayIndexAtOrAfter(zone.candleTime) - viewStart,
        })),
        activeZones: zoneHistory.activeZones.map((zone) => ({
          ...zone,
          candleIndex: displayIndexAtOrAfter(zone.candleTime) - viewStart,
        })),
        activeDemand: zoneHistory.activeDemand
          ? {
              ...zoneHistory.activeDemand,
              candleIndex:
                displayIndexAtOrAfter(zoneHistory.activeDemand.candleTime) -
                viewStart,
            }
          : null,
        activeSupply: zoneHistory.activeSupply
          ? {
              ...zoneHistory.activeSupply,
              candleIndex:
                displayIndexAtOrAfter(zoneHistory.activeSupply.candleTime) -
                viewStart,
            }
          : null,
        nearestZones: drawableNearestZones.map((zone) => ({
          ...zone,
          candleIndex: displayIndexAtOrAfter(zone.candleTime) - viewStart,
        })),
        displayZones: drawableZones.map((zone) => ({
          ...zone,
          candleIndex: displayIndexAtOrAfter(zone.candleTime) - viewStart,
        })),
        imbalanceBalanceZones: imbalanceBalanceZones.map((zone) => ({
          ...zone,
          candleIndex: displayIndexAtOrAfter(zone.candleTime) - viewStart,
        })),
        recentSwingBase: recentSwingBase
          ? {
              ...recentSwingBase,
              candleIndex:
                displayIndexAtOrAfter(recentSwingBase.candleTime) - viewStart,
            }
          : null,
        recentDemandBase: recentDemandBase
          ? {
              ...recentDemandBase,
              candleIndex:
                displayIndexAtOrAfter(recentDemandBase.candleTime) - viewStart,
            }
          : null,
        recentSupplyBase: recentSupplyBase
          ? {
              ...recentSupplyBase,
              candleIndex:
                displayIndexAtOrAfter(recentSupplyBase.candleTime) - viewStart,
            }
          : null,
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
    if (replayCacheKey) {
      if (replayCache.size >= 30)
        replayCache.delete(replayCache.keys().next().value!);
      replayCache.set(replayCacheKey, {
        expiresAt: Date.now() + 5 * 60_000,
        payload,
      });
    }
    return res.status(200).json(payload);
  } catch (error) {
    console.error("[strategy-lab/zones]", error);
    return res.status(500).json({ error: (error as Error).message });
  }
}
