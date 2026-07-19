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
import { formatStrategyReplayNewYork, formatStrategyReplayUtc } from "../utils/strategyReplay";
import { formatGoldilocksZoneAge } from "../utils/zoneAge";
import type { GoldilocksScoreResult } from "../utils/goldilocksScoring";
import type { GoldilocksApproachPressure } from "../utils/approachPressure";
import type { ZoneCorridorMeasurement } from "../utils/zoneCorridor";
import type { TradeManagementResearchResult, TradePathSummary } from "../utils/tradeManagementResearch";

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
    radial-gradient(circle at 94% 0%, rgba(210, 86, 255, 0.18), transparent 31%),
    radial-gradient(circle at 5% 100%, rgba(44, 224, 183, 0.12), transparent 32%),
    linear-gradient(145deg, #14101b, #0a0d12 58%);
  box-shadow: 0 18px 55px rgba(0, 0, 0, 0.34), inset 0 1px rgba(255, 255, 255, 0.04);
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
  .eyebrow { color: #f1a6ff; font-size: .64rem; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
  h2 { margin: 5px 0 4px; font-size: clamp(1.1rem, 2.5vw, 1.7rem); letter-spacing: -.02em; }
  code { color: #8996a8; font-size: .7rem; overflow-wrap: anywhere; }
`;
const CandyActions = styled.div`display: flex; gap: 8px; align-items: center; flex-wrap: wrap;`;
const Pill = styled.span<{ $tone?: "good" | "bad" | "warn" | "info" }>`
  display: inline-flex;
  padding: 7px 10px;
  border-radius: 999px;
  font-size: .67rem;
  font-weight: 950;
  letter-spacing: .06em;
  color: ${({$tone})=>$tone==="good"?"#70f2b7":$tone==="bad"?"#ff8b9c":$tone==="warn"?"#ffd878":"#9eeeff"};
  border: 1px solid ${({$tone})=>$tone==="good"?"#28755a":$tone==="bad"?"#7c3343":$tone==="warn"?"#715c2b":"#275f70"};
  background: ${({$tone})=>$tone==="good"?"#102a20":$tone==="bad"?"#30131a":$tone==="warn"?"#2d250f":"#10252c"};
`;
const DownloadButton = styled.button`
  border: 1px solid #8350a0;
  background: linear-gradient(135deg, #51206c, #2b123b);
  color: #f5d9ff;
  border-radius: 10px;
  padding: 8px 11px;
  font-size: .7rem;
  font-weight: 900;
  cursor: pointer;
  &:hover { border-color: #d68cff; transform: translateY(-1px); }
`;
const SnapshotGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 9px;
  @media(max-width: 1100px){grid-template-columns: repeat(3, minmax(0, 1fr));}
  @media(max-width: 650px){grid-template-columns: repeat(2, minmax(0, 1fr));}
`;
const SnapshotCard = styled.div<{ $tone?: "good" | "bad" | "warn" | "info" }>`
  min-height: 102px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid ${({$tone})=>$tone==="good"?"#285c4a":$tone==="bad"?"#65313d":$tone==="warn"?"#5d502b":"#2b3b49"};
  background: ${({$tone})=>$tone==="good"?"linear-gradient(145deg,#10271f,#0d1617)":$tone==="bad"?"linear-gradient(145deg,#2c1219,#151116)":$tone==="warn"?"linear-gradient(145deg,#28220f,#151411)":"linear-gradient(145deg,#111b23,#0d1218)"};
  .label { color: #7f8b9a; font-size: .58rem; letter-spacing: .12em; text-transform: uppercase; font-weight: 900; }
  .value { margin: 7px 0 5px; color: #f4f8fc; font-size: 1.15rem; line-height: 1; font-weight: 950; overflow-wrap: anywhere; }
  .meta { color: #8e9baa; font-size: .66rem; line-height: 1.4; }
`;
const AuditDetails = styled.details`
  margin-top: 12px;
  border: 1px solid #303846;
  border-radius: 14px;
  background: rgba(7, 10, 14, .7);
  summary { cursor: pointer; padding: 12px 14px; color: #d5b3e8; font-size: .72rem; font-weight: 900; list-style-position: inside; }
`;
const AuditGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
  padding: 0 12px 12px;
  @media(max-width: 760px){grid-template-columns: 1fr;}
`;
const AuditCard = styled.div`
  padding: 12px;
  border: 1px solid #28313d;
  border-radius: 12px;
  background: #0d1218;
  color: #8f9cab;
  font-size: .68rem;
  line-height: 1.55;
  h3 { margin: 0 0 8px; color: #e8eef5; font-size: .75rem; }
  strong { color: #c9d4df; }
  ul { margin: 7px 0 0; padding-left: 17px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 4px; border-bottom: 1px solid #222c36; text-align: left; vertical-align: top; }
  th { color: #718092; font-size: .57rem; text-transform: uppercase; letter-spacing: .07em; }
  td.points { color: #7debb8; font-weight: 900; white-space: nowrap; }
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
    penetration: number;
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
    reason: string;
  };
  runway: TradeRunwayCheck;
  trend: "bullish" | "bearish" | "unknown";
  score: GoldilocksScoreResult;
  realizedR?: number | null;
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
  candles: StrategyCandle[];
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
  historicalMatchDeltaSeconds: number | null;
  legacyReplay?: boolean;
  replayStrategyVersion?: string;
  currentStrategyVersion?: string;
  marketTimeAudit?: {
    entryEligibilityTime: number;
    marketTimeZone: "America/New_York";
    weeklyBlocked: boolean;
    holiday: { blocked: boolean; marketDate: string; kind: "full" | "partial" | null; reason: string };
  } | null;
  backtestCoverage: {
    from: number | null;
    to: number | null;
    candles: number;
    trendTimeframe: string;
    zoneTimeframe: string;
    confirmationTimeframe: string;
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
  const deepLinkLoaded = useRef(false);
  const [direction, setDirection] = useState<"bullish" | "bearish">("bullish");
  const [source, setSource] = useState<"test" | "live">("test");
  const [pair, setPair] = useState("EUR/USD");
  const [timeframe, setTimeframe] = useState("M5");
  const [runwayExample, setRunwayExample] = useState<"clear" | "blocked">(
    "blocked",
  );
  const [live, setLive] = useState<LiveScenario | null>(null);
  const [loading, setLoading] = useState(false);
  const [deepLinkPending, setDeepLinkPending] = useState(true);
  const [error, setError] = useState("");
  const loadLive = useCallback(
    async (
      selectedPair = pair,
      selectedTimeframe = timeframe,
      tradeTime?: number,
      exitTime?: number,
      tradeId?: string,
    ) => {
      setLoading(true);
      setError("");
      try {
        const focus = Number.isFinite(tradeTime)
          ? `&tradeTime=${tradeTime}${Number.isFinite(exitTime) ? `&exitTime=${exitTime}` : ""}${tradeId ? `&tradeId=${encodeURIComponent(tradeId)}` : ""}`
          : "";
        const response = await fetch(
          `/api/strategy-lab/zones?pair=${encodeURIComponent(selectedPair)}&timeframe=${encodeURIComponent(selectedTimeframe)}${focus}`,
          { cache: "no-store" },
        );
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error ?? "Unable to load live zones");
        setLive(payload);
        const replayTrend = Number.isFinite(tradeTime)
          ? payload.historicalEntrySetup?.trend
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
    [pair, timeframe],
  );
  useEffect(() => {
    if (!router.isReady || deepLinkLoaded.current) return;
    const linkedPair = String(router.query.pair ?? "");
    const tradeTime = Number(router.query.tradeTime);
    const exitTime = Number(router.query.exitTime);
    const tradeId = typeof router.query.tradeId === "string" ? router.query.tradeId : undefined;
    if (!forexPairs.includes(linkedPair) || !Number.isFinite(tradeTime)) {
      setDeepLinkPending(false);
      return;
    }
    deepLinkLoaded.current = true;
    setDeepLinkPending(true);
    setSource("live");
    setPair(linkedPair);
    setTimeframe("M5");
    void loadLive(linkedPair, "M5", tradeTime, exitTime, tradeId);
  }, [loadLive, router.isReady, router.query]);
  const reloadLive = useCallback(
    (selectedPair: string, selectedTimeframe: string) => {
      const tradeTime = Number(router.query.tradeTime);
      const exitTime = Number(router.query.exitTime);
      const tradeId = typeof router.query.tradeId === "string" ? router.query.tradeId : undefined;
      return loadLive(
        selectedPair,
        selectedTimeframe,
        Number.isFinite(tradeTime) ? tradeTime : undefined,
        Number.isFinite(exitTime) ? exitTime : undefined,
        tradeId,
      );
    },
    [loadLive, router.query.exitTime, router.query.tradeId, router.query.tradeTime],
  );
  const replayCandles = live?.candles;
  const scenario =
    source === "live" && live && replayCandles
      ? {
          candles: replayCandles,
          timeframe: live.displayTimeframe ?? live.timeframe,
          isReplay: Boolean(live.requestedTradeTime),
          leg: live.leg,
          detection: live.detection,
          swings: live.swings,
          zones: live.zoneHistory.displayZones,
          tradeSetup: live.historicalEntrySetup,
          rejectedFirstTouches: live.rejectedFirstTouches,
        }
      : undefined;
  const downloadTradeDetails = () => {
    const trade=live?.historicalEntrySetup;
    if(!live||!trade)return;
    const payload={
      exportVersion:"goldilocks-trade-audit-v1",
      exportedAt:new Date().toISOString(),
      tradeId:trade.tradeId??null,
      pair:live.pair,
      displayedTimeframe:live.displayTimeframe??live.timeframe,
      strategyVersion:live.replayStrategyVersion??live.currentStrategyVersion??null,
      sourceUrl:typeof window!=="undefined"?window.location.href:null,
      trade,
      marketTimeAudit:live.marketTimeAudit,
      backtestCoverage:live.backtestCoverage,
      displayedContextZones:live.zoneHistory.displayZones,
      runwayChecks:live.runwayChecks,
      rejectedFirstTouches:live.rejectedFirstTouches,
      chartCandleReference:{
        count:live.candles.length,
        firstTime:live.candles[0]?.time??null,
        lastTime:live.candles.at(-1)?.time??null,
        candlesIncluded:false,
      },
    };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement("a");
    const identity=(trade.tradeId??`${live.pair}-${trade.confirmationTime}`).replace(/[^A-Za-z0-9_-]+/g,"-");
    anchor.href=url;
    anchor.download=`${identity}-trade-audit.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),0);
  };
  return (
    <Page>
      <Header>
        <div>
          <Title>Goldilocks Zone Lab</Title>
          <Copy>
            {source === "live"
              ? live
                ? `${live.pair} · ${live.displayTimeframe ?? live.timeframe} · ${(replayCandles ?? live.candles).length} visible candles · H1 trend: ${live.currentTrend.toUpperCase()}`
                : `${pair} · ${timeframe} · recorded trade replay unavailable.`
              : `Deterministic test candles · current trend: ${direction.toUpperCase()}.`}{" "}
            M15 owns the zones, first outside candle, and prior-touch purity.
            M5 supplies the first trade touch and later confirmation. Switch between
            H1, M15, and M5 while keeping the same M15 zones projected; M1
            remains post-entry only.
          </Copy>
        </div>
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
          <Select
            aria-label="Candle timeframe"
            value={timeframe}
            onChange={(event) => {
              const selectedTimeframe = event.target.value;
              setTimeframe(selectedTimeframe);
              void reloadLive(pair, selectedTimeframe);
            }}
          >
            <option>M5</option>
            <option>M15</option>
            <option>H1</option>
          </Select>
          <Button
            active={source === "live"}
            onClick={() => void reloadLive(pair, timeframe)}
          >
            {loading ? "Loading…" : `Load live ${timeframe}`}
          </Button>
        </Controls>
      </Header>
      {error && (
        <Diagnostic>
          <strong>Live-data error</strong>
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
          compatible H1→M15→M5 candle audit remain visible, but it is not treated
          as a valid {live.currentStrategyVersion} setup.
        </Diagnostic>
      )}
      {live?.requestedTradeTime &&
        !live.historicalEntrySetup &&
        !live.legacyReplay && (
          <Diagnostic>
            <strong>Recorded trade not found in loaded history</strong>
            <br />
            No exact M5 confirmation exists at{" "}
            {formatStrategyReplayUtc(live.requestedTradeTime)}. The
            chart will not substitute a different trade.
          </Diagnostic>
        )}
      {live?.historicalEntrySetup && (()=>{
        const trade=live.historicalEntrySetup;
        const isWin=trade.outcome==="win";
        const isOpen=trade.outcome==="open";
        const directionLabel=trade.zone.side==="demand"?"BUY":"SELL";
        const confluenceCount=trade.zone.timeframeConfluence?.timeframeCount??1;
        const confirmationStrength=trade.approachPressure?.confirmationStrengthScore;
        const departure=trade.zone.departureQuality;
        return <TradeCandy>
          <TradeTopline>
            <TradeIdentity>
              <div className="eyebrow">Recorded trade at a glance</div>
              <h2>{directionLabel} {live.pair} · {trade.zone.kind} {trade.zone.side}</h2>
              <code>{trade.tradeId??`Confirmation ${trade.confirmationTime}`}</code>
            </TradeIdentity>
            <CandyActions>
              <Pill $tone={isOpen?"warn":isWin?"good":"bad"}>{trade.outcome.toUpperCase()} · {trade.exitReason.replaceAll("_"," ").toUpperCase()}</Pill>
              <Pill $tone={trade.score?.eligible?"good":"bad"}>{trade.score?.eligible?"SCORE PASS":"SCORE FAIL"}</Pill>
              <DownloadButton onClick={downloadTradeDetails}>Download full trade JSON</DownloadButton>
            </CandyActions>
          </TradeTopline>
          <SnapshotGrid>
            <SnapshotCard $tone={isOpen?"warn":isWin?"good":"bad"}>
              <div className="label">Result</div><div className="value">{trade.realizedR==null?trade.outcome.toUpperCase():`${trade.realizedR>0?"+":""}${trade.realizedR.toFixed(2)}R`}</div>
              <div className="meta">{trade.exitReason.replaceAll("_"," ")} {trade.outcomeTime?`· ${formatStrategyReplayUtc(trade.outcomeTime)}`:""}</div>
            </SnapshotCard>
            <SnapshotCard $tone={trade.score?.eligible?"good":"bad"}>
              <div className="label">Setup score</div><div className="value">{trade.score?.total??0}/20</div>
              <div className="meta">Minimum {trade.score?.minimumScore??0} · {trade.score?.reason??"No stored score detail"}</div>
            </SnapshotCard>
            <SnapshotCard $tone="info">
              <div className="label">Trade zone</div><div className="value">{trade.zone.kind.toUpperCase()} {trade.zone.side.toUpperCase()}</div>
              <div className="meta">Age {formatGoldilocksZoneAge(trade.zoneAgeSeconds)} · ZIZ {confluenceCount}/3</div>
            </SnapshotCard>
            <SnapshotCard $tone={trade.runway.allowed?"good":"bad"}>
              <div className="label">Risk plan</div><div className="value">{Number(trade.runway.ratio).toFixed(2)}R</div>
              <div className="meta">Entry {trade.runway.entry} · SL {trade.runway.stopLoss} · TP {trade.runway.takeProfit}</div>
            </SnapshotCard>
            <SnapshotCard $tone={trade.zone.touches===0?"good":trade.zone.touches<=1?"warn":"bad"}>
              <div className="label">M15 purity</div><div className="value">{trade.zone.touches} prior touch{trade.zone.touches===1?"":"es"}</div>
              <div className="meta">Deepest penetration {(trade.zone.maxPenetration*100).toFixed(1)}% · trigger excluded</div>
            </SnapshotCard>
            <SnapshotCard $tone={trade.approachPressure?.weakConfirmation?"warn":"good"}>
              <div className="label">M5 confirmation</div><div className="value">{confirmationStrength===undefined?"PASS":`${(confirmationStrength*100).toFixed(0)}% strength`}</div>
              <div className="meta">Later candle confirmed · adverse flags {trade.approachPressure?.adversePressureScore??"legacy"}/4</div>
            </SnapshotCard>
          </SnapshotGrid>
          <AuditDetails>
            <summary>Open full replay audit and research evidence</summary>
            <AuditGrid>
              <AuditCard><h3>Timeline</h3>
                {trade.firstOutsideTime&&<><strong>First outside:</strong> {formatStrategyReplayUtc(trade.firstOutsideTime)}<br/></>}
                <strong>Zone actionable:</strong> {formatStrategyReplayUtc(trade.zone.availableAt??trade.zone.candleTime)}<br/>
                <strong>{trade.confirmationTimeframe} touch:</strong> {formatStrategyReplayUtc(trade.touchCandle.time)}<br/>
                <strong>{trade.confirmationTimeframe} confirmation:</strong> {formatStrategyReplayUtc(trade.confirmationTime)}<br/>
                {trade.outcomeTime&&<><strong>Exit:</strong> {formatStrategyReplayUtc(trade.outcomeTime)}</>}
              </AuditCard>
              <AuditCard><h3>Zone formation</h3>
                <strong>Base:</strong> {trade.zone.baseCandleCount??1} candle(s)<br/>
                <strong>Lingering inside:</strong> {trade.zone.departureInsideCandleCount??0} M15 candle(s)<br/>
                <strong>Structural trend break:</strong> {trade.zone.brokeOppositeLegIn?"YES":"NO"}<br/>
                <strong>Sustained departure:</strong> {trade.zone.departureMultiple.toFixed(2)}x zone
                {departure&&<><br/><strong>Shock gate:</strong> {departure.shockRejected?"REJECT":"PASS"} · {departure.rangeAtrMultiple?.toFixed(2)??"n/a"}x ATR · {(departure.rejectionWickFraction*100).toFixed(1)}% rejection wick · {departure.closeDepartureZoneMultiple.toFixed(2)}x close displacement · {departure.wickDepartureZoneMultiple.toFixed(2)}x wick excursion</>}
              </AuditCard>
              <AuditCard><h3>Touch and entry quality</h3>
                <strong>Touch wick:</strong> {trade.zone.side==="supply"?trade.touchCandle.low:trade.touchCandle.high}<br/>
                <strong>Confirmation close:</strong> {trade.confirmationCandle.close}<br/>
                {trade.proximity&&<><strong>Touch range:</strong> {(trade.proximity.touchRangeZoneFraction*100).toFixed(1)}% of zone<br/><strong>Close distance:</strong> {(trade.proximity.confirmationDistanceZoneFraction*100).toFixed(1)}%<br/><strong>Executable distance:</strong> {(trade.proximity.executableDistanceZoneFraction*100).toFixed(1)}%</>}
                {(trade.priorTouchDetails?.length??0)>0&&<ul>{trade.priorTouchDetails?.map((touch,index)=><li key={`${touch.time}-${index}`}>Prior touch {index+1}: {formatStrategyReplayUtc(touch.time)} · {touch.price} · {(touch.penetration*100).toFixed(1)}%</li>)}</ul>}
              </AuditCard>
              <AuditCard><h3>Score components</h3>
                <table><thead><tr><th>Component</th><th>Points</th><th>Evidence</th></tr></thead><tbody>{(trade.score?.components??[]).map(component=><tr key={component.name}><td>{component.name}</td><td className="points">{component.points}</td><td>{component.detail}</td></tr>)}</tbody></table>
              </AuditCard>
              <AuditCard><h3>Hard gates</h3>
                <table><thead><tr><th>Gate</th><th>Result</th><th>Reason</th></tr></thead><tbody>{(trade.score?.gates??[]).map(gate=><tr key={gate.name}><td>{gate.name}</td><td className="points">{gate.passed?"PASS":"FAIL"}</td><td>{gate.reason}</td></tr>)}</tbody></table>
                {live.marketTimeAudit&&<><br/><strong>Market time:</strong> {formatStrategyReplayNewYork(live.marketTimeAudit.entryEligibilityTime)} · weekly {live.marketTimeAudit.weeklyBlocked?"BLOCK":"PASS"} · holiday {live.marketTimeAudit.holiday.blocked?"BLOCK":"PASS"}</>}
              </AuditCard>
              <AuditCard><h3>Research diagnostics</h3>
                {trade.approachPressure?<><strong>Confirmation strength:</strong> {(trade.approachPressure.confirmationStrengthScore*100).toFixed(0)}%<br/><strong>Compression:</strong> {(trade.approachPressure.approachCompressionScore*100).toFixed(0)}%<br/><strong>Liquidity sweeps:</strong> {trade.approachPressure.liquiditySweepCount}<br/><strong>Adverse flags:</strong> {trade.approachPressure.adversePressureFlags.join(", ")||"none"}</>:<>Legacy trade: approach pressure was not recorded.</>}
                {trade.departureSpeed&&<><br/><strong>M1 speed:</strong> {trade.departureSpeed.rangeAtrMultiple?.toFixed(2)??"n/a"}x ATR · {(trade.departureSpeed.departureRangeFraction*100).toFixed(1)}% of M15 departure in one candle</>}
                {trade.marketPath&&<><br/><strong>Path:</strong> MFE {trade.marketPath.mfeR.toFixed(2)}R · MAE {trade.marketPath.maeR.toFixed(2)}R · ending {trade.marketPath.endingR.toFixed(2)}R</>}
                {trade.zoneCorridors?.map(corridor=><div key={corridor.timeframe}><strong>{corridor.timeframe} corridor:</strong> {corridor.available?`${corridor.widthPips?.toFixed(1)??"n/a"} pips · entry ${corridor.entryLocationPct?.toFixed(1)??"n/a"}%`:corridor.reason}</div>)}
                {trade.managementPolicyResults&&<><strong>Manager replays:</strong> {trade.managementPolicyResults.length}</>}
              </AuditCard>
            </AuditGrid>
          </AuditDetails>
        </TradeCandy>;
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
            Recorded trade replay unavailable
            <span>{error || "No historical replay data was returned."}</span>
          </div>
        </ReplayLoading>
      ) : (
        <StrategyLabChart
          direction={direction}
          scenario={scenario}
          runwayExample={runwayExample}
          pricePrecision={
            source === "live" && live ? (live.pair.endsWith("/JPY") ? 3 : 5) : 2
          }
        />
      )}
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
              {zone.departureInsideCandleCount ?? 0} lingering M15 candle(s) ·{" "}
              {zone.departureMultiple.toFixed(2)}x sustained close departure ·{" "}
              structural break {zone.brokeOppositeLegIn ? "YES" : "NO"}
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
              Entry {check.entry} · SL {check.stopLoss} · TP {check.takeProfit}
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
                      {new Date(setup.confirmationTime * 1000).toLocaleString()}
                    </td>
                    <td>{setup.zone.kind}</td>
                    <td>{setup.zone.side}</td>
                    <td>{setup.zone.touches}</td>
                    <td>
                      {setup.zone.timeframeConfluence?.timeframeCount ?? 1}/3
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
          H1 trend → M15 zones, outside candle, and prior touches → M5 trade
          touch and later M5 close-through confirmation → M1 outcome sequencing.
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
          M5, M15, and H1 at that historical moment. ZIZ 3/3 is the maximum.
        </Rule>
        <Rule>
          <strong>Gate before score</strong>
          <br />
          Invalid zones, stale confirmation, blocked 2:1 runway, spread,
          session, or news failures are rejected before points are calculated.
        </Rule>
      </Legend>
    </Page>
  );
}
