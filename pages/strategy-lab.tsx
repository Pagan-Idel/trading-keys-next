import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import styled from "styled-components";
import { forexPairs } from "../utils/constants";
import type {
  GoldilocksDetection,
  StrategyCandle,
  SwingLeg,
  TradeRunwayCheck,
} from "../utils/goldilocksStrategy";
import {
  formatStrategyReplayEnid,
  formatStrategyReplayNewYork,
} from "../utils/strategyReplay";
import { formatGoldilocksZoneAge } from "../utils/zoneAge";
import type { GoldilocksScoreResult } from "../utils/goldilocksScoring";
import type { GoldilocksApproachPressure } from "../utils/approachPressure";
import type { ZoneCorridorMeasurement } from "../utils/zoneCorridor";
import type {
  TradeManagementResearchResult,
  TradePathSummary,
} from "../utils/tradeManagementResearch";
import { getGoldilocksChartStack } from "../utils/goldilocksConfig";
import { goldilocksScoreComponentMaximum } from "../utils/goldilocksScoreDisplay";

const StrategyLabChart = dynamic(
  () => import("../components/StrategyLabChart"),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: 540,
          color: "#778293",
          display: "grid",
          placeItems: "center",
        }}
      >
        Loading chart engine…
      </div>
    ),
  },
);
const formatWarningResolution = (seconds?: number) => {
  if (!seconds) return "stored confirmation timeframe";
  if (seconds >= 86400) return `${seconds / 86400}-day candles`;
  if (seconds >= 3600) return `${seconds / 3600}-hour candles`;
  return `${seconds / 60}-minute candles`;
};
const scoreComponentDisplayName = (name: string) => {
  if (name.endsWith(" range")) return "Legacy range context";
  if (name.endsWith(" trend")) return "Trend-timeframe alignment";
  if (name.endsWith(" departure quality"))
    return "Zone-timeframe departure quality";
  if (name.endsWith(" approach warnings"))
    return "Confirmation-timeframe approach warnings";
  if (name.endsWith(" purity"))
    return "Confirmation-timeframe zone purity";
  if (name === "Available RRR") return "Available reward-to-risk";
  if (name === "Zone inside zone")
    return "Multi-timeframe zone confluence (ZIZ)";
  return name;
};
const hardGatePurpose = (name: string) => {
  const normalized = name.toLowerCase();
  if (normalized.includes("zone validity"))
    return "Stops broken, expired, stale, or over-touched zones from creating a trade.";
  if (normalized.includes("confirmation"))
    return "Requires a later completed confirmation candle and prevents stale signals from being chased.";
  if (normalized.includes("entry proximity"))
    return "Prevents an oversized first touch or an executable price that has moved too far from the zone.";
  if (normalized.includes("runway"))
    return "Requires a clear path to the fixed target before entry.";
  if (normalized.includes("news"))
    return "Avoids entry when a high-impact event can overwhelm the technical setup.";
  if (normalized.includes("session"))
    return "Requires the pair to be trading during its configured liquid session.";
  if (normalized.includes("holiday") || normalized.includes("weekly"))
    return "Blocks entries during configured closures and thin market windows.";
  return "This mandatory safety condition must pass before the setup can be traded.";
};
const Page = styled.div`
  width: min(1300px, calc(100% - 32px));
  margin: 0 auto 60px;
  color: #f3f5f8;
  font-family: Inter, system-ui, sans-serif;
`;
const Header = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: 18px;
`;
const Title = styled.h1`
  font-size: clamp(1.7rem, 4vw, 2.8rem);
  letter-spacing: -0.04em;
  margin: 0 0 6px;
`;
const Copy = styled.p`
  color: #8b95a5;
  margin: 0;
  max-width: 760px;
`;
const Controls = styled.div`
  display: flex;
  gap: 8px;
`;
const Button = styled.button<{ active: boolean }>`
  border: 1px solid ${({ active }) => (active ? "#7f3db7" : "#303642")};
  background: ${({ active }) => (active ? "#351447" : "#15191f")};
  color: ${({ active }) => (active ? "#f0ccff" : "#929cab")};
  border-radius: 10px;
  padding: 9px 13px;
  font-weight: 800;
  cursor: pointer;
`;
const Select = styled.select`
  border: 1px solid #303642;
  background: #15191f;
  color: #d6dbe3;
  border-radius: 10px;
  padding: 9px 11px;
  font-weight: 700;
`;
const Legend = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-top: 14px;
  @media (max-width: 800px) {
    grid-template-columns: 1fr 1fr;
  }
`;
const Rule = styled.div`
  border: 1px solid #292f39;
  background: #12151b;
  border-radius: 12px;
  padding: 12px;
  color: #a8b0bc;
  font-size: 0.76rem;
  line-height: 1.45;
`;
const Diagnostics = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-top: 14px;
  @media (max-width: 780px) {
    grid-template-columns: 1fr;
  }
`;
const Diagnostic = styled.div`
  border: 1px solid #313743;
  background: #101319;
  border-radius: 12px;
  padding: 13px;
  color: #929cab;
  font-size: 0.75rem;
  line-height: 1.5;
  strong {
    color: #f0d5ff;
  }
  ul {
    margin: 7px 0 0;
    padding-left: 18px;
  }
`;
const TradeCandy = styled.section`
  margin: 14px 0;
  padding: clamp(14px, 2vw, 20px);
  border: 1px solid #4a365c;
  border-radius: 20px;
  background:
    radial-gradient(
      circle at 94% 0%,
      rgba(210, 86, 255, 0.18),
      transparent 31%
    ),
    radial-gradient(
      circle at 5% 100%,
      rgba(44, 224, 183, 0.12),
      transparent 32%
    ),
    linear-gradient(145deg, #14101b, #0a0d12 58%);
  box-shadow:
    0 18px 55px rgba(0, 0, 0, 0.34),
    inset 0 1px rgba(255, 255, 255, 0.04);
`;
const TradeTopline = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-start;
  flex-wrap: wrap;
  margin-bottom: 14px;
`;
const TradeIdentity = styled.div`
  .eyebrow {
    color: #f1a6ff;
    font-size: 0.64rem;
    font-weight: 950;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  h2 {
    margin: 5px 0 4px;
    font-size: clamp(1.1rem, 2.5vw, 1.7rem);
    letter-spacing: -0.02em;
  }
  code {
    color: #8996a8;
    font-size: 0.7rem;
    overflow-wrap: anywhere;
  }
`;
const CandyActions = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
`;
const Pill = styled.span<{ $tone?: "good" | "bad" | "warn" | "info" }>`
  display: inline-flex;
  padding: 7px 10px;
  border-radius: 999px;
  font-size: 0.67rem;
  font-weight: 950;
  letter-spacing: 0.06em;
  color: ${({ $tone }) => ($tone === "good" ? "#70f2b7" : $tone === "bad" ? "#ff8b9c" : $tone === "warn" ? "#ffd878" : "#9eeeff")};
  border: 1px solid
    ${({ $tone }) => ($tone === "good" ? "#28755a" : $tone === "bad" ? "#7c3343" : $tone === "warn" ? "#715c2b" : "#275f70")};
  background: ${({ $tone }) => ($tone === "good" ? "#102a20" : $tone === "bad" ? "#30131a" : $tone === "warn" ? "#2d250f" : "#10252c")};
`;
const DownloadButton = styled.button`
  border: 1px solid #8350a0;
  background: linear-gradient(135deg, #51206c, #2b123b);
  color: #f5d9ff;
  border-radius: 10px;
  padding: 8px 11px;
  font-size: 0.7rem;
  font-weight: 900;
  cursor: pointer;
  &:hover {
    border-color: #d68cff;
    transform: translateY(-1px);
  }
`;
const SnapshotGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 9px;
  @media (max-width: 1100px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  @media (max-width: 650px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;
const SnapshotCard = styled.div<{ $tone?: "good" | "bad" | "warn" | "info" }>`
  min-height: 102px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid
    ${({ $tone }) => ($tone === "good" ? "#285c4a" : $tone === "bad" ? "#65313d" : $tone === "warn" ? "#5d502b" : "#2b3b49")};
  background: ${({ $tone }) => ($tone === "good" ? "linear-gradient(145deg,#10271f,#0d1617)" : $tone === "bad" ? "linear-gradient(145deg,#2c1219,#151116)" : $tone === "warn" ? "linear-gradient(145deg,#28220f,#151411)" : "linear-gradient(145deg,#111b23,#0d1218)")};
  .label {
    color: #7f8b9a;
    font-size: 0.58rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 900;
  }
  .value {
    margin: 7px 0 5px;
    color: #f4f8fc;
    font-size: 1.15rem;
    line-height: 1;
    font-weight: 950;
    overflow-wrap: anywhere;
  }
  .meta {
    color: #8e9baa;
    font-size: 0.66rem;
    line-height: 1.4;
  }
`;
const AuditDetails = styled.details`
  margin-top: 12px;
  border: 1px solid #303846;
  border-radius: 14px;
  background: rgba(7, 10, 14, 0.7);
  summary {
    cursor: pointer;
    padding: 12px 14px;
    color: #d5b3e8;
    font-size: 0.72rem;
    font-weight: 900;
    list-style-position: inside;
  }
`;
const AuditGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
  padding: 0 12px 12px;
  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;
const AuditCard = styled.div<{ $wide?: boolean }>`
  grid-column: ${({ $wide }) => ($wide ? "1 / -1" : "auto")};
  padding: 12px;
  border: 1px solid #28313d;
  border-radius: 12px;
  background: #0d1218;
  color: #8f9cab;
  font-size: 0.68rem;
  line-height: 1.55;
  h3 {
    margin: 0 0 8px;
    color: #e8eef5;
    font-size: 0.75rem;
  }
  strong {
    color: #c9d4df;
  }
  ul {
    margin: 7px 0 0;
    padding-left: 17px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    padding: 6px 4px;
    border-bottom: 1px solid #222c36;
    text-align: left;
    vertical-align: top;
  }
  th {
    color: #718092;
    font-size: 0.57rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }
  td.points {
    color: #7debb8;
    font-weight: 900;
    white-space: nowrap;
  }
  .source {
    display: block;
    margin-top: 2px;
    color: #6f7e90;
    font-size: 0.58rem;
  }
  .why {
    display: block;
    margin-top: 5px;
    color: #aeb9c7;
  }
  .score-total {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 10px;
    color: #9aa7b7;
  }
  .score-total strong {
    color: #72f0bc;
    font-size: 1.2rem;
    line-height: 1;
  }
`;
const Ledger = styled.div`
  margin-top: 14px;
  border: 1px solid #303642;
  border-radius: 14px;
  overflow: auto;
  background: #0d1015;
  max-height: 420px;
  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 980px;
  }
  th,
  td {
    padding: 10px 12px;
    border-bottom: 1px solid #252b34;
    text-align: left;
    font-size: 0.7rem;
  }
  th {
    position: sticky;
    top: 0;
    background: #171b22;
    color: #929cab;
    text-transform: uppercase;
  }
  td {
    color: #cdd3dc;
  }
  .win {
    color: #55e88b;
    font-weight: 800;
  }
  .loss {
    color: #ff6876;
    font-weight: 800;
  }
  .selected {
    background: rgba(244, 163, 64, 0.18);
    outline: 1px solid #f4a340;
    outline-offset: -1px;
  }
`;
const ReplayLoading = styled.div`
  height: 540px;
  border: 1px solid #4b315d;
  border-radius: 18px;
  background:
    radial-gradient(
      circle at 50% 40%,
      rgba(138, 62, 181, 0.22),
      transparent 35%
    ),
    #080a0e;
  display: grid;
  place-items: center;
  text-align: center;
  color: #d9b6ee;
  font-weight: 850;
  line-height: 1.7;
  span {
    display: block;
    color: #7f8999;
    font-size: 0.75rem;
    font-weight: 600;
  }
`;

type HistoricalEntrySetup = {
  tradeId?: string;
  zoneAgeSeconds?: number;
  firstOutsideTime?: number;
  priorTouchDetails?: Array<{
    time: number;
    price: number;
  }>;
  formationCandleDetails?: Array<{
    time: number;
    price: number;
  }>;
  zone: GoldilocksDetection["zones"][number];
  confirmationTimeframe: string;
  confirmationTime: number;
  confirmationCandle: StrategyCandle;
  touchCandle: StrategyCandle;
  proximity?: {
    allowed: boolean;
    touchRangeZoneFraction: number;
    confirmationDistanceZoneFraction: number;
    executableDistanceZoneFraction: number;
    executableChecked?: boolean;
    reason: string;
  };
  runway: TradeRunwayCheck;
  trend: "bullish" | "bearish" | "unknown";
  score: GoldilocksScoreResult;
  realizedR?: number | null;
  tradeManager?: string;
  partialExit?: {
    time: number;
    price: number;
    fraction: number;
    realizedR: number;
  };
  approachPressure?: GoldilocksApproachPressure;
  zoneCorridors?: ZoneCorridorMeasurement[];
  marketPath?: TradePathSummary | null;
  managementPolicyResults?: TradeManagementResearchResult[];
  outcome: "win" | "loss" | "open";
  exitReason: "target" | "stop" | "break_even" | "weekend_close" | "open";
  exitPrice?: number;
  breakEvenActivated: boolean;
  outcomeTime?: number;
  departureSpeed?: {
    fastestCandleTime: number;
    fastestCandleRange: number;
    priorAtr14?: number;
    rangeAtrMultiple?: number;
    departureRangeFraction: number;
  };
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
type LiveScenario = {
  pair: string;
  timeframe: string;
  displayTimeframe?: string;
  currentTrend: "bullish" | "bearish" | "unknown";
  fetchedAt: string;
  pagination?: {
    nextBefore: number | null;
    nextAfter?: number | null;
    hasMore: boolean;
    hasNewer?: boolean;
  };
  candles: StrategyCandle[];
  chartViews?: Partial<
    Record<
      "M5" | "M15" | "H1",
      {
        candles: StrategyCandle[];
        swings: Array<{
          swing: "HH" | "HL" | "LH" | "LL";
          price: number;
          candleIndex: number;
          time: number;
        }>;
      }
    >
  >;
  confirmationCandles?: StrategyCandle[] | null;
  leg: SwingLeg;
  detection: GoldilocksDetection;
  zoneHistory: {
    zones: GoldilocksDetection["zones"];
    activeZones: GoldilocksDetection["zones"];
    activeDemand: GoldilocksDetection["zones"][number] | null;
    activeSupply: GoldilocksDetection["zones"][number] | null;
    nearestZones: GoldilocksDetection["zones"];
    displayZones: GoldilocksDetection["zones"];
    recentSwingBase: GoldilocksDetection["zones"][number] | null;
    recentDemandBase: GoldilocksDetection["zones"][number] | null;
    recentSupplyBase: GoldilocksDetection["zones"][number] | null;
    currentPrice: number;
  };
  runwayChecks: Array<TradeRunwayCheck & { zoneId: string }>;
  historicalEntrySetup: HistoricalEntrySetup | null;
  historicalEntrySetups: HistoricalEntrySetup[];
  rejectedFirstTouches: RejectedFirstTouch[];
  requestedTradeTime: number | null;
  requestedZoneTime: number | null;
  historicalMatchDeltaSeconds: number | null;
  legacyReplay?: boolean;
  replayStrategyVersion?: string;
  currentStrategyVersion?: string;
  marketTimeAudit?: {
    entryEligibilityTime: number;
    marketTimeZone: "America/New_York";
    weeklyBlocked: boolean;
    holiday: {
      blocked: boolean;
      marketDate: string;
      kind: "full" | "partial" | null;
      reason: string;
    };
  } | null;
  backtestCoverage: {
    from: number | null;
    to: number | null;
    candles: number;
    trendTimeframe: string;
    zoneTimeframe: string;
    confirmationTimeframe: string;
  };
  strategyStack?: {
    id: string;
    label: string;
    confirmation: string;
    zone: string;
    trend: string;
    drilldown: string;
  };
  swingA: { swing: string; price: number };
  swingB: { swing: string; price: number };
  swings: Array<{
    swing: "HH" | "HL" | "LH" | "LL";
    price: number;
    candleIndex: number;
    time: number;
  }>;
};

export default function StrategyLab() {
  const router = useRouter();
  const selectedStack = getGoldilocksChartStack(router.query.stack);
  const deepLinkLoaded = useRef(false);
  const [direction, setDirection] = useState<"bullish" | "bearish">("bullish");
  const [source, setSource] = useState<"test" | "live">("live");
  const [pair, setPair] = useState("EUR/USD");
  const [timeframe, setTimeframe] = useState<"M1" | "M5" | "M15" | "H1">("M5");
  const [runwayExample, setRunwayExample] = useState<"clear" | "blocked">(
    "blocked",
  );
  const [live, setLive] = useState<LiveScenario | null>(null);
  const [loading, setLoading] = useState(false);
  const [deepLinkPending, setDeepLinkPending] = useState(true);
  const loadingOlder = useRef(false);
  const loadingNewer = useRef(false);
  const responseCache = useRef(
    new Map<string, { payload: LiveScenario; storedAt: number }>(),
  );
  const [error, setError] = useState("");
  const loadLive = useCallback(
    async (
      selectedPair = pair,
      selectedTimeframe = timeframe,
      tradeTime?: number,
      exitTime?: number,
      tradeId?: string,
      zoneTime?: number,
    ) => {
      setLoading(true);
      setError("");
      try {
        const focus = Number.isFinite(tradeTime)
          ? `&tradeTime=${tradeTime}${Number.isFinite(exitTime) ? `&exitTime=${exitTime}` : ""}${tradeId ? `&tradeId=${encodeURIComponent(tradeId)}` : ""}`
          : Number.isFinite(zoneTime)
            ? `&zoneTime=${zoneTime}${router.query.view === "week" ? "&view=week" : ""}`
            : "";
        const requestUrl = `/api/strategy-lab/zones?pair=${encodeURIComponent(selectedPair)}&timeframe=${encodeURIComponent(selectedTimeframe)}&stack=${selectedStack.id}${focus}`;
        const cached = responseCache.current.get(requestUrl);
        if (cached && Date.now() - cached.storedAt < 120_000) {
          setLive(cached.payload);
          const cachedTrend = Number.isFinite(tradeTime)
            ? (cached.payload.historicalEntrySetups?.find(
                (setup) => setup.confirmationTime === tradeTime,
              )?.trend ?? cached.payload.historicalEntrySetup?.trend)
            : undefined;
          setDirection(
            cachedTrend === "bullish" || cachedTrend === "bearish"
              ? cachedTrend
              : cached.payload.currentTrend === "bullish" ||
                  cached.payload.currentTrend === "bearish"
                ? cached.payload.currentTrend
                : cached.payload.leg.direction,
          );
          setSource("live");
          return;
        }
        const response = await fetch(requestUrl, { cache: "no-store" });
        const payload: LiveScenario = await response.json();
        if (!response.ok)
          throw new Error(
            (payload as unknown as { error?: string }).error ??
              "Unable to load live zones",
          );
        responseCache.current.set(requestUrl, {
          payload,
          storedAt: Date.now(),
        });
        if (selectedTimeframe !== selectedStack.trend) {
          const trendUrl = `/api/strategy-lab/zones?pair=${encodeURIComponent(selectedPair)}&timeframe=${selectedStack.trend}&stack=${selectedStack.id}${focus}`;
          if (!responseCache.current.has(trendUrl))
            window.setTimeout(() => {
              void fetch(trendUrl, { cache: "no-store" })
                .then(async (trendResponse) => {
                  if (trendResponse.ok)
                    responseCache.current.set(trendUrl, {
                      payload: await trendResponse.json(),
                      storedAt: Date.now(),
                    });
                })
                .catch(() => {
                  /* foreground load reports actionable errors */
                });
            }, 0);
        }
        setLive(payload);
        const replayTrend = Number.isFinite(tradeTime)
          ? (payload.historicalEntrySetups?.find(
              (setup: HistoricalEntrySetup) =>
                setup.confirmationTime === tradeTime,
            )?.trend ?? payload.historicalEntrySetup?.trend)
          : undefined;
        setDirection(
          replayTrend === "bullish" || replayTrend === "bearish"
            ? replayTrend
            : payload.currentTrend === "bullish" ||
                payload.currentTrend === "bearish"
              ? payload.currentTrend
              : payload.leg.direction,
        );
        setSource("live");
      } catch (requestError) {
        setError((requestError as Error).message);
      } finally {
        setLoading(false);
        if (Number.isFinite(tradeTime)) setDeepLinkPending(false);
      }
    },
    [pair, router.query.view, selectedStack.id, selectedStack.trend, timeframe],
  );
  useEffect(() => {
    if (!router.isReady || deepLinkLoaded.current) return;
    const linkedPair = String(router.query.pair ?? "");
    const linkedTimeframe = String(
      router.query.timeframe ?? "M15",
    ).toUpperCase();
    const tradeTime = Number(router.query.tradeTime);
    const exitTime = Number(router.query.exitTime);
    const tradeId =
      typeof router.query.tradeId === "string"
        ? router.query.tradeId
        : undefined;
    const zoneTime = Number(router.query.zoneTime);
    if (
      !Number.isFinite(tradeTime) ||
      !forexPairs.includes(linkedPair) ||
      !["M1", "M5", "M15", "H1"].includes(linkedTimeframe)
    ) {
      setDeepLinkPending(false);
      return;
    }
    deepLinkLoaded.current = true;
    setDeepLinkPending(true);
    setSource("live");
    setPair(linkedPair);
    const selectedTimeframe = (
      Number.isFinite(tradeTime) ? selectedStack.confirmation : linkedTimeframe
    ) as "M1" | "M5" | "M15" | "H1";
    setTimeframe(selectedTimeframe);
    if (!Number.isFinite(tradeTime)) setDeepLinkPending(false);
    void loadLive(
      linkedPair,
      selectedTimeframe,
      Number.isFinite(tradeTime) ? tradeTime : undefined,
      exitTime,
      tradeId,
      Number.isFinite(zoneTime) ? zoneTime : undefined,
    );
  }, [loadLive, router.isReady, router.query]);
  const reloadLive = useCallback(
    (selectedPair: string, selectedTimeframe: "M1" | "M5" | "M15" | "H1") => {
      const tradeTime = Number(router.query.tradeTime);
      const exitTime = Number(router.query.exitTime);
      const tradeId =
        typeof router.query.tradeId === "string"
          ? router.query.tradeId
          : undefined;
      const zoneTime = Number(router.query.zoneTime);
      return loadLive(
        selectedPair,
        selectedTimeframe,
        Number.isFinite(tradeTime) ? tradeTime : undefined,
        Number.isFinite(exitTime) ? exitTime : undefined,
        tradeId,
        Number.isFinite(zoneTime) ? zoneTime : undefined,
      );
    },
    [
      loadLive,
      router.query.exitTime,
      router.query.tradeId,
      router.query.tradeTime,
      router.query.zoneTime,
    ],
  );
  const loadChartView = useCallback(
    (selectedTimeframe: "M1" | "M5" | "M15" | "H1") => {
      const localView =
        selectedTimeframe === "M1"
          ? undefined
          : live?.chartViews?.[selectedTimeframe];
      if (localView) {
        setLive((current) =>
          current
            ? {
                ...current,
                candles: localView.candles,
                swings: localView.swings,
                displayTimeframe: selectedTimeframe,
              }
            : current,
        );
        setTimeframe(selectedTimeframe);
        return;
      }
      setTimeframe(selectedTimeframe);
      void reloadLive(pair, selectedTimeframe);
    },
    [live?.chartViews, pair, reloadLive],
  );
  const replayCandles = live?.candles;
  const loadOlder = useCallback(async () => {
    if (
      !live?.pagination?.hasMore ||
      !live.pagination.nextBefore ||
      loadingOlder.current
    )
      return;
    loadingOlder.current = true;
    try {
      const response = await fetch(
        `/api/strategy-lab/zones?pair=${encodeURIComponent(pair)}&timeframe=${timeframe}&stack=${selectedStack.id}&before=${live.pagination.nextBefore}`,
        { cache: "no-store" },
      );
      const older: LiveScenario = await response.json();
      if (!response.ok)
        throw new Error(
          (older as unknown as { error?: string }).error ??
            "Unable to load older chart history",
        );
      setLive((current) => {
        if (!current) return older;
        const candles = Array.from(
          new Map(
            [...older.candles, ...current.candles].map((candle) => [
              candle.time,
              candle,
            ]),
          ).values(),
        ).sort((a, b) => a.time - b.time);
        const historicalEntrySetups = Array.from(
          new Map(
            [
              ...older.historicalEntrySetups,
              ...current.historicalEntrySetups,
            ].map((setup) => [
              `${setup.zone.id}-${setup.confirmationTime}`,
              setup,
            ]),
          ).values(),
        ).sort((a, b) => a.confirmationTime - b.confirmationTime);
        const swings = Array.from(
          new Map(
            [...older.swings, ...current.swings].map((swing) => [
              swing.time,
              swing,
            ]),
          ).values(),
        ).sort((a, b) => a.time - b.time);
        return {
          ...current,
          candles,
          historicalEntrySetups,
          pagination: older.pagination,
          swings,
        };
      });
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      loadingOlder.current = false;
    }
  }, [
    live?.pagination?.hasMore,
    live?.pagination?.nextBefore,
    pair,
    timeframe,
  ]);
  const loadNewer = useCallback(async () => {
    if (
      !live?.pagination?.hasNewer ||
      !live.pagination.nextAfter ||
      loadingNewer.current
    )
      return;
    loadingNewer.current = true;
    try {
      const response = await fetch(
        `/api/strategy-lab/zones?pair=${encodeURIComponent(pair)}&timeframe=${timeframe}&stack=${selectedStack.id}&after=${live.pagination.nextAfter}`,
        { cache: "no-store" },
      );
      const newer: LiveScenario = await response.json();
      if (!response.ok)
        throw new Error(
          (newer as unknown as { error?: string }).error ??
            "Unable to load newer chart history",
        );
      setLive((current) => {
        if (!current) return newer;
        const candles = Array.from(
          new Map(
            [...current.candles, ...newer.candles].map((candle) => [
              candle.time,
              candle,
            ]),
          ).values(),
        ).sort((a, b) => a.time - b.time);
        const swings = Array.from(
          new Map(
            [...current.swings, ...newer.swings].map((swing) => [
              swing.time,
              swing,
            ]),
          ).values(),
        ).sort((a, b) => a.time - b.time);
        return {
          ...current,
          candles,
          swings,
          pagination: {
            nextBefore:
              current.pagination?.nextBefore ??
              newer.pagination?.nextBefore ??
              null,
            hasMore:
              current.pagination?.hasMore ?? newer.pagination?.hasMore ?? false,
            nextAfter:
              newer.pagination?.nextAfter ?? current.pagination?.nextAfter,
            hasNewer: newer.pagination?.hasNewer ?? false,
          },
        };
      });
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      loadingNewer.current = false;
    }
  }, [
    live?.pagination?.hasNewer,
    live?.pagination?.nextAfter,
    pair,
    timeframe,
  ]);
  const replayOpposingZone = live?.historicalEntrySetup
    ? live.zoneHistory.nearestZones.find(
        (zone) => zone.side !== live.historicalEntrySetup?.zone.side,
      )
    : undefined;
  const scenario =
    source === "live" && live && replayCandles
      ? {
          candles: replayCandles,
          timeframe: live.displayTimeframe ?? live.timeframe,
          isReplay: Boolean(live.requestedTradeTime || live.requestedZoneTime),
          leg: live.leg,
          detection: live.detection,
          swings: live.swings,
          zones: live.historicalEntrySetup
            ? [
                live.historicalEntrySetup.zone,
                ...(replayOpposingZone ? [replayOpposingZone] : []),
              ]
            : live.zoneHistory.displayZones,
          tradeSetup: live.historicalEntrySetup,
          tradeSetups: live.historicalEntrySetup
            ? [live.historicalEntrySetup]
            : live.historicalEntrySetups,
          rejectedFirstTouches: live.rejectedFirstTouches,
        }
      : undefined;
  const recalculatedFocusedSetup = live?.requestedTradeTime
    ? live.historicalEntrySetups.find(
        (setup) => setup.confirmationTime === live.requestedTradeTime,
      )
    : undefined;
  const downloadTradeDetails = () => {
    const trade = live?.historicalEntrySetup;
    if (!live || !trade) return;
    const payload = {
      exportVersion: "goldilocks-trade-audit-v1",
      exportedAt: new Date().toISOString(),
      tradeId: trade.tradeId ?? null,
      pair: live.pair,
      displayedTimeframe: live.displayTimeframe ?? live.timeframe,
      strategyVersion:
        live.replayStrategyVersion ?? live.currentStrategyVersion ?? null,
      sourceUrl: typeof window !== "undefined" ? window.location.href : null,
      trade,
      marketTimeAudit: live.marketTimeAudit,
      backtestCoverage: live.backtestCoverage,
      displayedContextZones: live.zoneHistory.displayZones,
      runwayChecks: live.runwayChecks,
      rejectedFirstTouches: live.rejectedFirstTouches,
      chartCandleReference: {
        count: live.candles.length,
        firstTime: live.candles[0]?.time ?? null,
        lastTime: live.candles.at(-1)?.time ?? null,
        candlesIncluded: false,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const identity = (
      trade.tradeId ?? `${live.pair}-${trade.confirmationTime}`
    ).replace(/[^A-Za-z0-9_-]+/g, "-");
    anchor.href = url;
    anchor.download = `${identity}-trade-audit.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const hasTradeRequest = Number.isFinite(Number(router.query.tradeTime));
  const headerSummary = !hasTradeRequest
    ? "Open a recorded trade from Backtesting using its View chart button."
    : source === "live"
      ? live?.historicalEntrySetup
        ? `${live.pair} · ${live.displayTimeframe ?? live.timeframe} trade replay · ${live.historicalEntrySetup.zone.side === "demand" ? "BUY" : "SELL"} ${live.historicalEntrySetup.zone.kind} ${live.historicalEntrySetup.zone.side} · confirmed ${formatStrategyReplayEnid(live.historicalEntrySetup.confirmationTime)} · H1 trend ${live.historicalEntrySetup.trend.toUpperCase()}`
        : live
          ? `${live.pair} · ${live.displayTimeframe ?? live.timeframe} · ${(replayCandles ?? live.candles).length} candles · current H1 trend ${live.currentTrend.toUpperCase()}`
          : `${pair} · ${timeframe} · recorded trade replay unavailable`
      : `Deterministic test candles · current trend ${direction.toUpperCase()}`;
  return (
    <Page>
      <Header>
        <div>
          <Title>Historical Trade Replay</Title>
          <Copy>
            {headerSummary}
            {live && Boolean(0) && (
              <>
                {source === "live"
                  ? live
                    ? `${live.pair} · ${live.displayTimeframe ?? live.timeframe} · ${(replayCandles ?? live.candles).length} visible candles · H1 trend: ${live.currentTrend.toUpperCase()}`
                    : `${pair} · ${timeframe} · recorded trade replay unavailable.`
                  : `Deterministic test candles · current trend: ${direction.toUpperCase()}.`}{" "}
                M15 owns the zones and first outside candle. M5 owns prior-touch
                purity, the first trade touch, and later confirmation. Switch
                between H1, M15, and M5 while keeping the
                same M15 zones projected; M1 remains post-entry only.
              </>
            )}
          </Copy>
        </div>
        {Boolean(0) && (
          <Controls>
            <Button
              active={source === "test"}
              onClick={() => {
                setSource("test");
                setLive(null);
              }}
            >
              Test data
            </Button>
            {source === "test" && (
              <>
                <Button
                  active={direction === "bullish"}
                  onClick={() => setDirection("bullish")}
                >
                  Bullish leg
                </Button>
                <Button
                  active={direction === "bearish"}
                  onClick={() => setDirection("bearish")}
                >
                  Bearish leg
                </Button>
                <Button
                  active={runwayExample === "clear"}
                  onClick={() => setRunwayExample("clear")}
                >
                  Clear 2:1
                </Button>
                <Button
                  active={runwayExample === "blocked"}
                  onClick={() => setRunwayExample("blocked")}
                >
                  Blocked 2:1
                </Button>
              </>
            )}
            <Select
              aria-label="Currency pair"
              value={pair}
              onChange={(event) => {
                setPair(event.target.value);
                void reloadLive(event.target.value, timeframe);
              }}
            >
              {forexPairs.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </Select>
            <Button
              active={source === "live"}
              onClick={() => void reloadLive(pair, timeframe)}
            >
              {loading ? "Loading…" : `Load live ${timeframe}`}
            </Button>
          </Controls>
        )}
      </Header>
      {error && (
        <Diagnostic>
          <strong>Trade replay error</strong>
          <br />
          {error}
        </Diagnostic>
      )}
      {live?.legacyReplay && (
        <Diagnostic>
          <strong>
            Legacy trade — not valid under the current timeframe contract
          </strong>
          <br />
          This saved row used {live.replayStrategyVersion}. Its stored trade and
          compatible trend→zone→confirmation candle audit remain visible, but it is not
          treated as a valid {live.currentStrategyVersion} setup.
          {recalculatedFocusedSetup && (
            <>
              {" "}
              Current protected-structure trend at entry:{" "}
              <strong>{recalculatedFocusedSetup.trend.toUpperCase()}</strong>.
            </>
          )}
        </Diagnostic>
      )}
      {live?.requestedTradeTime &&
        !live.historicalEntrySetup &&
        !live.legacyReplay && (
          <Diagnostic>
            <strong>Recorded trade not found in loaded history</strong>
            <br />
            No exact confirmation-timeframe close exists at{" "}
            {formatStrategyReplayEnid(live.requestedTradeTime)}. The chart will
            not substitute a different trade.
          </Diagnostic>
        )}
      {live?.historicalEntrySetup &&
        (() => {
          const trade = live.historicalEntrySetup;
          const isWin = trade.outcome === "win";
          const isOpen = trade.outcome === "open";
          const directionLabel = trade.zone.side === "demand" ? "BUY" : "SELL";
          const confluenceCount =
            trade.zone.timeframeConfluence?.timeframeCount ?? 1;
          const confirmationStrength =
            trade.approachPressure?.confirmationStrengthScore;
          const adverseWarnings =
            trade.approachPressure?.adversePressureFlags.filter(
              (flag) => flag !== "weak_confirmation",
            ) ?? [];
          const roleTimeframes =
            trade.confirmationTimeframe === "M1"
              ? { trend: "M15", zone: "M5", trigger: "M1", execution: "M1" }
              : trade.confirmationTimeframe === "H1"
              ? { trend: "D1", zone: "H4", trigger: "H1", execution: "M5" }
              : { trend: "H1", zone: "M15", trigger: "M5", execution: "M1" };
          const departureScore = trade.score?.components.find((component) =>
            component.name.endsWith(" departure quality"),
          )?.points;
          const purityScore = trade.score?.components.find((component) =>
            component.name.endsWith(" purity"),
          )?.points;
          const approachScore = trade.score?.components.find((component) =>
            component.name.endsWith(" approach warnings"),
          )?.points;
          const trendComponent = trade.score?.components.find((component) =>
            component.name.endsWith(" trend"),
          );
          const confluenceComponent = trade.score?.components.find(
            (component) => component.name === "Zone inside zone",
          );
          const scoreContractVersion = live.legacyReplay
            ? live.replayStrategyVersion
            : live.currentStrategyVersion;
          const departureMaximum = goldilocksScoreComponentMaximum(
            `${roleTimeframes.zone} departure quality`,
            scoreContractVersion,
          );
          const approachMaximum = goldilocksScoreComponentMaximum(
            `${roleTimeframes.trigger} approach warnings`,
            scoreContractVersion,
          );
          const scoreAudit = (
            <AuditCard $wide>
              <h3>
                {live.legacyReplay
                  ? "Stored legacy score and gates"
                  : "Points and hard gates"}
              </h3>
              {live.legacyReplay && (
                <Diagnostic>
                  <strong>
                    Current {live.currentStrategyVersion}: {trade.zone.touches > 3 ? "FAIL BEFORE SCORE" : "NOT RESCORED"}
                  </strong>
                  <br />
                  {trade.zone.touches > 3
                    ? `Zone gate failed: ${trade.zone.touches} prior ${roleTimeframes.trigger} touch candles; maximum allowed is 3. The current contract assigns no 20-point score.`
                    : "The values below belong to the saved strategy version and are not a current-contract score."}
                </Diagnostic>
              )}
              <div className="score-total">
                <strong>{trade.score?.total ?? 0}/20</strong>
                <span>
                  {live.legacyReplay ? "Stored legacy result" : "Minimum"}{" "}
                  {live.legacyReplay ? "· minimum" : ""}{" "}
                  {trade.score?.minimumScore ?? 0}/20 ·{" "}
                  {trade.score?.eligible ? "PASS" : "FAIL"}
                </span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Type</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {(trade.score?.components ?? [])
                    .filter(
                      (component) =>
                        goldilocksScoreComponentMaximum(
                          component.name,
                          scoreContractVersion,
                        ) !== 0,
                    )
                    .map((component) => {
                      const maximum = goldilocksScoreComponentMaximum(
                        component.name,
                        scoreContractVersion,
                      );
                      return (
                        <tr key={component.name}>
                          <td>
                            {scoreComponentDisplayName(component.name)}
                          </td>
                          <td>Points</td>
                          <td className="points">
                            {maximum === null
                              ? component.points
                              : `${component.points} ${component.points === 1 ? "pt" : "pts"} (max ${maximum})`}
                          </td>
                        </tr>
                      );
                    })}
                  {(trade.score?.gates ?? []).map((gate) => (
                    <tr key={`gate-${gate.name}`}>
                      <td>{gate.name}</td>
                      <td>Hard gate</td>
                      <td className="points">
                        {gate.passed ? "PASS" : "FAIL"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <span className="why">
                {live.legacyReplay
                  ? "Legacy values are shown exactly as stored."
                  : "Point rows total 20. Hard gates award no points; any failed hard gate rejects the setup."}
              </span>
              {live.marketTimeAudit && (
                <span className="why">
                  Market time:{" "}
                  {formatStrategyReplayNewYork(
                    live.marketTimeAudit.entryEligibilityTime,
                  )}{" "}
                  · weekly{" "}
                  {live.marketTimeAudit.weeklyBlocked ? "BLOCK" : "PASS"} ·
                  holiday{" "}
                  {live.marketTimeAudit.holiday.blocked ? "BLOCK" : "PASS"}
                </span>
              )}
            </AuditCard>
          );
          return (
            <TradeCandy>
              <TradeTopline>
                <TradeIdentity>
                  <div className="eyebrow">Recorded trade at a glance</div>
                  <h2>
                    {directionLabel} {live.pair} · {trade.zone.kind}{" "}
                    {trade.zone.side}
                  </h2>
                  <code>
                    {trade.tradeId ?? `Confirmation ${trade.confirmationTime}`}
                  </code>
                </TradeIdentity>
                <CandyActions>
                  <Pill $tone={isOpen ? "warn" : isWin ? "good" : "bad"}>
                    {trade.partialExit
                      ? `WIN · PARTIAL PROFIT · ${trade.realizedR != null && trade.realizedR > 0 ? "+" : ""}${trade.realizedR?.toFixed(2) ?? "0.00"}R`
                      : `${trade.outcome.toUpperCase()} · ${trade.exitReason.replaceAll("_", " ").toUpperCase()}`}
                  </Pill>
                  <Pill $tone={trade.score?.eligible ? "good" : "bad"}>
                    {trade.score?.eligible ? "SCORE PASS" : "SCORE FAIL"}
                  </Pill>
                  <DownloadButton onClick={downloadTradeDetails}>
                    Download full trade JSON
                  </DownloadButton>
                </CandyActions>
              </TradeTopline>
              <SnapshotGrid>
                <SnapshotCard $tone={isOpen ? "warn" : isWin ? "good" : "bad"}>
                  <div className="label">Result</div>
                  <div className="value">
                    {trade.realizedR == null
                      ? trade.outcome.toUpperCase()
                      : `${trade.realizedR > 0 ? "+" : ""}${trade.realizedR.toFixed(2)}R`}
                  </div>
                  <div className="meta">
                    {trade.partialExit &&
                    trade.exitReason === "break_even"
                      ? "50% at +1R · remainder exited at entry"
                      : trade.exitReason.replaceAll("_", " ")}{" "}
                    {trade.outcomeTime
                      ? `· ${formatStrategyReplayEnid(trade.outcomeTime)}`
                      : ""}
                  </div>
                </SnapshotCard>
                <SnapshotCard $tone={trade.score?.eligible ? "good" : "bad"}>
                  <div className="label">
                    {live.legacyReplay ? "Stored legacy score" : "Setup score"}
                  </div>
                  <div className="value">{trade.score?.total ?? 0}/20</div>
                  <div className="meta">
                    {live.legacyReplay && trade.zone.touches > 3
                      ? `Current ${live.currentStrategyVersion}: FAIL BEFORE SCORE · ${trade.zone.touches} prior ${roleTimeframes.trigger} touches`
                      : `Minimum ${trade.score?.minimumScore ?? 0} · ${trade.score?.reason ?? "No stored score detail"}`}
                  </div>
                </SnapshotCard>
                <SnapshotCard $tone="info">
                  <div className="label">Trade zone</div>
                  <div className="value">
                    {trade.zone.kind.toUpperCase()}{" "}
                    {trade.zone.side.toUpperCase()}
                  </div>
                  <div className="meta">
                    Age {formatGoldilocksZoneAge(trade.zoneAgeSeconds)} · ZIZ{" "}
                    {confluenceCount}/3
                  </div>
                </SnapshotCard>
                <SnapshotCard $tone={trade.runway.allowed ? "good" : "bad"}>
                  <div className="label">Risk plan</div>
                  <div className="value">
                    {Number(trade.runway.ratio).toFixed(2)}R
                  </div>
                  <div className="meta">
                    Entry {trade.runway.entry} · SL {trade.runway.stopLoss} · TP{" "}
                    {trade.runway.takeProfit}
                  </div>
                </SnapshotCard>
                <SnapshotCard
                  $tone={
                    trade.zone.touches === 0
                      ? "good"
                      : trade.zone.touches <= 1
                        ? "warn"
                        : "bad"
                  }
                >
                  <div className="label">Zone purity</div>
                  <div className="value">
                    {trade.zone.touches} prior touch
                    {trade.zone.touches === 1 ? "" : "s"}
                  </div>
                  <div className="meta">
                    {roleTimeframes.trigger} ledger · trade trigger excluded
                  </div>
                </SnapshotCard>
                <SnapshotCard
                  $tone={
                    trade.approachPressure?.weakConfirmation ? "warn" : "good"
                  }
                >
                  <div className="label">Confirmation timeframe</div>
                  <div className="value">
                    {confirmationStrength === undefined
                      ? "PASS"
                      : `${(confirmationStrength * 100).toFixed(0)}% strength`}
                  </div>
                  <div className="meta">
                    Final confirmation{" "}
                    {confirmationStrength === undefined
                      ? "legacy"
                      : confirmationStrength >= 0.35
                        ? "PASS"
                        : "FAIL"}{" "}
                    · adverse warnings{" "}
                    {trade.approachPressure ? adverseWarnings.length : "legacy"}/2
                  </div>
                </SnapshotCard>
              </SnapshotGrid>
              <AuditDetails open>
                <summary>Review points, hard gates, and supporting evidence</summary>
                <AuditGrid>
                  {scoreAudit}
                  <AuditCard>
                    <h3>Trend and zone confluence · scored</h3>
                    <span className="why">
                      Trend points reward agreement between the trade direction
                      and protected structure at trade time. Confluence points
                      reward overlapping same-side zones across the
                      confirmation, zone, and trend timeframes.
                    </span>
                    <strong>Trend-timeframe alignment:</strong>{" "}
                    {trendComponent?.points ?? "Legacy"}/3
                    <br />
                    <strong>Multi-timeframe zone confluence:</strong>{" "}
                    {confluenceComponent?.points ?? "Legacy"}/4 · ZIZ{" "}
                    {confluenceCount}/3
                  </AuditCard>
                  <AuditCard>
                    <h3>Hard-gate details</h3>
                    <span className="why">
                      Hard gates do not add points. Every one must pass before
                      the setup score can authorize a trade.
                    </span>
                    {(trade.score?.gates ?? []).map((gate) => (
                      <div key={`detail-${gate.name}`}>
                        <strong>
                          {gate.name}: {gate.passed ? "PASS" : "FAIL"}
                        </strong>
                        <br />
                        <span className="muted">{hardGatePurpose(gate.name)}</span>
                        {gate.reason && (
                          <>
                            <br />
                            <span className="muted">{gate.reason}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </AuditCard>
                  <AuditCard>
                    <h3>Zone-timeframe departure quality · scored</h3>
                    <span className="why">
                      Why: a compact base and decisive departure are more likely
                      to represent real imbalance than congestion. Improve by
                      keeping the total formation compact and producing
                      sustained closes away from the zone.
                    </span>
                    <strong>Departure quality:</strong>{" "}
                    {departureScore ?? "Legacy"}/{departureMaximum ?? 4}
                    <br />
                    <strong>Total formation candles:</strong>{" "}
                    {(trade.zone.baseCandleCount ?? 1) +
                      (trade.zone.departureInsideCandleCount ?? 0)}
                    <br />
                    <strong>Base candles:</strong>{" "}
                    {trade.zone.baseCandleCount ?? 1}
                    <br />
                    <strong>Additional candles before first outside:</strong>{" "}
                    {trade.zone.departureInsideCandleCount ?? 0}{" "}
                    candle(s)
                    <br />
                    <strong>Sustained departure:</strong>{" "}
                    {trade.zone.departureMultiple.toFixed(2)}x zone
                  </AuditCard>
                  <AuditCard>
                    <h3>Entry proximity · hard gate</h3>
                    <span className="why">
                      Why: protects against a violent first touch and against
                      chasing an executable price too far from the zone. Touch
                      range measures the entire first confirmation-timeframe
                      candle; executable distance measures the fresh broker
                      {trade.zone.side === "demand" ? " ask" : " bid"} beyond
                      the proximal edge. Both must be no more than 50% of one{" "}
                      zone width. If price is too far
                      away, skip the trade rather than trying to improve it
                      manually.
                    </span>
                    <strong>Touch wick:</strong>{" "}
                    {trade.zone.side === "supply"
                      ? trade.touchCandle.low
                      : trade.touchCandle.high}
                    <br />
                    <strong>Confirmation close:</strong>{" "}
                    {trade.confirmationCandle.close}
                    <br />
                    {trade.proximity && (
                      <>
                        <strong>Touch range:</strong>{" "}
                        {(trade.proximity.touchRangeZoneFraction * 100).toFixed(
                          1,
                        )}
                        % of zone
                        <br />
                        <strong>Executable distance:</strong>{" "}
                        {(
                          trade.proximity.executableDistanceZoneFraction * 100
                        ).toFixed(1)}
                        %
                      </>
                    )}
                  </AuditCard>
                  <AuditCard>
                    <h3>Zone purity · scored</h3>
                    <span className="why">
                      Why: each earlier visit can consume resting orders and
                      weaken the next reaction. Improve quality by favoring
                      untouched zones or, at most, one shallow visit; do not
                      count the trade’s own trigger as prior history.
                    </span>
                    <strong>
                      {live.legacyReplay
                        ? "Stored legacy purity score:"
                        : "Purity score:"}
                    </strong>{" "}
                    {purityScore ?? "Legacy"}/4
                    <br />
                    <strong>Qualifying prior touch candles:</strong>{" "}
                    {trade.zone.touches}
                    <br />
                    <br />
                    <span className="muted">
                      Every completed confirmation-timeframe candle touching
                      the zone after the zone-timeframe first-outside
                      candle and before the trade trigger counts individually.
                      Fresh = 4 pts; one prior touch = 2 pts;
                      otherwise = 0 pts.
                    </span>
                  </AuditCard>
                  <AuditCard>
                    <h3>
                      Confirmation-timeframe approach warnings · scored
                    </h3>
                    <span className="why">
                      Why: these warnings describe dangerous pre-touch pressure.
                      Zero, one, or both warnings award 5, 3, or 0 points.
                      The two categories are a confirmed liquidity sweep and a
                      fast momentum approach. Compression is measured as
                      context but is not a warning.
                    </span>
                    {trade.approachPressure ? (
                      <>
                        <strong>Approach warning score:</strong>{" "}
                        {approachScore ?? "Legacy"}/{approachMaximum ?? 5}
                        <br />
                        <strong>Adverse warnings:</strong>{" "}
                        {adverseWarnings.length}/2 ·{" "}
                        {adverseWarnings.length
                          ? adverseWarnings
                              .map((flag) => flag.replaceAll("_", " "))
                              .join(", ")
                          : "none"}
                        <span className="why">
                          The two possible warnings are a confirmed
                          liquidity sweep and a fast momentum drive into
                          the zone. Compression is not penalized. A liquidity
                          sweep can qualify in either of two ways. The standard
                          path clears and reclaims a sideways or equal-pivot
                          pool by at least 0.15 prior ATR, closes
                          back inside by at least 0.02 prior ATR or 1% of the
                          zone width, and recovers at least 1.25 ATR through the
                          pool midpoint. Equal lows or highs are not required
                          when a wick instead clears one prior swing by at
                          least 3.25 ATR, then reclaims that swing with at
                          least 1.25 ATR of recovery within three analysis
                          candles. A newer adverse extreme cancels either
                          pattern. Sweeps are checked only on the return
                          toward the base: from the latest lowest low for
                          supply or latest highest high for demand through
                          first touch. There is no fixed lookback count. The
                          breach and reaction are one warning,
                          and multiple sweeps still count as one category.
                          Confirmation is reported
                          separately as PASS or FAIL at 35% and is not an
                          adverse-warning category.
                        </span>
                        <strong>Full causal span:</strong>{" "}
                        {trade.approachPressure.sourceApproachCandles ??
                          trade.approachPressure.approachWindowCandles} source
                        candle(s), from first close-away through the candle
                        before first touch.
                        <br />
                        <strong>Return leg analyzed:</strong>{" "}
                        {trade.approachPressure.approachReturnLegCandles ??
                          trade.approachPressure.approachWindowCandles}{" "}
                        {formatWarningResolution(
                          trade.approachPressure.analysisTimeframeSeconds,
                        )} candle(s)
                        {trade.approachPressure.approachReturnLegStartTime
                          ? ` from ${formatStrategyReplayEnid(
                              trade.approachPressure.approachReturnLegStartTime,
                            )}`
                          : ""}{" "}
                        through the candle before first touch.
                        <br />
                        <strong>Sweep and reaction resolution:</strong>{" "}
                        {formatWarningResolution(
                          trade.approachPressure.sweepTimeframeSeconds,
                        )}{" "}
                        confirmation-timeframe candles.
                        <br />
                        {trade.approachPressure.sweepReturnLegStartTime ? (
                          <>
                            <strong>Sweep return-leg start:</strong>{" "}
                            {formatStrategyReplayEnid(
                              trade.approachPressure.sweepReturnLegStartTime,
                            )}. Earlier departure-side sweeps are ignored.
                            <br />
                          </>
                        ) : null}
                        <strong>Approach classification:</strong>{" "}
                        {trade.approachPressure.approachClassification
                          ?.replaceAll("_", " ") ?? "legacy directional-pressure estimate"}{" "}
                        {trade.approachPressure.version >= 2 && (
                          <>
                            <br />
                            Range ratio{" "}
                            {trade.approachPressure.approachRangeContractionRatio?.toFixed(2)} · body ratio{" "}
                            {trade.approachPressure.approachBodyContractionRatio?.toFixed(2)} · overlap{" "}
                            {((trade.approachPressure.approachAverageOverlapFraction ?? 0) * 100).toFixed(1)}% · progress efficiency{" "}
                            {((trade.approachPressure.approachProgressEfficiency ?? 0) * 100).toFixed(1)}%
                            <span className="why">
                              Compression remains descriptive context and does
                              not create a warning. A FAST ATTACK is a distinct
                              multi-candle push separated by a meaningful ATR
                              pullback. It must advance at least 2 ATR and 1.25
                              zone widths with at least 60% close-path
                              efficiency across at least two advancing steps.
                              Isolated spikes and smaller moves do not count.
                              Compression, orderly, and mixed/unclear approaches
                              do not create a warning.
                            </span>
                            <br />
                            Fast attack pushes{" "}
                            {trade.approachPressure.fastApproachBurstCount ?? 0}
                            {" · strongest displacement "}
                            {(
                              trade.approachPressure
                                .fastApproachMaximumDisplacementAtr ??
                              trade.approachPressure.fastApproachMaximumBodyAtr ??
                              0
                            ).toFixed(2)} ATR
                          </>
                        )}
                      </>
                    ) : (
                      <>Legacy trade: confirmation diagnostics were not recorded.</>
                    )}
                  </AuditCard>
                  <AuditCard>
                    <h3>Path and management research · no score</h3>
                    <span className="why">
                      Why: records post-entry path behavior and alternative
                      management evidence for later research. These
                      measurements do not change the official result or the
                      stored 20-point score.
                    </span>
                    {trade.departureSpeed && (
                      <>
                        <br />
                        <strong>Execution-timeframe speed:</strong>{" "}
                        {trade.departureSpeed.rangeAtrMultiple?.toFixed(2) ??
                          "n/a"}
                        x ATR ·{" "}
                        {(
                          trade.departureSpeed.departureRangeFraction * 100
                        ).toFixed(1)}
                        % of the zone-timeframe departure in one candle
                      </>
                    )}
                    {trade.marketPath && (
                      <>
                        <br />
                        <strong>Path:</strong> MFE{" "}
                        {trade.marketPath.mfeR.toFixed(2)}R · MAE{" "}
                        {trade.marketPath.maeR.toFixed(2)}R · ending{" "}
                        {trade.marketPath.endingR.toFixed(2)}R
                      </>
                    )}
                    {trade.partialExit && (
                      <>
                        <br />
                        <strong>Official partial:</strong>{" "}
                        {Math.round(trade.partialExit.fraction * 100)}% at +1R
                        {" · banked "}
                        {trade.partialExit.realizedR > 0 ? "+" : ""}
                        {trade.partialExit.realizedR.toFixed(2)}R
                        {" · "}
                        {formatStrategyReplayEnid(trade.partialExit.time)}
                        <br />
                        <strong>Final remainder exit:</strong>{" "}
                        {trade.exitReason === "break_even"
                          ? "at entry"
                          : trade.exitReason.replaceAll("_", " ")}
                        {trade.realizedR == null
                          ? ""
                          : ` · total ${trade.realizedR > 0 ? "+" : ""}${trade.realizedR.toFixed(2)}R`}
                        {trade.outcomeTime
                          ? ` · ${formatStrategyReplayEnid(trade.outcomeTime)}`
                          : ""}
                      </>
                    )}
                    {trade.zoneCorridors?.map((corridor) => (
                      <div key={corridor.timeframe}>
                        <strong>{corridor.timeframe} corridor:</strong>{" "}
                        {corridor.available
                          ? `${corridor.widthPips?.toFixed(1) ?? "n/a"} pips · entry ${corridor.entryLocationPct?.toFixed(1) ?? "n/a"}%`
                          : corridor.reason}
                      </div>
                    ))}
                    {trade.managementPolicyResults && (
                      <>
                        <strong>Manager replays:</strong>{" "}
                        {trade.managementPolicyResults.length}
                      </>
                    )}
                  </AuditCard>
                </AuditGrid>
              </AuditDetails>
            </TradeCandy>
          );
        })()}
      {deepLinkPending ? (
        <ReplayLoading>
          <div>
            Loading recorded trade replay…
            <span>
              {pair} · {timeframe} · rebuilding the historical zone and
              confirmation
            </span>
          </div>
        </ReplayLoading>
      ) : source === "live" && !live ? (
        <ReplayLoading>
          <div>
            {hasTradeRequest
              ? "Recorded trade replay unavailable"
              : "Choose a recorded trade"}
            <span>
              {error ||
                (hasTradeRequest
                  ? "No historical replay data was returned."
                  : "Return to Backtesting and select View chart on a trade.")}
            </span>
          </div>
        </ReplayLoading>
      ) : (
        <StrategyLabChart
          direction={direction}
          scenario={scenario}
          tradeId={
            typeof router.query.tradeId === "string"
              ? router.query.tradeId
              : live?.historicalEntrySetup?.tradeId
          }
          runwayExample={runwayExample}
          timeframe={timeframe}
          drilldownTimeframe={
            (live?.strategyStack?.drilldown ?? selectedStack.drilldown) as
              | "M1"
              | "M5"
              | "M15"
              | "H1"
          }
          drawingStorageKey={`${pair}:${timeframe}`}
          timeframeLoading={loading}
          hasOlder={Boolean(live?.pagination?.hasMore)}
          hasNewer={Boolean(live?.pagination?.hasNewer)}
          onLoadOlder={loadOlder}
          onLoadNewer={loadNewer}
          onTimeframeChange={(selectedTimeframe) => {
            if (selectedTimeframe === timeframe) return;
            loadChartView(selectedTimeframe);
          }}
          pricePrecision={
            source === "live" && live ? (live.pair.endsWith("/JPY") ? 3 : 5) : 2
          }
        />
      )}
      {live && Boolean(0) && (
        <>
          {live && source === "live" && (
            <Diagnostics>
              <Diagnostic>
                <strong>Nearest active zones</strong>
                <br />
                Current price: {live.zoneHistory.currentPrice}
                <br />
                {live.zoneHistory.nearestZones.map((zone) => (
                  <span key={zone.id}>
                    {zone.kind} {zone.side}: {zone.low}–{zone.high}
                    <br />
                  </span>
                ))}
                <br />
                {live.zoneHistory.zones.length} zones preserved internally ·{" "}
                {live.zoneHistory.activeZones.length} active
              </Diagnostic>
              {live.detection.zones.map((zone) => (
                <Diagnostic key={zone.id}>
                  <strong>
                    {zone.kind} {zone.side}
                  </strong>
                  <br />
                  Candle {zone.candleIndex} · {zone.low}–{zone.high}
                  <br />
                  {zone.state} · {zone.touches} touch(es) ·{" "}
                  {zone.baseCandleCount ?? 1}-candle base ·{" "}
                  {zone.departureInsideCandleCount ?? 0} lingering M15 candle(s)
                  · {zone.departureMultiple.toFixed(2)}x sustained close
                  departure · structural break{" "}
                  {zone.brokeOppositeLegIn ? "YES" : "NO"}
                  <ul>
                    {zone.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </Diagnostic>
              ))}
              {live.detection.rejected.length > 0 && (
                <Diagnostic>
                  <strong>Rejected candidates</strong>
                  <ul>
                    {live.detection.rejected.slice(0, 8).map((item) => (
                      <li key={`${item.candleIndex}-${item.reason}`}>
                        Candle {item.candleIndex}: {item.reason}
                      </li>
                    ))}
                  </ul>
                </Diagnostic>
              )}
            </Diagnostics>
          )}
          {live && source === "live" && (
            <Diagnostics>
              {live.runwayChecks.map((check) => (
                <Diagnostic key={check.zoneId}>
                  <strong>
                    {check.allowed ? "2:1 RUNWAY CLEAR" : "TRADE BLOCKED"}
                  </strong>
                  <br />
                  {check.reason}
                  <br />
                  Entry {check.entry} · SL {check.stopLoss} · TP{" "}
                  {check.takeProfit}
                </Diagnostic>
              ))}
            </Diagnostics>
          )}
          {live && source === "live" && (
            <Ledger>
              <table>
                <thead>
                  <tr>
                    <th>Confirmation</th>
                    <th>Zone</th>
                    <th>Side</th>
                    <th>Prior touches</th>
                    <th>ZIZ</th>
                    <th>H1 trend</th>
                    <th>Score</th>
                    <th>Entry</th>
                    <th>SL</th>
                    <th>TP</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {[...live.historicalEntrySetups]
                    .sort((a, b) => b.confirmationTime - a.confirmationTime)
                    .slice(0, 250)
                    .map((setup, index) => (
                      <tr
                        key={`${setup.zone.id}-${setup.confirmationTime}-${index}`}
                      >
                        <td>
                          {formatStrategyReplayEnid(setup.confirmationTime)}
                        </td>
                        <td>{setup.zone.kind}</td>
                        <td>{setup.zone.side}</td>
                        <td>{setup.zone.touches}</td>
                        <td>
                          {setup.zone.timeframeConfluence?.timeframeCount ?? 1}
                          /3
                        </td>
                        <td>{setup.trend.toUpperCase()}</td>
                        <td>
                          {setup.score?.total ?? 0} /{" "}
                          {setup.score?.minimumScore ?? 0}
                        </td>
                        <td>{setup.runway.entry}</td>
                        <td>{setup.runway.stopLoss}</td>
                        <td>{setup.runway.takeProfit}</td>
                        <td className={setup.outcome}>
                          {setup.outcome.toUpperCase()}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Ledger>
          )}
          <Legend>
            <Rule>
              <strong>Demo pipeline</strong>
              <br />
              H1 trend → M15 zones and outside candle → M5 prior touches, trade
              touch, and later close-through confirmation → M1 outcome sequencing.
            </Rule>
            <Rule>
              <strong>Continuation</strong>
              <br />
              No subjective choppiness filter. A zone exists when the explicit
              candle, leg-position, separation, and departure rules qualify it.
            </Rule>
            <Rule>
              <strong>Zone inside zone (ZIZ)</strong>
              <br />
              ZIZ 2/3 means the trade zone overlapped a same-side zone on two of
              M5, M15, and H1 at that historical moment and earns 2 points. ZIZ
              3/3 earns the 4-point maximum.
            </Rule>
            <Rule>
              <strong>Gate before score</strong>
              <br />
              Invalid zones, stale confirmation, blocked 2:1 runway, spread,
              session, or news failures are rejected before points are
              calculated.
            </Rule>
          </Legend>
        </>
      )}
    </Page>
  );
}
