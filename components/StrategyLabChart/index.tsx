import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createSeriesMarkers,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import styled from "styled-components";
import type { GoldilocksApproachPressure } from "../../utils/approachPressure";
import {
  detectGoldilocksZones,
  findGoldilocksZoneDistalBreakTime,
  findFullCandleEngulfing,
  validateFinalEntryAfterEngulf,
  type GoldilocksDetection,
  type GoldilocksZone,
  type StrategyCandle,
  type SwingLeg,
  type TradeRunwayCheck,
} from "../../utils/goldilocksStrategy";
import {
  formatStrategyChartTimeEnid,
  formatStrategyReplayEnid,
  formatStrategyZoneLabel,
  getReplayCandleIndexAtOrBefore,
  getReplayExitMarkerPrice,
  getReplayVisibleEnd,
  getReplayVisibleStart,
  sortUniqueReplayCandleItems,
} from "../../utils/strategyReplay";

type Zone = {
  id: string;
  label: string;
  kind: "demand" | "supply";
  low: number;
  high: number;
  startTime: UTCTimestamp;
  endTime: UTCTimestamp;
  baseTime: UTCTimestamp;
  historicalTradeZone: boolean;
  researchIbi: boolean;
};

const Wrap = styled.div`
  position: relative;
  width: 100%;
  height: 540px;
  border: 1px solid #2b303a;
  border-radius: 18px;
  overflow: hidden;
  background: #080a0e;
`;
const Canvas = styled.div`
  position: absolute;
  inset: 0;
`;
const TimeframeToolbar = styled.div`
  position: absolute;
  right: 76px;
  top: 12px;
  z-index: 5;
  display: flex;
  align-items: center;
  padding: 3px;
  border: 1px solid #2b303a;
  border-radius: 7px;
  background: rgba(8, 10, 14, 0.92);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
`;
const TimeframeButton = styled.button<{ active: boolean }>`
  min-width: 38px;
  border: 0;
  border-radius: 5px;
  padding: 5px 7px;
  background: ${({ active }) => (active ? "#2a2e39" : "transparent")};
  color: ${({ active }) => (active ? "#f0f3fa" : "#9598a1")};
  font: 700 11px/1 system-ui;
  cursor: pointer;
  &:hover:not(:disabled) {
    background: #1e222d;
    color: #d1d4dc;
  }
  &:focus-visible {
    outline: 2px solid #2962ff;
    outline-offset: 1px;
  }
  &:disabled {
    cursor: wait;
    opacity: 0.55;
  }
`;
const DrawingToolbar = styled.div`
  position: absolute;
  left: 12px;
  bottom: 34px;
  z-index: 6;
  display: flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid #2b303a;
  border-radius: 7px;
  background: rgba(8, 10, 14, 0.92);
`;
const HistoryButton = styled.button<{ side: "older" | "newer" }>`
  position: absolute;
  ${({ side }) => (side === "older" ? "left: 12px;" : "right: 76px;")}
  top: 50%;
  z-index: 8;
  transform: translateY(-50%);
  border: 1px solid #4a5568;
  border-radius: 8px;
  padding: 8px 10px;
  background: rgba(8, 10, 14, 0.94);
  color: #f0f3fa;
  font: 700 11px/1 system-ui;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  &:hover:not(:disabled) {
    border-color: #7d8da8;
    background: #1e222d;
  }
  &:focus-visible {
    outline: 2px solid #2962ff;
    outline-offset: 2px;
  }
  &:disabled {
    cursor: wait;
    opacity: 0.6;
  }
`;
const TradeIdBadge = styled.button`
  position: absolute;
  right: 76px;
  bottom: 34px;
  z-index: 8;
  max-width: calc(100% - 360px);
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 7px 11px;
  background:
    linear-gradient(#11141b, #11141b) padding-box,
    linear-gradient(110deg, #ff70d7, #a97cff, #62e9ff) border-box;
  color: #fff;
  box-shadow:
    0 0 18px rgba(226, 91, 255, 0.3),
    inset 0 1px rgba(255, 255, 255, 0.12);
  font: 850 10px/1 system-ui;
  letter-spacing: 0.035em;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: copy;
  &:hover {
    color: #9ff8ff;
    box-shadow:
      0 0 24px rgba(98, 233, 255, 0.4),
      inset 0 1px rgba(255, 255, 255, 0.16);
  }
  &:focus-visible {
    outline: 2px solid #62e9ff;
    outline-offset: 2px;
  }
  @media (max-width: 760px) {
    right: 12px;
    bottom: 72px;
    max-width: calc(100% - 24px);
  }
`;
const Overlay = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
`;
const Box = styled.div<{
  kind: "demand" | "supply";
  historicalTradeZone: boolean;
  researchIbi: boolean;
}>`
  position: absolute;
  border: 2px ${({ researchIbi }) => (researchIbi ? "dashed" : "solid")}
    ${({ kind, historicalTradeZone, researchIbi }) => (historicalTradeZone ? "#f4a340" : researchIbi ? "#b77cff" : kind === "demand" ? "#26bdf3" : "#ff4f91")};
  background: ${({ kind, historicalTradeZone, researchIbi }) => (historicalTradeZone ? "rgba(191,112,24,.22)" : researchIbi ? "rgba(143,84,220,.14)" : kind === "demand" ? "rgba(24,145,204,.18)" : "rgba(211,31,105,.18)")};
  box-shadow: 0 0 18px
    ${({ kind, historicalTradeZone, researchIbi }) => (historicalTradeZone ? "rgba(244,163,64,.24)" : researchIbi ? "rgba(183,124,255,.20)" : kind === "demand" ? "rgba(38,189,243,.17)" : "rgba(255,79,145,.14)")};
`;
const Label = styled.span`
  position: absolute;
  left: 5px;
  top: 4px;
  color: #ecf9ff;
  font: 700 10px/1.2 system-ui;
  background: rgba(8, 8, 14, 0.78);
  padding: 3px 5px;
  border-radius: 4px;
`;
const TrendStatus = styled.div<{ direction: "bullish" | "bearish" }>`
  position: absolute;
  left: 14px;
  top: 14px;
  padding: 8px 11px;
  border-radius: 9px;
  border: 1px solid
    ${({ direction }) => (direction === "bullish" ? "#2edb91" : "#ff6876")};
  background: ${({ direction }) => (direction === "bullish" ? "rgba(12,67,48,.9)" : "rgba(83,22,32,.92)")};
  color: #fff;
  font: 800 11px/1.2 system-ui;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
`;
const RatioBox = styled.div<{ reward: boolean }>`
  position: absolute;
  border: 1px solid
    ${({ reward }) => (reward ? "rgba(46,219,145,.8)" : "rgba(255,95,112,.8)")};
  background: ${({ reward }) => (reward ? "rgba(46,219,145,.13)" : "rgba(255,95,112,.15)")};
`;
const TradeLevelLabel = styled.span<{ tone: "entry" | "stop" | "target" }>`
  position: absolute;
  z-index: 7;
  transform: translateY(-50%);
  padding: 3px 6px;
  border-radius: 3px;
  background: ${({ tone }) => (tone === "entry" ? "#ffd84d" : tone === "stop" ? "#ff5f70" : "#2edb91")};
  color: #071014;
  font: 800 10px/1 system-ui;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
`;

const start = Date.UTC(2026, 0, 5, 14, 0) / 1000;
const time = (index: number) => (start + index * 15 * 60) as UTCTimestamp;

const coreBullishValues = [
  [104.8, 105.4, 103.5, 104.0],
  [104.0, 104.3, 102.7, 103.1],
  [103.1, 103.4, 101.6, 102.0],
  [102.0, 102.5, 100.4, 100.9],
  [100.9, 101.3, 99.2, 99.7],
  [101.0, 101.4, 97.8, 98.8],
  [98.8, 101.8, 98.5, 101.4],
  [101.4, 103.2, 101.1, 102.9],
  [102.9, 104.4, 102.5, 104.0],
  [104.0, 104.2, 102.4, 102.8],
  [102.8, 106.1, 102.6, 105.8],
  [105.8, 108.3, 105.4, 108.0],
  [108.0, 110.2, 107.7, 109.8],
  [109.8, 112.0, 109.2, 111.5],
  [111.5, 111.7, 109.8, 110.2],
  [110.2, 110.5, 107.2, 107.8],
  [107.8, 108.1, 104.1, 104.6],
  [104.6, 105.0, 102.8, 103.5],
  [103.5, 105.2, 102.7, 104.6],
  [104.6, 106.4, 104.5, 106.0],
  [106.0, 107.3, 104.0, 104.5],
  [104.4, 107.5, 103.9, 107.1],
];
const historyAnchors = [108, 101, 110, 103, 112, 100, 109, 102, 106, 104.8];
const historyValues: number[][] = [];
for (let segment = 0; segment < historyAnchors.length - 1; segment += 1) {
  for (let step = 0; step < 10; step += 1) {
    const progress = step / 10;
    const center =
      historyAnchors[segment] +
      (historyAnchors[segment + 1] - historyAnchors[segment]) * progress;
    const next =
      historyAnchors[segment] +
      (historyAnchors[segment + 1] - historyAnchors[segment]) *
        ((step + 1) / 10);
    const open = center + (step % 2 === 0 ? 0.16 : -0.12);
    const close = next + (step % 3 === 0 ? -0.1 : 0.1);
    historyValues.push([
      open,
      Math.max(open, close) + 0.28,
      Math.min(open, close) - 0.28,
      close,
    ]);
  }
}
const testOffset = historyValues.length;
const bullishCandles: CandlestickData<Time>[] = [
  ...historyValues,
  ...coreBullishValues,
].map((c, index) => ({
  time: time(index),
  open: c[0],
  high: c[1],
  low: c[2],
  close: c[3],
}));

const bearishCandles: CandlestickData<Time>[] = bullishCandles.map(
  (c, index) => ({
    time: c.time,
    open: 220 - (c.open as number),
    high: 220 - (c.low as number),
    low: 220 - (c.high as number),
    close: 220 - (c.close as number),
  }),
);

type SwingMarker = {
  swing: "HH" | "HL" | "LH" | "LL";
  price: number;
  candleIndex: number;
  time: number;
};
type HistoricalTradeSetup = {
  tradeId?: string;
  zone: GoldilocksZone;
  priorTouchDetails?: Array<{
    time: number;
    price: number;
  }>;
  confirmationTimeframe: string;
  confirmationTime: number;
  confirmationCandle: StrategyCandle;
  touchCandle?: StrategyCandle;
  runway: TradeRunwayCheck;
  outcome: "win" | "loss" | "open";
  exitReason?: string;
  exitPrice?: number;
  outcomeTime?: number;
  approachPressure?: GoldilocksApproachPressure;
};
type RejectedFirstTouch = {
  zoneId: string;
  zoneSide: "demand" | "supply";
  time: number;
  candle: StrategyCandle;
  touchRangeZoneFraction: number;
  maxTouchRangeZoneFraction: number;
  reason: string;
};
type ChartScenario = {
  candles: StrategyCandle[];
  timeframe?: string;
  isReplay?: boolean;
  leg: SwingLeg;
  detection?: GoldilocksDetection;
  swings?: SwingMarker[];
  zones?: GoldilocksZone[];
  tradeSetup?: HistoricalTradeSetup | null;
  tradeSetups?: HistoricalTradeSetup[];
  rejectedFirstTouches?: RejectedFirstTouch[];
};
const chartTimeframes = ["M1", "M5", "M15", "H1"] as const;
type ChartTimeframe = (typeof chartTimeframes)[number];
type DrawingPoint = { time: number; price: number };
type ChartDrawing = {
  id: string;
  type: "box" | "fib";
  from: DrawingPoint;
  to: DrawingPoint;
};
const atOrAfterChartTime = (candles: CandlestickData<Time>[], target: number) =>
  (candles.find((candle) => Number(candle.time) >= target)?.time ??
    candles.at(-1)?.time) as UTCTimestamp;
const atOrBeforeChartTime = (
  candles: CandlestickData<Time>[],
  target: number,
) =>
  ([...candles].reverse().find((candle) => Number(candle.time) <= target)
    ?.time ?? candles[0]?.time) as UTCTimestamp;

export default function StrategyLabChart({
  direction,
  scenario,
  tradeId,
  runwayExample = "blocked",
  pricePrecision = 2,
  timeframe = "M5",
  drilldownTimeframe = "M1",
  drawingStorageKey = "test",
  timeframeLoading = false,
  hasOlder = false,
  hasNewer = false,
  onTimeframeChange,
  onLoadOlder,
  onLoadNewer,
}: {
  direction: "bullish" | "bearish";
  scenario?: ChartScenario;
  tradeId?: string;
  runwayExample?: "clear" | "blocked";
  pricePrecision?: number;
  timeframe?: ChartTimeframe;
  drilldownTimeframe?: ChartTimeframe;
  drawingStorageKey?: string;
  timeframeLoading?: boolean;
  hasOlder?: boolean;
  hasNewer?: boolean;
  onTimeframeChange?: (timeframe: ChartTimeframe) => void;
  onLoadOlder?: () => void | Promise<void>;
  onLoadNewer?: () => void | Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const visibleTimeRangeRef = useRef<{ from: Time; to: Time } | null>(null);
  const [positions, setPositions] = useState<
    Array<
      Zone & {
        left: number;
        top: number;
        width: number;
        height: number;
        baseX: number;
        showLabel: boolean;
      }
    >
  >([]);
  const [ratioPosition, setRatioPosition] = useState<{
    left: number;
    width: number;
    entryY: number;
    stopY: number;
    targetY: number;
  } | null>(null);
  const [indicatorRatios, setIndicatorRatios] = useState<
    Array<{
      id: string;
      left: number;
      width: number;
      entryY: number;
      stopY: number;
      targetY: number;
    }>
  >([]);
  const [drawingMode, setDrawingMode] = useState<"box" | "fib" | null>(null);
  const [lightMagnet, setLightMagnet] = useState(true);
  const [showLoadOlder, setShowLoadOlder] = useState(false);
  const [showLoadNewer, setShowLoadNewer] = useState(false);
  const [loadingHistorySide, setLoadingHistorySide] = useState<
    "older" | "newer" | null
  >(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [tradeIdCopied, setTradeIdCopied] = useState(false);
  const pendingDrawingPoint = useRef<DrawingPoint | null>(null);
  const copiedFeedbackTimer = useRef<number | null>(null);
  const skipDrawingPersist = useRef(true);
  const resolvedTradeId = tradeId ?? scenario?.tradeSetup?.tradeId;
  const replayViewportKey = scenario?.tradeSetup
    ? `${resolvedTradeId ?? "stored"}:${scenario.tradeSetup.confirmationTime}`
    : null;
  useEffect(() => {
    visibleTimeRangeRef.current = null;
    setTradeIdCopied(false);
  }, [replayViewportKey]);
  useEffect(
    () => () => {
      if (copiedFeedbackTimer.current)
        window.clearTimeout(copiedFeedbackTimer.current);
    },
    [],
  );
  const copyTradeId = async () => {
    if (!resolvedTradeId) return;
    try {
      await navigator.clipboard.writeText(resolvedTradeId);
    } catch {
      const input = document.createElement("textarea");
      input.value = resolvedTradeId;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setTradeIdCopied(true);
    if (copiedFeedbackTimer.current)
      window.clearTimeout(copiedFeedbackTimer.current);
    copiedFeedbackTimer.current = window.setTimeout(
      () => setTradeIdCopied(false),
      1800,
    );
  };
  useEffect(() => {
    visibleTimeRangeRef.current = null;
    skipDrawingPersist.current = true;
    try {
      const stored = JSON.parse(
        localStorage.getItem(`goldilocks-drawings:${drawingStorageKey}`) ??
          "[]",
      );
      setDrawings(
        Array.isArray(stored)
          ? stored.filter(
              (drawing: ChartDrawing) =>
                drawing.type === "box" || drawing.type === "fib",
            )
          : [],
      );
    } catch {
      setDrawings([]);
    }
  }, [drawingStorageKey]);
  useEffect(() => {
    if (skipDrawingPersist.current) {
      skipDrawingPersist.current = false;
      return;
    }
    try {
      localStorage.setItem(
        `goldilocks-drawings:${drawingStorageKey}`,
        JSON.stringify(drawings),
      );
    } catch {
      /* browser storage is optional */
    }
  }, [drawingStorageKey, drawings]);
  const candles = useMemo<CandlestickData<Time>[]>(
    () =>
      scenario
        ? scenario.candles.map((candle) => ({
            time: candle.time as UTCTimestamp,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          }))
        : direction === "bullish"
          ? bullishCandles
          : bearishCandles,
    [direction, scenario],
  );
  const detection = useMemo(() => {
    const strategyCandles: StrategyCandle[] = candles.map((candle) => ({
      time: Number(candle.time),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
    }));
    return (
      scenario?.detection ??
      detectGoldilocksZones(
        strategyCandles,
        scenario?.leg ?? {
          direction,
          startIndex: testOffset + 5,
          endIndex: testOffset + 13,
        },
      )
    );
  }, [candles, direction, scenario]);
  const entryZone =
    scenario?.tradeSetup?.zone ??
    detection.zones.find((zone) => zone.kind === "continuation") ??
    detection.zones.find((zone) => zone.kind === "base");
  const strategyCandles = useMemo<StrategyCandle[]>(
    () =>
      candles.map((candle) => ({
        time: Number(candle.time),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      })),
    [candles],
  );
  const liveConfirmation = useMemo(
    () =>
      scenario
        ? findFullCandleEngulfing(
            strategyCandles,
            direction,
            scenario.leg.endIndex + 1,
          )
        : undefined,
    [direction, scenario, strategyCandles],
  );
  const entryCandleIndex = scenario?.tradeSetup
    ? undefined
    : scenario
      ? liveConfirmation?.candleIndex
      : runwayExample === "blocked"
        ? testOffset + 21
        : testOffset + 18;
  const entryTime = (scenario?.tradeSetup?.confirmationTime ??
    (entryCandleIndex === undefined
      ? undefined
      : Number(candles[entryCandleIndex]?.time))) as UTCTimestamp | undefined;
  const engulfClose =
    scenario?.tradeSetup?.confirmationCandle.close ??
    (entryCandleIndex === undefined
      ? undefined
      : strategyCandles[entryCandleIndex]?.close);
  const testHistoricalZones = useMemo(() => {
    if (scenario) return detection.zones;
    const strategyCandles = candles.map((candle) => ({
      time: Number(candle.time),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
    }));
    const opposingLeg: SwingLeg =
      direction === "bullish"
        ? {
            direction: "bearish",
            startIndex: testOffset + 13,
            endIndex: testOffset + 17,
          }
        : {
            direction: "bullish",
            startIndex: testOffset + 13,
            endIndex: testOffset + 17,
          };
    return [
      ...detection.zones,
      ...detectGoldilocksZones(strategyCandles, opposingLeg).zones,
    ];
  }, [candles, detection.zones, direction, scenario]);
  const knownZones = useMemo(
    () => scenario?.zones ?? testHistoricalZones,
    [scenario?.zones, testHistoricalZones],
  );
  const actualEntryPrice = scenario
    ? strategyCandles[strategyCandles.length - 1]?.close
    : engulfClose;
  const calculatedRunway = useMemo(
    () =>
      entryZone && engulfClose !== undefined && actualEntryPrice !== undefined
        ? validateFinalEntryAfterEngulf(
            entryZone,
            knownZones,
            engulfClose,
            actualEntryPrice,
          )
        : undefined,
    [actualEntryPrice, engulfClose, entryZone, knownZones],
  );
  const runway = scenario ? scenario.tradeSetup?.runway : calculatedRunway;
  const displayedDetectionZones = useMemo(() => {
    const tradeZone = scenario?.tradeSetup?.zone;
    return tradeZone
      ? [...knownZones.filter((zone) => zone.id !== tradeZone.id), tradeZone]
      : knownZones;
  }, [knownZones, scenario?.tradeSetup?.zone]);
  const zones = useMemo<Zone[]>(() => {
    const chartTimes = candles.map((candle) => Number(candle.time));
    const firstTime = chartTimes[0] ?? 0;
    const lastTime = chartTimes.at(-1) ?? firstTime;
    const atOrBefore = (target: number) => {
      let result = firstTime;
      for (const time of chartTimes) {
        if (time > target) break;
        result = time;
      }
      return result as UTCTimestamp;
    };
    const atOrAfter = (target: number) => {
      const result = chartTimes.find((time) => time >= target) ?? lastTime;
      return result as UTCTimestamp;
    };
    return displayedDetectionZones.flatMap((zone) => {
      if (zone.candleTime < firstTime || zone.candleTime > lastTime) return [];
      const historicalTradeZone = scenario?.tradeSetup?.zone.id === zone.id;
      const visibleBreak = findGoldilocksZoneDistalBreakTime(
        zone,
        strategyCandles,
      );
      const lifecycleEnds = [zone.invalidatedAt, visibleBreak].filter(
        (time): time is number => Number.isFinite(time),
      );
      const rawEnd = lifecycleEnds.length
        ? Math.min(...lifecycleEnds)
        : historicalTradeZone && scenario?.tradeSetup?.outcomeTime
          ? scenario.tradeSetup.outcomeTime
          : lastTime;
      return {
        id: zone.id,
        label:
          scenario?.isReplay && !historicalTradeZone
            ? ""
            : formatStrategyZoneLabel({ ...zone, historicalTradeZone }),
        kind: zone.side,
        low: zone.low,
        high: zone.high,
        startTime: atOrBefore(zone.candleTime),
        endTime: atOrAfter(rawEnd),
        baseTime: atOrBefore(zone.candleTime),
        historicalTradeZone,
        researchIbi: zone.zoneFamily === "imbalance-balance",
      };
    });
  }, [candles, displayedDetectionZones, scenario?.tradeSetup, strategyCandles]);

  useEffect(() => {
    if (!containerRef.current) return;
    // React overlays outlive the lightweight-chart instance until the next
    // placement pass. Clear them immediately when the timeframe/scenario
    // changes so coordinates from the previous chart cannot remain visible.
    setPositions([]);
    setRatioPosition(null);
    setIndicatorRatios([]);
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#080a0e" },
        textColor: "#778293",
      },
      crosshair: {
        mode: lightMagnet ? CrosshairMode.MagnetOHLC : CrosshairMode.Normal,
      },
      grid: {
        vertLines: { color: "#151922" },
        horzLines: { color: "#151922" },
      },
      rightPriceScale: { borderColor: "#272d38" },
      localization: {
        timeFormatter: (time: Time) => formatStrategyReplayEnid(Number(time)),
      },
      timeScale: {
        borderColor: "#272d38",
        timeVisible: true,
        tickMarkFormatter: (time: Time) =>
          formatStrategyChartTimeEnid(Number(time)),
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#2edb91",
      downColor: "#ff5f70",
      wickUpColor: "#2edb91",
      wickDownColor: "#ff5f70",
      borderVisible: false,
      priceLineVisible: false,
      priceFormat: {
        type: "price",
        precision: pricePrecision,
        minMove: 10 ** -pricePrecision,
      },
    });
    const candleReadout = document.createElement("div");
    candleReadout.style.cssText =
      "position:absolute;left:190px;top:14px;z-index:4;padding:7px 9px;border:1px solid #303744;border-radius:7px;background:rgba(8,10,14,.9);color:#dce6f2;font:700 11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;box-shadow:0 8px 24px rgba(0,0,0,.3);pointer-events:none;display:none";
    containerRef.current.appendChild(candleReadout);
    const showCandlePrices = (param: MouseEventParams<Time>) => {
      const candle = param.seriesData.get(series) as
        CandlestickData<Time> | undefined;
      candleReadout.style.display = candle ? "block" : "none";
      if (candle)
        candleReadout.textContent = `${scenario?.timeframe ?? "TEST"}  ${formatStrategyReplayEnid(Number(candle.time))}  O ${Number(candle.open).toFixed(pricePrecision)}   H ${Number(candle.high).toFixed(pricePrecision)}   L ${Number(candle.low).toFixed(pricePrecision)}   C ${Number(candle.close).toFixed(pricePrecision)}`;
    };
    chart.subscribeCrosshairMove(showCandlePrices);
    const openTouchDrilldown = (param: MouseEventParams<Time>) => {
      if (!param.time || drilldownTimeframe === timeframe) return;
      const selectedTime = Number(param.time);
      const interval = Math.max(
        1,
        Number(candles[1]?.time ?? selectedTime + 1) -
          Number(candles[0]?.time ?? selectedTime),
      );
      const touches =
        scenario?.tradeSetups
          ?.map((setup) => setup.touchCandle?.time)
          .filter((time): time is number => Number.isFinite(time)) ?? [];
      if (
        touches.some(
          (time) => time >= selectedTime && time < selectedTime + interval,
        )
      )
        onTimeframeChange?.(drilldownTimeframe);
    };
    chart.subscribeClick(openTouchDrilldown);
    const captureDrawing = (param: MouseEventParams<Time>) => {
      if (!drawingMode || !param.time || !param.point) return;
      const rawPrice = series.coordinateToPrice(param.point.y);
      if (rawPrice === null) return;
      let price: number = Number(rawPrice);
      let pointTime = Number(param.time);
      if (lightMagnet) {
        const candle = candles.reduce<CandlestickData<Time> | undefined>(
          (closest, item) =>
            !closest ||
            Math.abs(Number(item.time) - pointTime) <
              Math.abs(Number(closest.time) - pointTime)
              ? item
              : closest,
          undefined,
        );
        if (candle) {
          const candidates = [
            Number(candle.open),
            Number(candle.high),
            Number(candle.low),
            Number(candle.close),
          ]
            .flatMap((value) => {
              const coordinate = series.priceToCoordinate(value);
              return coordinate === null
                ? []
                : [{ value, coordinate: Number(coordinate) }];
            })
            .sort(
              (left, right) =>
                Math.abs(left.coordinate - param.point!.y) -
                Math.abs(right.coordinate - param.point!.y),
            );
          if (
            candidates[0] &&
            Math.abs(candidates[0].coordinate - param.point.y) <= 20
          ) {
            price = Number(candidates[0].value);
            pointTime = Number(candle.time);
          }
        }
      }
      const point = { time: pointTime, price: Number(price) };
      if (!pendingDrawingPoint.current) {
        pendingDrawingPoint.current = point;
        return;
      }
      setDrawings((items) => [
        ...items,
        {
          id: `${drawingMode}-${Date.now()}`,
          type: drawingMode,
          from: pendingDrawingPoint.current!,
          to: point,
        },
      ]);
      pendingDrawingPoint.current = null;
      setDrawingMode(null);
    };
    chart.subscribeClick(captureDrawing);
    series.setData(candles);
    const swings = scenario?.swings ?? [
      ...historyAnchors.slice(0, -1).map((price, index) => ({
        swing: (index % 2 === 0 ? "HH" : "LL") as "HH" | "LL",
        price: direction === "bullish" ? price : 220 - price,
        candleIndex: index * 10,
        time: Number(time(index * 10)),
      })),
      direction === "bullish"
        ? {
            swing: "LL" as const,
            price: 97.8,
            candleIndex: testOffset + 5,
            time: Number(time(testOffset + 5)),
          }
        : {
            swing: "HH" as const,
            price: 122.2,
            candleIndex: testOffset + 5,
            time: Number(time(testOffset + 5)),
          },
      direction === "bullish"
        ? {
            swing: "HH" as const,
            price: 112,
            candleIndex: testOffset + 13,
            time: Number(time(testOffset + 13)),
          }
        : {
            swing: "LL" as const,
            price: 108,
            candleIndex: testOffset + 13,
            time: Number(time(testOffset + 13)),
          },
    ];
    const exitMarker = scenario?.tradeSetup?.outcomeTime
      ? (() => {
          const setup = scenario.tradeSetup!;
          const exitCandleIndex = getReplayCandleIndexAtOrBefore(
            candles.map((candle) => ({ time: Number(candle.time) })),
            setup.outcomeTime!,
          );
          const exitCandle = candles[Math.max(0, exitCandleIndex)];
          const won = setup.outcome === "win";
          return [
            {
              time: exitCandle.time as UTCTimestamp,
              position: "atPriceMiddle" as const,
              price: getReplayExitMarkerPrice(setup),
              color: won ? "#55e991" : "#ff6876",
              shape: "circle" as const,
              text: `EXIT · ${setup.outcome.toUpperCase()} · ${(setup.exitReason ?? "closed").replaceAll("_", " ").toUpperCase()}`,
            },
          ];
        })()
      : [];
    const candleTimes = candles.map((candle) => ({
      time: Number(candle.time),
    }));
    const firstCandleTime = candleTimes[0]?.time ?? 0;
    const lastCandleTime = candleTimes.at(-1)?.time ?? 0;
    const priorTouchMarkers = (
      scenario?.tradeSetup?.priorTouchDetails ?? []
    ).flatMap((touch) => {
      if (touch.time < firstCandleTime || touch.time > lastCandleTime)
        return [];
      const candleIndex = getReplayCandleIndexAtOrBefore(
        candleTimes,
        touch.time,
      );
      const candle = candles[candleIndex];
      if (!candle) return [];
      return [
        {
          time: candle.time as UTCTimestamp,
          position: "atPriceMiddle" as const,
          price: touch.price,
          color: "#f4a340",
          shape: "circle" as const,
          text: "",
        },
      ];
    });
    const departureQuality = scenario?.tradeSetup?.zone.departureQuality;
    const departureMarkers =
      departureQuality &&
      departureQuality.departureCandleTime >= firstCandleTime &&
      departureQuality.departureCandleTime <= lastCandleTime
      ? (() => {
          const candleIndex = getReplayCandleIndexAtOrBefore(
            candleTimes,
            departureQuality.departureCandleTime,
          );
          const candle = candles[candleIndex];
          if (!candle) return [];
          return [
            {
              time: candle.time as UTCTimestamp,
              position:
                scenario!.tradeSetup!.zone.side === "supply"
                  ? ("aboveBar" as const)
                  : ("belowBar" as const),
              color: "#ff9f43",
              shape:
                scenario!.tradeSetup!.zone.side === "supply"
                  ? ("arrowDown" as const)
                  : ("arrowUp" as const),
              text: "DEPARTURE",
            },
          ];
        })()
      : [];
    const approachPressure = scenario?.tradeSetup?.approachPressure;
    const approachEvidenceMarkers = approachPressure
      ? [
          ...(approachPressure.liquiditySweepTimes ??
            (approachPressure.latestSweepTime === null
              ? []
              : [approachPressure.latestSweepTime])
          ).map((time) => ({
                time,
                text: "LIQUIDITY SWEEP",
                color: "#f7c948",
                position: "belowBar" as const,
                shape: "circle" as const,
              })),
          ...(approachPressure.adversePressureFlags.some(
            (flag) => flag.startsWith("momentum_drive_into_"),
          )
            ? (approachPressure.approachEvidenceTimes ??
                (approachPressure.approachEvidenceTime
                  ? [approachPressure.approachEvidenceTime]
                  : []))
            : []
          ).map((time) => ({
                time,
                text: "FAST ATTACK",
                color: "#d977ff",
                position:
                  scenario!.tradeSetup!.zone.side === "supply"
                    ? ("belowBar" as const)
                    : ("aboveBar" as const),
                shape: "square" as const,
              })),
        ]
          .flatMap((marker) => {
            if (marker.time < firstCandleTime || marker.time > lastCandleTime)
              return [];
            const candleIndex = getReplayCandleIndexAtOrBefore(
              candleTimes,
              marker.time,
            );
            const candle = candles[candleIndex];
            return candle
              ? [{ ...marker, time: candle.time as UTCTimestamp }]
              : [];
          })
      : [];
    const focusedTrade = scenario?.tradeSetup;
    const isFocusedTrade = (setup: HistoricalTradeSetup) =>
      Boolean(
        focusedTrade &&
          setup.zone.id === focusedTrade.zone.id &&
          setup.confirmationTime === focusedTrade.confirmationTime,
      );
    const indicatorTrades = (scenario?.tradeSetups ?? []).filter(
      (setup) => !isFocusedTrade(setup),
    );
    const indicatorMarkers = indicatorTrades.flatMap((setup, index) => {
      const entryIndex = getReplayCandleIndexAtOrBefore(
        candleTimes,
        setup.confirmationTime,
      );
      const entryCandle = candles[entryIndex];
      if (!entryCandle) return [];
      const entry = {
        time: entryCandle.time as UTCTimestamp,
        position:
          setup.zone.side === "supply"
            ? ("aboveBar" as const)
            : ("belowBar" as const),
        color: "#ffd84d",
        shape:
          setup.zone.side === "supply"
            ? ("arrowDown" as const)
            : ("arrowUp" as const),
        text: `${setup.zone.side === "supply" ? "SELL" : "BUY"} ${setup.confirmationTimeframe}`,
      };
      if (!setup.outcomeTime) return [entry];
      const outcomeIndex = getReplayCandleIndexAtOrBefore(
        candleTimes,
        setup.outcomeTime,
      );
      const outcomeCandle = candles[outcomeIndex];
      return outcomeCandle
        ? [
            entry,
            {
              time: outcomeCandle.time as UTCTimestamp,
              position: "atPriceMiddle" as const,
              price: getReplayExitMarkerPrice(setup),
              color: setup.outcome === "win" ? "#55e991" : "#ff6876",
              shape: "circle" as const,
              text: `${setup.outcome.toUpperCase()} ${index + 1}`,
            },
          ]
        : [entry];
    });
    const structureMarkers = swings.flatMap((swing) => {
      if (swing.time < firstCandleTime || swing.time > lastCandleTime)
        return [];
      const candleIndex = getReplayCandleIndexAtOrBefore(
        candleTimes,
        swing.time,
      );
      const candle = candles[candleIndex];
      if (!candle) return [];
      const high = swing.swing === "HH" || swing.swing === "LH";
      const bullish = swing.swing === "HH" || swing.swing === "HL";
      return [
        {
          time: candle.time as UTCTimestamp,
          position: high ? ("aboveBar" as const) : ("belowBar" as const),
          color: bullish ? "#55e991" : "#ff6876",
          shape: "circle" as const,
          text: swing.swing,
        },
      ];
    });
    createSeriesMarkers(
      series,
      [
        ...structureMarkers,
        ...priorTouchMarkers,
        ...departureMarkers,
        ...approachEvidenceMarkers,
        ...exitMarker,
        ...indicatorMarkers,
      ].sort((left, right) => Number(left.time) - Number(right.time)),
    );
    const failedFirstTouches = sortUniqueReplayCandleItems(
      (scenario?.rejectedFirstTouches ?? []).flatMap((rejected) => {
        if (rejected.time < firstCandleTime || rejected.time > lastCandleTime)
          return [];
        const candleIndex = getReplayCandleIndexAtOrBefore(
          candleTimes,
          rejected.time,
        );
        const candle = candles[candleIndex];
        return candle ? [{ rejected, candle }] : [];
      }),
    );
    if (failedFirstTouches.length) {
      const failedTouchSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#ff9f43",
        downColor: "#ff9f43",
        wickUpColor: "#ffd09a",
        wickDownColor: "#ffd09a",
        borderVisible: true,
        borderUpColor: "#fff0dc",
        borderDownColor: "#fff0dc",
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: {
          type: "price",
          precision: pricePrecision,
          minMove: 10 ** -pricePrecision,
        },
      });
      failedTouchSeries.setData(failedFirstTouches.map(({ candle }) => candle));
      createSeriesMarkers(
        failedTouchSeries,
        failedFirstTouches.map(({ rejected, candle }) => ({
          time: candle.time as UTCTimestamp,
          position:
            rejected.zoneSide === "supply"
              ? ("aboveBar" as const)
              : ("belowBar" as const),
          color: "#ff9f43",
          shape: "circle" as const,
          text: "FAILED 1ST TOUCH",
        })),
      );
    }
    drawings.forEach((drawing) => {
      const fromTime = atOrAfterChartTime(
        candles,
        Math.min(drawing.from.time, drawing.to.time),
      );
      const toTime = atOrAfterChartTime(
        candles,
        Math.max(drawing.from.time, drawing.to.time),
      );
      if (drawing.type === "box") {
        const low = Math.min(drawing.from.price, drawing.to.price),
          high = Math.max(drawing.from.price, drawing.to.price);
        const addEdge = (
          data: Array<{ time: UTCTimestamp; value: number }>,
        ) => {
          const edge = chart.addSeries(LineSeries, {
            color: "#7aa2ff",
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          edge.setData(data);
        };
        addEdge([
          { time: fromTime, value: high },
          { time: toTime, value: high },
        ]);
        addEdge([
          { time: fromTime, value: low },
          { time: toTime, value: low },
        ]);
        addEdge([
          { time: fromTime, value: low },
          { time: fromTime, value: high },
        ]);
        addEdge([
          { time: toTime, value: low },
          { time: toTime, value: high },
        ]);
        return;
      }
      [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach((ratio) => {
        const value =
          drawing.from.price + (drawing.to.price - drawing.from.price) * ratio;
        const fibLine = chart.addSeries(LineSeries, {
          title: `Fib ${(ratio * 100).toFixed(1)}%`,
          color: ratio === 0.5 ? "#ffd166" : "#b58cff",
          lineWidth: ratio === 0 || ratio === 1 ? 2 : 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        fibLine.setData([
          { time: fromTime, value },
          { time: toTime, value },
        ]);
      });
    });
    if (scenario?.tradeSetup) {
      const setup = scenario.tradeSetup;
      if (setup.touchCandle) {
        const touchSeries = chart.addSeries(CandlestickSeries, {
          upColor: "#64dff3",
          downColor: "#64dff3",
          wickUpColor: "#baf6ff",
          wickDownColor: "#baf6ff",
          borderVisible: true,
          borderUpColor: "#ffffff",
          borderDownColor: "#ffffff",
          priceLineVisible: false,
          lastValueVisible: false,
          priceFormat: {
            type: "price",
            precision: pricePrecision,
            minMove: 10 ** -pricePrecision,
          },
        });
        touchSeries.setData([
          {
            time: setup.touchCandle.time as UTCTimestamp,
            open: setup.touchCandle.open,
            high: setup.touchCandle.high,
            low: setup.touchCandle.low,
            close: setup.touchCandle.close,
          },
        ]);
        createSeriesMarkers(touchSeries, [
          {
            time: setup.touchCandle.time as UTCTimestamp,
            position: setup.zone.side === "supply" ? "aboveBar" : "belowBar",
            color: "#64dff3",
            shape: "circle",
            text: `${setup.confirmationTimeframe} TOUCH`,
          },
        ]);
      }
      const confirmationTime = setup.confirmationTime as UTCTimestamp;
      const confirmationSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#ffd84d",
        downColor: "#ffd84d",
        wickUpColor: "#fff2a6",
        wickDownColor: "#fff2a6",
        borderVisible: true,
        borderUpColor: "#ffffff",
        borderDownColor: "#ffffff",
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: {
          type: "price",
          precision: pricePrecision,
          minMove: 10 ** -pricePrecision,
        },
      });
      confirmationSeries.setData([
        {
          time: confirmationTime,
          open: setup.confirmationCandle.open,
          high: setup.confirmationCandle.high,
          low: setup.confirmationCandle.low,
          close: setup.confirmationCandle.close,
        },
      ]);
      createSeriesMarkers(confirmationSeries, [
        {
          time: confirmationTime,
          position: setup.zone.side === "supply" ? "aboveBar" : "belowBar",
          color: "#ffd84d",
          shape: setup.zone.side === "supply" ? "arrowDown" : "arrowUp",
          text: `${setup.confirmationTimeframe} ${setup.zone.side === "supply" ? "SELL" : "BUY"} ENGULF`,
        },
      ]);
    }
    if (runway && entryTime !== undefined) {
      const lineStart = entryTime;
      const lastCandleTime = Number(candles[candles.length - 1].time);
      const previousCandleTime = Number(
        candles[Math.max(0, candles.length - 2)].time,
      );
      const candleInterval = Math.max(1, lastCandleTime - previousCandleTime);
      const lineEnd = (scenario?.tradeSetup?.outcomeTime ??
        Math.max(
          lastCandleTime,
          Number(lineStart) + candleInterval,
        )) as UTCTimestamp;
      const addRunwayLine = (
        value: number,
        color: string,
        _title: string,
        lineStyle = 0,
      ) => {
        const line = chart.addSeries(LineSeries, {
          color,
          lineWidth: 2,
          lineStyle,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        line.setData([
          { time: lineStart, value },
          { time: lineEnd, value },
        ]);
      };
      addRunwayLine(runway.entry, "#ffd84d", "ENGULF CLOSE · ENTRY");
      addRunwayLine(runway.stopLoss, "#ff5f70", "STOP · 1R");
      addRunwayLine(runway.takeProfit, "#2edb91", "TARGET · 2R");
    }
    chart.timeScale().fitContent();
    if (visibleTimeRangeRef.current) {
      chart.timeScale().setVisibleRange(visibleTimeRangeRef.current);
    } else if (scenario?.tradeSetup && entryTime !== undefined) {
      const closestIndexTo = (target: number) => {
        let closestIndex = 0;
        let closestDistance = Number.POSITIVE_INFINITY;
        candles.forEach((candle, index) => {
          const distance = Math.abs(Number(candle.time) - target);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
          }
        });
        return closestIndex;
      };
      const entryIndex = closestIndexTo(Number(entryTime));
      const exitIndex = scenario.tradeSetup.outcomeTime
        ? getReplayCandleIndexAtOrBefore(
            candles.map((candle) => ({ time: Number(candle.time) })),
            scenario.tradeSetup.outcomeTime,
          )
        : entryIndex;
      const zoneBaseIndex = getReplayCandleIndexAtOrBefore(
        candles.map((candle) => ({ time: Number(candle.time) })),
        scenario.tradeSetup.zone.candleTime,
      );
      const padding = scenario.tradeSetup.outcomeTime ? 20 : 70;
      const visibleEnd = scenario.tradeSetup.outcomeTime
        ? getReplayVisibleEnd(
            candles.length - 1,
            entryIndex,
            exitIndex,
            scenario.timeframe,
          )
        : Math.min(
            candles.length - 1,
            Math.max(entryIndex, exitIndex) + padding,
          );
      chart.timeScale().setVisibleLogicalRange({
        from: getReplayVisibleStart(
          zoneBaseIndex,
          entryIndex,
          exitIndex,
          padding,
        ),
        to: visibleEnd,
      });
    }
    chartRef.current = chart;
    seriesRef.current = series;
    let placementFrame = 0;
    const place = () => {
      const viewportWidth = containerRef.current?.clientWidth ?? 0;
      const viewportHeight = containerRef.current?.clientHeight ?? 0;
      setPositions(
        zones.flatMap((zone) => {
          const left = chart.timeScale().timeToCoordinate(zone.startTime);
          const right = chart.timeScale().timeToCoordinate(zone.endTime);
          const top = series.priceToCoordinate(zone.high);
          const bottom = series.priceToCoordinate(zone.low);
          const baseX = chart.timeScale().timeToCoordinate(zone.baseTime);
          if (
            left === null ||
            right === null ||
            top === null ||
            bottom === null ||
            baseX === null
          )
            return [];
          if (
            right <= 0 ||
            left >= viewportWidth ||
            bottom < 0 ||
            top > viewportHeight ||
            right <= left
          )
            return [];
          const visibleLeft = Math.max(0, left);
          const visibleRight = Math.min(viewportWidth, right);
          return [
            {
              ...zone,
              left: visibleLeft,
              top,
              width: Math.max(2, visibleRight - visibleLeft),
              height: Math.max(2, bottom - top),
              baseX,
              showLabel: visibleRight - visibleLeft >= 150,
            },
          ];
        }),
      );
      if (runway && entryTime !== undefined) {
        const startTime = entryTime;
        const lastTime = Number(candles[candles.length - 1].time);
        const previousTime = Number(
          candles[Math.max(0, candles.length - 2)].time,
        );
        const interval = Math.max(1, lastTime - previousTime);
        const ratioEndTime = (scenario?.tradeSetup?.outcomeTime ??
          Math.max(lastTime, Number(startTime) + interval)) as UTCTimestamp;
        const left = chart.timeScale().timeToCoordinate(startTime);
        const right = chart.timeScale().timeToCoordinate(ratioEndTime);
        const entryY = series.priceToCoordinate(runway.entry);
        const stopY = series.priceToCoordinate(runway.stopLoss);
        const targetY = series.priceToCoordinate(runway.takeProfit);
        if (
          left === null ||
          right === null ||
          entryY === null ||
          stopY === null ||
          targetY === null ||
          right <= 0 ||
          left >= viewportWidth
        )
          setRatioPosition(null);
        else {
          const visibleLeft = Math.max(0, left);
          const visibleRight = Math.min(viewportWidth, right);
          setRatioPosition({
            left: visibleLeft,
            width: Math.max(4, visibleRight - visibleLeft),
            entryY,
            stopY,
            targetY,
          });
        }
      } else setRatioPosition(null);
      setIndicatorRatios(
        (scenario?.tradeSetups ?? [])
          .filter((setup) => !isFocusedTrade(setup))
          .flatMap((setup, index) => {
          if (
            setup.confirmationTime < Number(candles[0]?.time) ||
            setup.confirmationTime > Number(candles.at(-1)?.time)
          )
            return [];
          const start = chart
            .timeScale()
            .timeToCoordinate(
              atOrAfterChartTime(candles, setup.confirmationTime),
            );
          const end = chart
            .timeScale()
            .timeToCoordinate(
              atOrBeforeChartTime(
                candles,
                setup.outcomeTime ?? Number(candles.at(-1)?.time),
              ),
            );
          const entryY = series.priceToCoordinate(setup.runway.entry);
          const stopY = series.priceToCoordinate(setup.runway.stopLoss);
          const targetY = series.priceToCoordinate(setup.runway.takeProfit);
          if (
            start === null ||
            end === null ||
            entryY === null ||
            stopY === null ||
            targetY === null ||
            end <= 0 ||
            start >= viewportWidth ||
            end <= start
          )
            return [];
          const visibleLeft = Math.max(0, start);
          const visibleRight = Math.min(viewportWidth, end);
          return [
            {
              id: `${setup.zone.id}-${setup.confirmationTime}-${index}`,
              left: visibleLeft,
              width: Math.max(3, visibleRight - visibleLeft),
              entryY,
              stopY,
              targetY,
            },
          ];
          }),
      );
    };
    const schedulePlace = () => {
      if (placementFrame) return;
      placementFrame = window.requestAnimationFrame(() => {
        placementFrame = 0;
        place();
      });
    };
    const timer = window.setTimeout(schedulePlace, 50);
    chart.timeScale().subscribeVisibleLogicalRangeChange(schedulePlace);
    const updateHistoryButtons = (
      range: { from: number; to: number } | null,
    ) => {
      setShowLoadOlder(Boolean(hasOlder && range && range.from <= 2));
      setShowLoadNewer(
        Boolean(hasNewer && range && range.to >= candles.length - 3),
      );
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateHistoryButtons);
    updateHistoryButtons(chart.timeScale().getVisibleLogicalRange());
    const observer = new ResizeObserver(schedulePlace);
    observer.observe(containerRef.current);
    return () => {
      visibleTimeRangeRef.current = chart.timeScale().getVisibleRange();
      window.clearTimeout(timer);
      if (placementFrame) window.cancelAnimationFrame(placementFrame);
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(schedulePlace);
      chart
        .timeScale()
        .unsubscribeVisibleLogicalRangeChange(updateHistoryButtons);
      chart.unsubscribeCrosshairMove(showCandlePrices);
      chart.unsubscribeClick(openTouchDrilldown);
      chart.unsubscribeClick(captureDrawing);
      candleReadout.remove();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [
    candles,
    direction,
    drawingMode,
    drawings,
    drilldownTimeframe,
    entryTime,
    hasNewer,
    hasOlder,
    lightMagnet,
    onTimeframeChange,
    pricePrecision,
    runway,
    scenario,
    timeframe,
    zones,
  ]);

  return (
    <Wrap>
      <Canvas ref={containerRef} />
      {showLoadOlder && (
        <HistoryButton
          type="button"
          side="older"
          disabled={loadingHistorySide !== null}
          onClick={async () => {
            setLoadingHistorySide("older");
            try {
              await onLoadOlder?.();
            } finally {
              setLoadingHistorySide(null);
            }
          }}
        >
          {loadingHistorySide === "older" ? "Loading…" : "← Load older candles"}
        </HistoryButton>
      )}
      {showLoadNewer && (
        <HistoryButton
          type="button"
          side="newer"
          disabled={loadingHistorySide !== null}
          onClick={async () => {
            setLoadingHistorySide("newer");
            try {
              await onLoadNewer?.();
            } finally {
              setLoadingHistorySide(null);
            }
          }}
        >
          {loadingHistorySide === "newer" ? "Loading…" : "Load newer candles →"}
        </HistoryButton>
      )}
      {resolvedTradeId && (
        <TradeIdBadge
          type="button"
          title={tradeIdCopied ? "Copied to clipboard" : "Permanent trade ID · click to copy"}
          aria-label={`Copy trade ID ${resolvedTradeId}`}
          onClick={() => void copyTradeId()}
        >
          {tradeIdCopied ? "✓ Copied!" : `🍬 TRADE ID: ${resolvedTradeId}`}
        </TradeIdBadge>
      )}
      <TimeframeToolbar role="group" aria-label="Chart timeframe">
        {chartTimeframes.map((item) => (
          <TimeframeButton
            key={item}
            type="button"
            active={timeframe === item}
            disabled={timeframeLoading}
            aria-pressed={timeframe === item}
            onClick={() => onTimeframeChange?.(item)}
          >
            {item}
          </TimeframeButton>
        ))}
      </TimeframeToolbar>
      <DrawingToolbar>
        <TimeframeButton
          type="button"
          active={lightMagnet}
          aria-pressed={lightMagnet}
          title="Snap drawing points to nearby candle OHLC values"
          onClick={() => setLightMagnet((enabled) => !enabled)}
        >
          Light Magnet
        </TimeframeButton>
        <TimeframeButton
          type="button"
          active={drawingMode === "box"}
          aria-pressed={drawingMode === "box"}
          onClick={() => {
            pendingDrawingPoint.current = null;
            setDrawingMode((mode) => (mode === "box" ? null : "box"));
          }}
        >
          Box
        </TimeframeButton>
        <TimeframeButton
          type="button"
          active={drawingMode === "fib"}
          aria-pressed={drawingMode === "fib"}
          onClick={() => {
            pendingDrawingPoint.current = null;
            setDrawingMode((mode) => (mode === "fib" ? null : "fib"));
          }}
        >
          Fib
        </TimeframeButton>
        <TimeframeButton
          type="button"
          active={drawingMode === null}
          aria-pressed={drawingMode === null}
          onClick={() => {
            pendingDrawingPoint.current = null;
            setDrawingMode(null);
          }}
        >
          Off
        </TimeframeButton>
        <TimeframeButton
          type="button"
          active={false}
          onClick={() => {
            pendingDrawingPoint.current = null;
            setDrawings([]);
            setDrawingMode(null);
          }}
        >
          Clear
        </TimeframeButton>
      </DrawingToolbar>
      <Overlay>
        <TrendStatus direction={direction}>
          {scenario?.tradeSetup ? "TREND AT TRADE TIME" : "CURRENT TREND"}:{" "}
          {direction.toUpperCase()}
        </TrendStatus>
        {ratioPosition && (
          <>
            <RatioBox
              reward
              style={{
                left: ratioPosition.left,
                top: Math.min(ratioPosition.entryY, ratioPosition.targetY),
                width: ratioPosition.width,
                height: Math.abs(ratioPosition.entryY - ratioPosition.targetY),
              }}
            />
            <RatioBox
              reward={false}
              style={{
                left: ratioPosition.left,
                top: Math.min(ratioPosition.entryY, ratioPosition.stopY),
                width: ratioPosition.width,
                height: Math.abs(ratioPosition.entryY - ratioPosition.stopY),
              }}
            />
            <TradeLevelLabel
              tone="entry"
              style={{
                left: ratioPosition.left + 6,
                top: ratioPosition.entryY,
              }}
            >
              ENTRY
            </TradeLevelLabel>
            <TradeLevelLabel
              tone="stop"
              style={{ left: ratioPosition.left + 6, top: ratioPosition.stopY }}
            >
              STOP · 1R
            </TradeLevelLabel>
            <TradeLevelLabel
              tone="target"
              style={{
                left: ratioPosition.left + 6,
                top: ratioPosition.targetY,
              }}
            >
              TARGET · 2R
            </TradeLevelLabel>
          </>
        )}
        {indicatorRatios.map((ratio) => (
          <span key={ratio.id}>
            <RatioBox
              reward
              style={{
                left: ratio.left,
                top: Math.min(ratio.entryY, ratio.targetY),
                width: ratio.width,
                height: Math.abs(ratio.entryY - ratio.targetY),
              }}
            />
            <RatioBox
              reward={false}
              style={{
                left: ratio.left,
                top: Math.min(ratio.entryY, ratio.stopY),
                width: ratio.width,
                height: Math.abs(ratio.entryY - ratio.stopY),
              }}
            />
          </span>
        ))}
        {positions.map((zone) => (
          <Box
            key={zone.id}
            kind={zone.kind}
            historicalTradeZone={zone.historicalTradeZone}
            researchIbi={zone.researchIbi}
            style={{
              left: zone.left,
              top: zone.top,
              width: zone.width,
              height: zone.height,
            }}
          >
            {zone.showLabel && zone.label && <Label>{zone.label}</Label>}
          </Box>
        ))}
      </Overlay>
    </Wrap>
  );
}
