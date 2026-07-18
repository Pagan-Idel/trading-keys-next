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
  score: {
    total: number;
    minimumScore: number;
    eligible: boolean;
    reason: string;
  };
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
      {live?.historicalEntrySetup && (
        <Diagnostic>
          <strong>Replay trigger audit</strong>
          <br />
          {live.historicalEntrySetup.tradeId && <><strong>Trade ID:</strong> {live.historicalEntrySetup.tradeId}<br /></>}
          <strong>Outcome:</strong>{" "}
          {live.historicalEntrySetup.outcome.toUpperCase()} · {live.historicalEntrySetup.exitReason.replaceAll("_", " ").toUpperCase()}
          <br />
          {live.historicalEntrySetup.firstOutsideTime && <><strong>First outside (M15):</strong> {formatStrategyReplayUtc(live.historicalEntrySetup.firstOutsideTime)}<br /></>}
          <strong>Zone age at entry:</strong> {formatGoldilocksZoneAge(live.historicalEntrySetup.zoneAgeSeconds)}<br />
          Zone actionable: {formatStrategyReplayUtc(live.historicalEntrySetup.zone.availableAt ?? live.historicalEntrySetup.zone.candleTime)}
          {" "}· {live.historicalEntrySetup.zone.touches} prior touch(es), excluding the trigger.
          <br />
          {live.historicalEntrySetup.priorTouchDetails?.map((touch, index) => (
            <span key={`${touch.time}-${index}`}>
              <strong>M15 prior touch {index + 1}:</strong> {formatStrategyReplayUtc(touch.time)}
              {" "}· wick {touch.price} · penetration {(touch.penetration * 100).toFixed(1)}%.
              <br />
            </span>
          ))}
          Trigger touch ({live.historicalEntrySetup.confirmationTimeframe}): {formatStrategyReplayUtc(live.historicalEntrySetup.touchCandle.time)}
          {" "}· wick {live.historicalEntrySetup.zone.side === "supply" ? "low" : "high"}{" "}
          {live.historicalEntrySetup.zone.side === "supply" ? live.historicalEntrySetup.touchCandle.low : live.historicalEntrySetup.touchCandle.high}.
          <br />
          Confirmation ({live.historicalEntrySetup.confirmationTimeframe}): {formatStrategyReplayUtc(live.historicalEntrySetup.confirmationTime)}
          {" "}· close {live.historicalEntrySetup.confirmationCandle.close}{" "}
          {live.historicalEntrySetup.zone.side === "supply" ? "<" : ">"} touched wick: PASS.
          {live.historicalEntrySetup.proximity && <>
            <br /><strong>Entry proximity:</strong>{" "}
            first-touch range {(live.historicalEntrySetup.proximity.touchRangeZoneFraction * 100).toFixed(1)}%
            {" "}· close distance {(live.historicalEntrySetup.proximity.confirmationDistanceZoneFraction * 100).toFixed(1)}%
            {" "}· executable distance {(live.historicalEntrySetup.proximity.executableDistanceZoneFraction * 100).toFixed(1)}% of zone width: PASS.
          </>}
          {live.historicalEntrySetup.zone.departureQuality && <>
            <br /><strong>Departure quality:</strong>{" "}
            {live.historicalEntrySetup.zone.departureQuality.shockRejected ? "REJECT" : "PASS"}
            {" "}· {live.historicalEntrySetup.zone.baseCandleCount ?? 1}-candle base
            {" "}· {live.historicalEntrySetup.zone.departureInsideCandleCount ?? 0} lingering M15 candle(s)
            {" "}· structural trend break {live.historicalEntrySetup.zone.brokeOppositeLegIn ? "YES" : "NO"}
            {" "}· M15 {formatStrategyReplayUtc(live.historicalEntrySetup.zone.departureQuality.departureCandleTime)}
            {live.historicalEntrySetup.zone.departureQuality.rangeAtrMultiple !== undefined && <>{" "}· {live.historicalEntrySetup.zone.departureQuality.rangeAtrMultiple.toFixed(2)}x ATR</>}
            {" "}· rejection wick {(live.historicalEntrySetup.zone.departureQuality.rejectionWickFraction * 100).toFixed(1)}%
            {" "}· close displacement {live.historicalEntrySetup.zone.departureQuality.closeDepartureZoneMultiple.toFixed(2)}x zone
            {" "}· wick excursion {live.historicalEntrySetup.zone.departureQuality.wickDepartureZoneMultiple.toFixed(2)}x zone.
          </>}
          {live.historicalEntrySetup.departureSpeed && <>
            <br /><strong>M1 departure speed:</strong> {formatStrategyReplayUtc(live.historicalEntrySetup.departureSpeed.fastestCandleTime)}
            {live.historicalEntrySetup.departureSpeed.rangeAtrMultiple !== undefined && <>{" "}· {live.historicalEntrySetup.departureSpeed.rangeAtrMultiple.toFixed(2)}x prior M1 ATR</>}
            {" "}· {(live.historicalEntrySetup.departureSpeed.departureRangeFraction * 100).toFixed(1)}% of the M15 departure range printed inside one M1 candle.
          </>}
          {live.marketTimeAudit && <>
            <br /><strong>Entry time gate:</strong> {formatStrategyReplayUtc(live.marketTimeAudit.entryEligibilityTime)}
            {" "}· {formatStrategyReplayNewYork(live.marketTimeAudit.entryEligibilityTime)}
            {" "}· weekly {live.marketTimeAudit.weeklyBlocked ? "BLOCK" : "PASS"}
            {" "}· holiday {live.marketTimeAudit.holiday.blocked ? "BLOCK" : "PASS"}. {live.marketTimeAudit.holiday.reason}
          </>}
          {live.historicalEntrySetup.outcomeTime && <> · Exit: {formatStrategyReplayUtc(live.historicalEntrySetup.outcomeTime)}.</>}
        </Diagnostic>
      )}
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
