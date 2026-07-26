import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import styled from "styled-components";
import { forexPairs } from "../utils/constants";
import { RISK_PROFILES, type RiskProfile } from "../utils/dynamicRisk";
import { simulateBacktestPortfolio } from "../utils/backtestPortfolio";
import {
  getGoldilocksBacktestRunLabel,
  getGoldilocksScoreCategoryWeights,
  getGoldilocksTimeframeProfile,
  GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS,
  normalizeGoldilocksBacktestGates,
  normalizeGoldilocksBacktestTweaks,
  normalizeGoldilocksScoreWeights,
  rebalanceGoldilocksScoreCategories,
  expandGoldilocksScoreCategoryWeights,
  type GoldilocksBacktestGates,
  type GoldilocksBacktestTweaks,
  type GoldilocksScoreWeights,
  type GoldilocksScoreCategory,
  type GoldilocksTimeframeProfileId,
} from "../utils/goldilocksConfig";
import { calculateBacktestPerformance } from "../utils/backtestAnalytics";
import {
  GOLDILOCKS_BACKTEST_MANAGERS,
  GOLDILOCKS_DEFAULT_MANAGEMENT,
  GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID,
  getGoldilocksBacktestManager,
  type GoldilocksBacktestManagerId,
} from "../utils/goldilocksTradeManagement";

const Page = styled.div`
  width: min(1380px, calc(100% - 30px));
  margin: 0 auto 80px;
  color: #eef3ff;
  font-family: Inter, system-ui, sans-serif;
`;
const TweakGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
  gap: 8px;
  margin-top: 14px;
`;
const TweakField = styled.label`
  position: relative;
  display: grid;
  gap: 5px;
  padding: 9px 10px;
  border: 1px solid #303745;
  border-radius: 11px;
  background: #0d1117;
  color: #8995a6;
  font-size: 0.64rem;
  font-weight: 800;
  span { color: #dce7f5; }
  span[title] { cursor: help; text-decoration: underline dotted #647287; text-underline-offset: 3px; }
  input {
    width: 100%;
    border: 1px solid #343d4b;
    border-radius: 8px;
    background: #151a22;
    color: #fff;
    padding: 7px 8px;
  }
  input[type="checkbox"] {
    width: 22px;
    height: 22px;
    padding: 0;
    accent-color: #61efb3;
  }
  &[data-tooltip] { cursor: help; }
  &[data-tooltip]::after {
    content: attr(data-tooltip);
    position: absolute;
    z-index: 40;
    left: 50%;
    bottom: calc(100% + 9px);
    width: min(280px, 75vw);
    padding: 10px 12px;
    border: 1px solid #52617a;
    border-radius: 10px;
    background: #05080eef;
    color: #dce7f5;
    font-size: 0.7rem;
    font-weight: 650;
    line-height: 1.45;
    box-shadow: 0 12px 28px #000c;
    opacity: 0;
    visibility: hidden;
    transform: translate(-50%, 4px);
    transition: 0.14s ease;
    pointer-events: none;
  }
  &[data-tooltip]:hover::after,
  &[data-tooltip]:focus-within::after {
    opacity: 1;
    visibility: visible;
    transform: translate(-50%, 0);
  }
`;
const ConfigCategory = styled.div`
  margin-top: 16px;
  padding: 14px;
  border: 1px solid #293445;
  border-radius: 12px;
  background: #081019cc;
  h3 {
    margin: 0;
    color: #71efc0;
    font-size: 0.85rem;
  }
  p {
    margin: 4px 0 0;
    color: #91a1b8;
    font-size: 0.7rem;
  }
`;
const RestoreWeightsButton = styled.button`
  margin-top: 10px;
  border: 1px solid #715682;
  border-radius: 9px;
  background: #26172f;
  color: #f3c5ff;
  padding: 7px 11px;
  font-size: 0.68rem;
  font-weight: 850;
  cursor: pointer;
  &:hover:not(:disabled) { background: #382043; }
  &:disabled { opacity: 0.45; cursor: default; }
`;
const RuleDisclosure = styled.details`
  margin-top: 18px;
  border: 1px solid #354156;
  border-radius: 14px;
  background: #090e16cc;
  overflow: visible;
  summary {
    cursor: pointer;
    padding: 14px 16px;
    color: #ef9cff;
    font-size: 0.76rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    user-select: none;
  }
  summary:hover { background: #121925; }
  &[open] summary { border-bottom: 1px solid #293445; }
  .rule-body { padding: 0 14px 16px; }
`;
const Hero = styled.section`
  padding: 24px;
  border: 1px solid #2b3240;
  border-radius: 24px;
  background:
    radial-gradient(circle at 80% 0, #35204c 0, transparent 34%),
    linear-gradient(145deg, #151922, #0b0e13);
  box-shadow: 0 24px 80px #0009;
`;
const Kicker = styled.div`
  color: #ef9cff;
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
`;
const Title = styled.h1`
  font-size: clamp(2rem, 5vw, 4.4rem);
  line-height: 0.95;
  margin: 10px 0;
  background: linear-gradient(90deg, #fff, #f6a9ff, #74e7ff);
  -webkit-background-clip: text;
  color: transparent;
`;
const Sub = styled.p`
  color: #99a5b8;
  max-width: 800px;
  line-height: 1.55;
  margin: 0;
`;
const Controls = styled.div`
  display: grid;
  grid-template-columns: 1.4fr 0.7fr 0.6fr 0.6fr auto;
  gap: 12px;
  margin-top: 22px;
  @media (max-width: 850px) {
    grid-template-columns: 1fr 1fr;
  }
`;
const Field = styled.label`
  display: grid;
  gap: 6px;
  color: #8e99aa;
  font-size: 0.7rem;
  text-transform: uppercase;
  font-weight: 800;
  input,
  select {
    border: 1px solid #343c4a;
    background: #0c1016;
    color: #fff;
    border-radius: 12px;
    padding: 11px 12px;
    outline: none;
  }
`;
const Button = styled.button`
  border: 1px solid #9b49c8;
  background: linear-gradient(135deg, #6d2399, #c23cd9);
  color: #fff;
  border-radius: 13px;
  padding: 11px 18px;
  font-weight: 900;
  cursor: pointer;
  box-shadow: 0 0 28px #a63ac444;
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;
const CancelButton = styled(Button)`
  border-color: #ff6678;
  background: linear-gradient(135deg, #6f1e35, #b92f50);
  box-shadow: 0 0 28px #ff426633;
`;
const PairGrid = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
`;
const Pair = styled.button<{ $on: boolean }>`
  border: 1px solid ${(p) => (p.$on ? "#34d995" : "#323946")};
  background: ${(p) => (p.$on ? "#103b2a" : "#11151c")};
  color: ${(p) => (p.$on ? "#76ffc0" : "#7f8998")};
  padding: 8px 11px;
  border-radius: 999px;
  cursor: pointer;
  font-weight: 800;
  font-size: 0.72rem;
`;
const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 16px;
  @media (max-width: 850px) {
    grid-template-columns: repeat(2, 1fr);
  }
`;
const Card = styled.div`
  border: 1px solid #2d3542;
  background: #10141b;
  border-radius: 18px;
  padding: 17px;
  box-shadow: inset 0 1px #ffffff08;
`;
const Metric = styled.div`
  font-size: 1.85rem;
  font-weight: 950;
  color: #fff;
  margin-top: 6px;
`;
const Label = styled.div`
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #7f8a9c;
  font-weight: 850;
`;
const Progress = styled.div`
  height: 7px;
  margin-top: 10px;
  border-radius: 99px;
  background: #252b36;
  overflow: hidden;
  span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #e05cff, #55e8c2);
    transition: width 0.35s ease;
  }
`;
const MoneyLab = styled.section`
  margin-top: 16px;
  padding: 20px;
  border: 1px solid #315243;
  border-radius: 20px;
  background:
    radial-gradient(circle at 90% 0, #174d3b66, transparent 34%),
    linear-gradient(145deg, #101820, #0b1015);
`;
const MoneyControls = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(150px, 1fr));
  gap: 12px;
  margin-top: 16px;
  @media (max-width: 800px) {
    grid-template-columns: 1fr 1fr;
  }
`;
const MoneyGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 10px;
  margin-top: 14px;
  @media (max-width: 1050px) {
    grid-template-columns: repeat(3, 1fr);
  }
  @media (max-width: 600px) {
    grid-template-columns: repeat(2, 1fr);
  }
`;
const MoneyNote = styled.p`
  margin: 12px 0 0;
  color: #7f8e99;
  font-size: 0.7rem;
  line-height: 1.5;
`;
const EdgeLab = styled.section`
  margin-top: 16px;
  padding: 20px;
  border: 1px solid #4b3d63;
  border-radius: 20px;
  background:
    radial-gradient(circle at 88% 0, #542d6b55, transparent 34%),
    linear-gradient(145deg, #13121b, #0b0e14);
`;
const EdgeGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
  @media (max-width: 900px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .muted {
    display: block;
    margin-top: 5px;
    color: #7f8a9c;
    font-size: 0.68rem;
  }
`;
const EdgeNote = styled.p`
  margin: 12px 0 0;
  color: #9a91a8;
  font-size: 0.72rem;
  line-height: 1.55;
  strong {
    color: #f1c7ff;
  }
`;
const Section = styled.section`
  margin-top: 16px;
  border: 1px solid #29313d;
  background: #0c1016;
  border-radius: 20px;
  overflow: hidden;
`;
const Head = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid #28303b;
  h2 {
    font-size: 0.95rem;
    margin: 0;
  }
  .muted {
    color: #758094;
    font-size: 0.72rem;
  }
`;
const TradeSearch = styled.form`
  display: flex;
  gap: 8px;
  input {
    width: min(330px, 45vw);
    border: 1px solid #3b4656;
    background: #090d12;
    color: #fff;
    border-radius: 9px;
    padding: 8px 10px;
    font:
      750 0.72rem ui-monospace,
      SFMono-Regular,
      Consolas,
      monospace;
    text-transform: uppercase;
  }
  button {
    border: 1px solid #42d7ab;
    background: #123c31;
    color: #81fbd4;
    border-radius: 9px;
    padding: 8px 12px;
    font-weight: 900;
    cursor: pointer;
  }
`;
const TradeSearchResult = styled.div`
  margin: 12px 18px 0;
  padding: 11px 13px;
  border: 1px solid #3a806b;
  border-radius: 11px;
  background: #10251f;
  color: #bcebdd;
  font-size: 0.75rem;
  code {
    color: #7dffd4;
    font-weight: 900;
  }
`;
const TradeId = styled.code`
  color: #7dffd4;
  font-size: 0.68rem;
  font-weight: 850;
  white-space: nowrap;
`;
const Table = styled.div`
  overflow: auto;
  max-height: 520px;
  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 850px;
  }
  th,
  td {
    padding: 11px 14px;
    border-bottom: 1px solid #222a34;
    text-align: left;
    font-size: 0.72rem;
  }
  th {
    position: sticky;
    top: 0;
    background: #151a22;
    color: #7e8999;
    text-transform: uppercase;
  }
  .win {
    color: #58ee9b;
    font-weight: 900;
  }
  .loss {
    color: #ff6678;
    font-weight: 900;
  }
  .break-even {
    color: #ffd166;
    font-weight: 900;
  }
`;
const LeaderboardTable = styled(Table)`
  table {
    min-width: 1750px;
  }
  th {
    white-space: nowrap;
  }
`;
const Feed = styled.div`
  max-height: 390px;
  overflow: auto;
  display: flex;
  flex-direction: column;
`;
const Event = styled.div`
  display: grid;
  grid-template-columns: 9px 80px 90px 1fr;
  gap: 10px;
  padding: 11px 16px;
  border-bottom: 1px solid #222933;
  align-items: start;
  font-size: 0.72rem;
  color: #bdc5d1;
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #e45bff;
    box-shadow: 0 0 12px #e45bff;
  }
  .time,
  .pair {
    color: #687487;
  }
  .message {
    line-height: 1.4;
  }
`;
const ReplayLink = styled(Link)`
  display: inline-flex;
  border: 1px solid #a763db;
  background: #2d153d;
  color: #f1ceff;
  border-radius: 7px;
  padding: 5px 8px;
  text-decoration: none;
  font-weight: 850;
  white-space: nowrap;
`;
const DeleteButton = styled.button`
  border: 1px solid #7a3443;
  background: #35151d;
  color: #ff8797;
  border-radius: 8px;
  padding: 5px 8px;
  font-size: 0.66rem;
  font-weight: 850;
  cursor: pointer;
  white-space: nowrap;
  &:hover {
    border-color: #ff6678;
    background: #571f2d;
    color: #fff;
  }
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;
const ClearAllButton = styled(DeleteButton)`
  padding: 8px 11px;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;
const SortControls = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  select {
    border: 1px solid #3b4656;
    background: #090d12;
    color: #eaf1fb;
    border-radius: 9px;
    padding: 8px 10px;
    font-size: 0.72rem;
    font-weight: 800;
  }
`;
const SortableHeading = styled.button`
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: inherit;
  text-transform: inherit;
  white-space: nowrap;
  cursor: pointer;
  &:hover,
  &:focus-visible {
    color: #fff;
  }
`;
const PairCount = styled.button`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  padding: 4px 8px;
  border: 1px solid #36d6a1;
  background: #10372d;
  color: #7dffd0;
  border-radius: 999px;
  font: inherit;
  font-weight: 900;
  cursor: help;
  outline: none;
  &:hover > span,
  &:focus-visible > span {
    opacity: 1;
    visibility: visible;
    transform: translate(-50%, 0);
  }
`;
const PairTip = styled.span`
  position: absolute;
  z-index: 20;
  left: 50%;
  bottom: calc(100% + 8px);
  width: max-content;
  max-width: 310px;
  padding: 9px 11px;
  border: 1px solid #485365;
  border-radius: 10px;
  background: #111720;
  color: #e8eef8;
  box-shadow: 0 12px 30px #000b;
  line-height: 1.6;
  white-space: normal;
  opacity: 0;
  visibility: hidden;
  transform: translate(-50%, 5px);
  transition: 0.15s ease;
  pointer-events: none;
  strong {
    display: block;
    color: #71efc0;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .list {
    display: block;
    font-weight: 750;
  }
`;

type RunConfig = {
  minimumScore: number;
  lookbackDays: number;
  pairs: string[];
  strategyVersion?: string;
  startingBalance?: number;
  leverage?: number;
  riskProfile?: RiskProfile;
  tradeManager?: GoldilocksBacktestManagerId;
  protectedWinR?: number;
  timeframeProfile?: GoldilocksTimeframeProfileId;
  strategyTweaks?: GoldilocksBacktestTweaks;
  gateSettings?: GoldilocksBacktestGates;
  scoreWeights?: GoldilocksScoreWeights;
  backfillPages?: number;
  archiveOnly?: boolean;
  datasetEndTime?: number;
  datasetKey?: string;
};
type Run = {
  id: string;
  status: string;
  label: string;
  createdAt: string;
  progressPair?: string;
  progressDone: number;
  progressTotal: number;
  progressStage?: string;
  progressPercent?: number;
  heartbeatAt?: string;
  totalTrades: number;
  wins: number;
  losses: number;
  error?: string;
  config: RunConfig;
};
type PairResult = {
  runId: string;
  label: string;
  createdAt: string;
  pair: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  maxDrawdown: number;
  averageScore: number;
  sampleTrades: number;
  omittedTrades: number;
  profitableTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  profitableRate: number;
  averageWinR: number | null;
  averageLossR: number | null;
  expectancyR: number | null;
  profitFactor: number | "infinite" | null;
  payoffRatio: number | null;
  breakEvenWinRate: number | null;
  netR: number;
  maxDrawdownR: number;
  longestLosingStreak: number;
  config: RunConfig;
};
type RunResult = Run & {
  sampleTrades: number;
  omittedTrades: number;
  profitableTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  profitableRate: number;
  averageWinR: number | null;
  averageLossR: number | null;
  expectancyR: number | null;
  profitFactor: number | "infinite" | null;
  payoffRatio: number | null;
  netR: number;
  maxDrawdownR: number;
  longestLosingStreak: number;
  endingBalance: number;
  netProfitLoss: number;
  accountReturn: number;
  maxDrawdownPercent: number;
  peakMargin: number;
  marginBlocked: number;
  acceptedTrades: number;
};
type Dashboard = {
  runs: Run[];
  runResults: RunResult[];
  selectedRunId: string;
  trades: Array<Record<string, any>>;
  pairs: Array<Record<string, any>>;
  pairResults: PairResult[];
  events: Array<Record<string, any>>;
};
type SortDirection = "asc" | "desc";
type ScoreComponent = { name: string; points: number; detail: string };
type TradeRow = Record<string, any> & {
  scoreDetail?: { components?: ScoreComponent[] };
};
const managerForRunConfig = (config: RunConfig) => {
  if (config.tradeManager)
    return getGoldilocksBacktestManager(config.tradeManager);
  const numericVersion = Number(config.strategyVersion);
  return getGoldilocksBacktestManager(
    Number.isFinite(numericVersion) && numericVersion <= 0.4
      ? GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID
      : GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,
  );
};
const backtestTweakFields: Array<{
  key: keyof GoldilocksBacktestTweaks;
  label: string;
  short: string;
  explanation: string;
  step: number;
}> = [
  { key: "maximumPriorTouches", label: "Max prior touches", short: "TOUCH MAX", explanation: "Maximum completed confirmation-timeframe candles allowed to touch the zone before the trade trigger. A fourth touch is rejected when this is 3; lowering it demands fresher zones.", step: 1 },
  { key: "maxTouchRangeZoneFraction", label: "Touch range / zone", short: "TOUCH %", explanation: "Largest allowed first-touch candle range divided by zone width. 0.50 means the candle may span at most 50% of the zone; lowering it requires a tighter touch.", step: 0.05 },
  { key: "maxEntryDistanceZoneFraction", label: "Entry distance / zone", short: "ENTRY %", explanation: "Maximum entry distance beyond the proximal edge, divided by zone width. 0.50 means entry may be no farther than half a zone width; lowering it avoids chasing.", step: 0.05 },
  { key: "adverseApproachCandles", label: "Approach candles", short: "APP N", explanation: "Number of completed confirmation-timeframe candles used to measure the final move into the zone. Increasing it measures the approach over a longer window.", step: 1 },
  { key: "minimumFastApproachAtr", label: "Fast approach ATR", short: "APP ATR", explanation: "Minimum adverse displacement toward the zone, measured in prior ATRs, for the fast-approach warning. Higher values require a more extreme approach before rejection.", step: 0.1 },
  { key: "minimumFastTouchRangeAtr", label: "Fast touch ATR", short: "TOUCH ATR", explanation: "Minimum first-touch candle range in prior ATRs for the adverse-approach gate. Higher values require a larger touch candle before rejection.", step: 0.1 },
  { key: "shockRangeAtrMultiple", label: "Shock range ATR", short: "SHOCK ATR", explanation: "Departure candle range in prior ATRs needed for this warning. 3 means at least three ATRs. The zone is rejected when any two of SHOCK ATR, WICK %, and weak CLOSE X warnings match.", step: 0.1 },
  { key: "rejectionWickFraction", label: "Shock rejection wick", short: "WICK %", explanation: "Minimum adverse wick share of the departure candle range. 0.50 means at least half the candle is rejection wick; increasing it requires a more severe wick.", step: 0.05 },
  { key: "minimumShockCloseDepartureZoneMultiple", label: "Shock close-away", short: "CLOSE X", explanation: "Minimum close distance away from the zone, measured in zone widths, that avoids the weak-close shock rejection. 1 means the close must finish at least one zone width away.", step: 0.1 },
  { key: "departureStrengthZoneMultiple", label: "Departure strength", short: "DEP X", explanation: "Close-based departure distance, in zone widths, required for the departure-strength score point. 2 means price must close more than two zone widths away.", step: 0.1 },
];
const backtestGateFields: Array<{
  key: keyof GoldilocksBacktestGates;
  label: string;
  explanation: string;
}> = [
  { key: "weeklyMarketHours", label: "Weekly market hours", explanation: "When enabled, no new trade may enter from Friday 4 PM through Sunday 6 PM New York time. Disable only to research how weekend-edge signals would have behaved." },
  { key: "holiday", label: "Holiday", explanation: "When enabled, configured U.S. market holidays are skipped because liquidity and price behavior can be abnormal." },
  { key: "pairSession", label: "Pair session", explanation: "When enabled, at least one currency in the pair must be inside its normal local trading session. This avoids testing entries when both sides are quiet." },
  { key: "zoneFormationNews", label: "Formation news", explanation: "When enabled, a zone is discarded if high-impact news overlaps the base-to-departure formation window. This prevents news spikes from being treated like ordinary structure." },
  { key: "entryProximity", label: "Entry proximity", explanation: "When enabled, the first-touch candle must stay compact and the executable entry cannot be chased too far beyond the zone edge." },
  { key: "adverseApproach", label: "Adverse approach", explanation: "When enabled, a fast multi-ATR drive plus an oversized touch is rejected unless the touch closes back beyond the proximal edge, showing reclaim." },
  { key: "entryNews", label: "Entry news", explanation: "When enabled, entries inside the high-impact news block window for either currency are skipped." },
  { key: "twoToOneRunway", label: "2R runway", explanation: "When enabled, the path from entry to the exact 2R target must not cross the nearest active opposing zone. The target itself remains fixed at 2R either way." },
];
const scoreWeightFields: Array<{
  key: GoldilocksScoreCategory;
  label: string;
  explanation: string;
}> = [
  { key: "trend", label: "Trend alignment", explanation: "Rewards trades aligned with the protected trend. Raise it when direction should matter more; the other five categories automatically give up the same total points." },
  { key: "departure", label: "Departure quality", explanation: "Covers combined zone-timeframe formation compactness and capped sustained displacement." },
  { key: "approachWarnings", label: "Approach warnings", explanation: "Rewards clean pre-touch evidence. Zero warnings earns 5 points, one earns 3, and both earn none. The two confirmation-timeframe categories are a confirmed liquidity-pool sweep and a fast momentum approach. Compression is measured but does not deduct points." },
  { key: "purity", label: "Zone freshness", explanation: "Rewards zero prior touches. Exactly one prior touch automatically receives half of this category; two or more receive zero." },
  { key: "zoneInsideZone", label: "Zone inside zone", explanation: "Rewards same-side overlap across the timeframe stack. Two-of-three overlap automatically receives half of this category." },
];
const runSortOptions = [
  ["createdAt", "Run date"], ["label", "Run label"], ["pairs", "Pairs"],
  ["minimumScore", "Minimum score"], ["lookbackDays", "Lookback"],
  ["totalTrades", "Trades"], ["netR", "Net R"], ["expectancyR", "Expectancy"],
  ["profitFactor", "Profit factor"], ["averageWinR", "Average win"],
  ["averageLossR", "Average loss"], ["payoffRatio", "Payoff"],
  ["profitableRate", "Profitable rate"], ["breakEvenTrades", "Break-even trades"],
  ["maxDrawdownR", "Max drawdown (R)"], ["maxDrawdownPercent", "Max drawdown (%)"],
  ["startingBalance", "Starting balance"], ["endingBalance", "Ending balance"],
  ["netProfitLoss", "Net P/L"], ["accountReturn", "Return"],
  ["leverage", "Leverage"], ["risk", "Risk profile"], ["sampleTrades", "Sample size"],
] as const;
const normalizedSortValue = (value: unknown) => {
  if (value == null) return Number.NEGATIVE_INFINITY;
  if (value === "infinite") return Number.POSITIVE_INFINITY;
  if (typeof value === "number") return value;
  const date = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(date) ? String(value).toLowerCase() : date;
};
const compareValues = (left: unknown, right: unknown, direction: SortDirection) => {
  const a = normalizedSortValue(left);
  const b = normalizedSortValue(right);
  const result = typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), undefined, { numeric: true });
  return direction === "asc" ? result : -result;
};
const formatR = (value: number | null, signed = false) =>
  value == null
    ? "N/A"
    : `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}R`;
const formatFactor = (value: number | "infinite" | null) =>
  value === "infinite" || value === Number.POSITIVE_INFINITY
    ? "∞"
    : value == null
      ? "No P/L"
      : value.toFixed(2);
const formatPayoff = (value: number | null) =>
  value == null ? "N/A" : `${formatFactor(value)}:1`;

export default function Backtesting() {
  const dashboardRequestInFlight = useRef(false);
  const [data, setData] = useState<Dashboard | null>(null),
    [selected, setSelected] = useState<string[]>([...forexPairs]);
  const [label, setLabel] = useState(() =>
      getGoldilocksBacktestRunLabel("intraday"),
    ),
    [timeframeProfile, setTimeframeProfile] =
      useState<GoldilocksTimeframeProfileId>("intraday"),
    [minimumScore, setMinimumScore] = useState(14),
    [lookbackDays, setLookbackDays] = useState(730),
    [tradeManager, setTradeManager] = useState<GoldilocksBacktestManagerId>(
      GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,
    ),
    [strategyTweaks, setStrategyTweaks] = useState<GoldilocksBacktestTweaks>(
      () => normalizeGoldilocksBacktestTweaks(undefined),
    ),
    [gateSettings, setGateSettings] = useState<GoldilocksBacktestGates>(
      () => normalizeGoldilocksBacktestGates(undefined),
    ),
    [scoreWeights, setScoreWeights] = useState<GoldilocksScoreWeights>(
      () => normalizeGoldilocksScoreWeights(undefined),
    ),
    [busy, setBusy] = useState(false),
    [deletingId, setDeletingId] = useState(""),
    [clearingAll, setClearingAll] = useState(false),
    [error, setError] = useState("");
  const [startingBalance, setStartingBalance] = useState(1000),
    [leverage, setLeverage] = useState(30),
    [riskProfile, setProjectionRiskProfile] = useState<RiskProfile>("default");
  const [tradeIdQuery, setTradeIdQuery] = useState(""),
    [tradeSearchResult, setTradeSearchResult] = useState<Record<
      string,
      any
    > | null>(null),
    [tradeSearching, setTradeSearching] = useState(false);
  const [runSortKey, setRunSortKey] = useState("createdAt");
  const [runSortDirection, setRunSortDirection] =
    useState<SortDirection>("desc");
  const [tradeSortKey, setTradeSortKey] = useState("confirmationTime");
  const [tradeSortDirection, setTradeSortDirection] =
    useState<SortDirection>("desc");
  const load = useCallback(async (runId?: string) => {
    if (dashboardRequestInFlight.current) return;
    dashboardRequestInFlight.current = true;
    try {
      const r = await fetch(`/api/backtests${runId ? `?runId=${runId}` : ""}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setData(await r.json());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      dashboardRequestInFlight.current = false;
    }
  }, []);
  const selectSnapshot = (
    runId: string,
    config: Run["config"],
    snapshotLabel: string,
  ) => {
    setTradeIdQuery("");
    setTradeSearchResult(null);
    setSelected(Array.isArray(config.pairs) ? [...config.pairs] : []);
    setMinimumScore(config.minimumScore);
    setLookbackDays(config.lookbackDays);
    setTimeframeProfile(config.timeframeProfile ?? "intraday");
    setStartingBalance(config.startingBalance ?? 1000);
    setLeverage(config.leverage ?? 30);
    setProjectionRiskProfile(config.riskProfile ?? "default");
    setTradeManager(managerForRunConfig(config).id);
    setStrategyTweaks(normalizeGoldilocksBacktestTweaks(config.strategyTweaks));
    setGateSettings(normalizeGoldilocksBacktestGates(config.gateSettings));
    setScoreWeights(
      expandGoldilocksScoreCategoryWeights(
        getGoldilocksScoreCategoryWeights(config.scoreWeights),
      ),
    );
    setLabel(snapshotLabel);
    void load(runId);
  };
  const searchTrade = async (event: FormEvent) => {
    event.preventDefault();
    const tradeId = tradeIdQuery.trim().toUpperCase();
    if (!tradeId) return;
    setTradeSearching(true);
    try {
      const response = await fetch(
        `/api/backtests?tradeId=${encodeURIComponent(tradeId)}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setTradeSearchResult(body.trade);
      await load(String(body.trade.runId));
      setError("");
    } catch (searchError) {
      setTradeSearchResult(null);
      setError((searchError as Error).message);
    } finally {
      setTradeSearching(false);
    }
  };
  const clearTradeSearch = () => {
    setTradeIdQuery("");
    setTradeSearchResult(null);
    setError("");
  };
  const active =
    data?.runs.some(
      (run) => run.status === "running" || run.status === "queued",
    ) ?? false;
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!data?.selectedRunId) return;
    const id = setInterval(
      () => load(data.selectedRunId),
      active ? 2000 : 10000,
    );
    return () => clearInterval(id);
  }, [load, data?.selectedRunId, active]);
  const run = async () => {
    setBusy(true);
    setTradeIdQuery("");
    setTradeSearchResult(null);
    try {
      const r = await fetch("/api/backtests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairs: selected,
          label,
          minimumScore,
          lookbackDays,
          startingBalance,
          leverage,
          riskProfile,
          tradeManager,
          timeframeProfile,
          strategyTweaks,
          gateSettings,
          scoreWeights: expandGoldilocksScoreCategoryWeights(scoreCategories),
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setData((currentData) => {
        if (!currentData) return currentData;
        const optimisticRun: Run = {
          id: body.id,
          status: body.status,
          label: body.config.label,
          createdAt: new Date().toISOString(),
          progressDone: 0,
          progressTotal: body.config.pairs.length,
          progressStage: "queued",
          progressPercent: 0,
          heartbeatAt: new Date().toISOString(),
          totalTrades: 0,
          wins: 0,
          losses: 0,
          config: body.config,
        };
        const optimisticResult: RunResult = {
          ...optimisticRun,
          sampleTrades: 0,
          omittedTrades: 0,
          profitableTrades: 0,
          losingTrades: 0,
          breakEvenTrades: 0,
          profitableRate: 0,
          averageWinR: null,
          averageLossR: null,
          expectancyR: null,
          profitFactor: null,
          payoffRatio: null,
          netR: 0,
          maxDrawdownR: 0,
          longestLosingStreak: 0,
          endingBalance: body.config.startingBalance ?? 1000,
          netProfitLoss: 0,
          accountReturn: 0,
          maxDrawdownPercent: 0,
          peakMargin: 0,
          marginBlocked: 0,
          acceptedTrades: 0,
        };
        return {
          ...currentData,
          selectedRunId: body.id,
          runs: [
            optimisticRun,
            ...currentData.runs.filter((item) => item.id !== body.id),
          ],
          runResults: [
            optimisticResult,
            ...currentData.runResults.filter((item) => item.id !== body.id),
          ],
        };
      });
      window.setTimeout(() => void load(body.id), 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const current =
    data?.runs.find((item) => item.id === data.selectedRunId) ?? data?.runs[0];
  const runSortValue = useCallback((row: RunResult, key: string) => {
    if (key === "pairs") return row.config.pairs?.length ?? 0;
    if (key === "minimumScore") return row.config.minimumScore;
    if (key === "lookbackDays") return row.config.lookbackDays;
    if (key === "startingBalance") return row.config.startingBalance ?? 1000;
    if (key === "leverage") return row.config.leverage ?? 30;
    if (key === "risk") return row.config.riskProfile ?? "default";
    return (row as unknown as Record<string, unknown>)[key];
  }, []);
  const sortedRunResults = useMemo(
    () => [...(data?.runResults ?? [])].sort((left, right) =>
      compareValues(
        runSortValue(left, runSortKey),
        runSortValue(right, runSortKey),
        runSortDirection,
      )),
    [data?.runResults, runSortDirection, runSortKey, runSortValue],
  );
  const visibleTrades = useMemo(
    () =>
      tradeSearchResult?.tradeId
        ? (data?.trades ?? []).filter(
            (trade) => trade.tradeId === tradeSearchResult.tradeId,
          )
        : (data?.trades ?? []),
    [data?.trades, tradeSearchResult?.tradeId],
  );
  const tradeSortValue = useCallback((trade: TradeRow, key: string) => {
    return trade[key];
  }, []);
  const sortedTrades = useMemo(
    () => [...visibleTrades].sort((left, right) =>
      compareValues(
        tradeSortValue(left, tradeSortKey),
        tradeSortValue(right, tradeSortKey),
        tradeSortDirection,
      )),
    [tradeSortDirection, tradeSortKey, tradeSortValue, visibleTrades],
  );
  const sortTradesBy = (key: string) => {
    if (tradeSortKey === key) {
      setTradeSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    } else {
      setTradeSortKey(key);
      setTradeSortDirection("asc");
    }
  };
  const tradeSortMark = (key: string) =>
    tradeSortKey === key ? (tradeSortDirection === "asc" ? " ▲" : " ▼") : "";
  const cancel = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/backtests?runId=${current.id}`, {
        method: "DELETE",
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      await load(current.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const removeRun = async (runId: string, label: string) => {
    if (
      !window.confirm(
        `Permanently delete "${label}" and all of its recorded trades and logs? This cannot be undone.`,
      )
    )
      return;
    setDeletingId(runId);
    try {
      const r = await fetch(
        `/api/backtests?runId=${encodeURIComponent(runId)}&permanent=true`,
        { method: "DELETE" },
      );
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      await load(
        data?.selectedRunId === runId ? undefined : data?.selectedRunId,
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingId("");
    }
  };
  const clearAllBacktests = async () => {
    if (
      !window.confirm(
        "Permanently clear every backtest run, trade, and event? Historical news coverage will be preserved. This cannot be undone.",
      )
    )
      return;
    setClearingAll(true);
    try {
      const response = await fetch("/api/backtests?all=true&permanent=true", {
        method: "DELETE",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setTradeIdQuery("");
      setTradeSearchResult(null);
      await load();
      setError("");
    } catch (clearError) {
      setError((clearError as Error).message);
    } finally {
      setClearingAll(false);
    }
  };
  const reachRate = current?.totalTrades
    ? Math.round((current.wins / current.totalTrades) * 1000) / 10
    : 0;
  const running = current?.status === "running" || current?.status === "queued";
  const progress = Math.max(
    0,
    Math.min(100, Number(current?.progressPercent ?? 0)),
  );
  const projection = useMemo(
    () =>
      simulateBacktestPortfolio(
        (data?.trades ?? []).map((trade) => ({
          id: String(trade.id),
          pair: String(trade.pair),
          confirmationTime: Number(trade.confirmationTime),
          outcomeTime: Number(trade.outcomeTime),
          score: Number(trade.score),
          entry: Number(trade.entry),
          stopLoss: Number(trade.stopLoss),
          outcome: trade.outcome as "WIN" | "LOSS",
          realizedR: trade.realizedR == null ? null : Number(trade.realizedR),
          direction: trade.direction as "BUY" | "SELL",
          tradeId: String(trade.tradeId),
        })),
        {
          startingBalance,
          leverage,
          riskProfile,
          minimumScore: current?.config.minimumScore ?? 14,
        },
      ),
    [
      current?.config.minimumScore,
      data?.trades,
      leverage,
      riskProfile,
      startingBalance,
    ],
  );
  const projectedTradeResults = useMemo(
    () =>
      new Map(
        projection.trades.map(({ trade, realizedR, pnl }) => [
          String(trade.id),
          { realizedR, pnl },
        ]),
      ),
    [projection.trades],
  );
  const performance = useMemo(
    () =>
      calculateBacktestPerformance(
        (data?.trades ?? []).map((trade) => ({
          confirmationTime: Number(trade.confirmationTime),
          realizedR: trade.realizedR == null ? null : Number(trade.realizedR),
        })),
      ),
    [data?.trades],
  );
  const money = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  const timeframeLabel = (config: RunConfig) =>
    getGoldilocksTimeframeProfile(config.timeframeProfile).label;
  const replayStack = (config?: RunConfig) =>
    config?.timeframeProfile === "lowerTimeframe"
      ? "lowerTimeframe"
      : config?.timeframeProfile === "higherTimeframe"
        ? "multiDay"
        : "intraday";
  const replayTimeframe = (config?: RunConfig) =>
    getGoldilocksTimeframeProfile(config?.timeframeProfile).confirmation;
  const riskLabel = (config: RunConfig) =>
    RISK_PROFILES[config.riskProfile ?? "default"]?.label ??
    config.riskProfile ??
    "Default";
  const tweakSummary = (result: RunResult) =>
    [
      `Strategy: ${result.config.strategyVersion ?? result.label}`,
      `Timeframes: ${timeframeLabel(result.config)}`,
      `Minimum score: ${result.config.minimumScore}/20`,
      `Lookback: ${result.config.lookbackDays} days`,
      `Risk: ${riskLabel(result.config)}`,
      `Trade manager: ${managerForRunConfig(result.config).label}`,
      `Starting balance: ${money(result.config.startingBalance ?? 1000)}`,
      `Maximum leverage: ${result.config.leverage ?? 30}:1`,
      `Pairs (${result.config.pairs?.length ?? 0}): ${(result.config.pairs ?? []).join(", ")}`,
      result.config.protectedWinR == null
        ? null
        : `Protected-win R: ${result.config.protectedWinR}`,
      result.config.archiveOnly ? "Candle source: saved archive only" : null,
      ...backtestGateFields.map((field) => {
        const gates = normalizeGoldilocksBacktestGates(
          result.config.gateSettings,
        );
        return `${field.label}: ${gates[field.key] ? "enabled" : "disabled"}`;
      }),
      ...scoreWeightFields.map((field) => {
        const categories = getGoldilocksScoreCategoryWeights(
          result.config.scoreWeights,
        );
        return `${field.label}: ${categories[field.key].toFixed(2)} pts`;
      }),
      ...backtestTweakFields.map((field) => {
        const tweaks = normalizeGoldilocksBacktestTweaks(
          result.config.strategyTweaks,
        );
        return `${field.short}: ${tweaks[field.key]}`;
      }),
    ].filter((item): item is string => Boolean(item));
  const scoreCategories = useMemo(
    () => getGoldilocksScoreCategoryWeights(scoreWeights),
    [scoreWeights],
  );
  const scoreWeightsAreDefault = useMemo(() => {
    const defaults = getGoldilocksScoreCategoryWeights();
    return scoreWeightFields.every(
      (field) =>
        Math.abs(scoreCategories[field.key] - defaults[field.key]) < 1e-9,
    );
  }, [scoreCategories]);
  const updateScoreCategory = (
    key: GoldilocksScoreCategory,
    value: number,
  ) => {
    setScoreWeights((current) =>
      expandGoldilocksScoreCategoryWeights(
        rebalanceGoldilocksScoreCategories(
          getGoldilocksScoreCategoryWeights(current),
          key,
          value,
        ),
      ),
    );
  };
  return (
    <Page>
      <Hero>
        <Kicker>Goldilocks research arcade</Kicker>
        <Title>Backtest Candy Lab</Title>
        <Sub>
          Run H1 trend → M15 zones → M5 departure, touch, and later
          close-through confirmation. M1 is retained only for post-entry stop,
          +1R, and target ordering. Every run stores one final realized-R result
          and a permanent version snapshot.
        </Sub>
        <Controls>
          <Field>
            Run label
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field>
            Timeframe stack
            <select
              value={timeframeProfile}
              onChange={(e) => {
                const value = e.target.value as GoldilocksTimeframeProfileId;
                const profile = getGoldilocksTimeframeProfile(value);
                setTimeframeProfile(value);
                setLabel(getGoldilocksBacktestRunLabel(value));
                setLookbackDays(profile.defaultLookbackDays);
              }}
            >
              <option value="lowerTimeframe">M15 / M5 / M1</option>
              <option value="intraday">H1 / M15 / M5</option>
              <option value="higherTimeframe">D1 / H4 / H1</option>
            </select>
          </Field>
          <Field>
            Minimum score
            <select
              value={minimumScore}
              onChange={(e) => setMinimumScore(Number(e.target.value))}
            >
              {Array.from({ length: 21 }, (_, i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </Field>
          <Field>
            Lookback
            <select
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Number(e.target.value))}
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>1 year</option>
              <option value={730}>2 years</option>
              <option value={1825}>5 years</option>
              <option value={3650}>10 years</option>
            </select>
          </Field>
          <Field title={getGoldilocksBacktestManager(tradeManager).description}>
            Trade manager
            <select
              value={tradeManager}
              onChange={(event) =>
                setTradeManager(
                  event.target.value as GoldilocksBacktestManagerId,
                )
              }
            >
              {GOLDILOCKS_BACKTEST_MANAGERS.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.label}
                </option>
              ))}
            </select>
          </Field>
          {running ? (
            <CancelButton disabled={busy} onClick={cancel}>
              {busy ? "Stopping..." : "Cancel run"}
            </CancelButton>
          ) : (
            <Button disabled={busy || !selected.length || active} onClick={run}>
              {busy ? "Launching..." : "Run backtest"}
            </Button>
          )}
        </Controls>
        <RuleDisclosure>
          <summary>
            Show backtest rule controls · {backtestGateFields.length} gates ·{" "}
            {scoreWeightFields.length} weights · {backtestTweakFields.length} thresholds
          </summary>
          <div className="rule-body">
            <Sub style={{ fontSize: ".72rem", marginTop: 12 }}>
              These settings are saved with the run and affect only backtests.
            </Sub>
          <ConfigCategory>
            <h3>1. Hard gates</h3>
            <p>Enable or disable each backtest eligibility filter.</p>
            <TweakGrid>
              {backtestGateFields.map((field) => (
                <TweakField key={field.key} data-tooltip={field.explanation}>
                  <span>{gateSettings[field.key] ? "ENABLED" : "DISABLED"}</span>
                  {field.label}
                  <input
                    aria-label={field.label}
                    type="checkbox"
                    checked={gateSettings[field.key]}
                    onChange={(event) =>
                      setGateSettings((current) => ({
                        ...current,
                        [field.key]: event.target.checked,
                      }))
                    }
                  />
                </TweakField>
              ))}
            </TweakGrid>
          </ConfigCategory>
          <ConfigCategory>
            <h3>2. Score weights</h3>
            <p>
              Total: <strong>20.00 points</strong> · Move any slider and the
              other categories rebalance automatically.
            </p>
            <RestoreWeightsButton
              type="button"
              disabled={scoreWeightsAreDefault}
              onClick={() =>
                setScoreWeights(normalizeGoldilocksScoreWeights(undefined))
              }
            >
              Restore default weights
            </RestoreWeightsButton>
            <TweakGrid>
              {scoreWeightFields.map((field) => (
                <TweakField key={field.key} data-tooltip={field.explanation}>
                  <span>{field.label}</span>
                  {scoreCategories[field.key].toFixed(2)} points
                  <input
                    aria-label={`${field.label} score weight slider`}
                    type="range"
                    min="0"
                    max="20"
                    step="0.5"
                    value={scoreCategories[field.key]}
                    onChange={(event) =>
                      updateScoreCategory(field.key, Number(event.target.value))
                    }
                  />
                  <input
                    aria-label={`${field.label} score weight`}
                    type="number"
                    min="0"
                    max="20"
                    step="0.5"
                    value={Number(scoreCategories[field.key].toFixed(2))}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isFinite(value) || value < 0) return;
                      updateScoreCategory(field.key, value);
                    }}
                  />
                </TweakField>
              ))}
            </TweakGrid>
          </ConfigCategory>
          <ConfigCategory>
            <h3>3. Numeric thresholds</h3>
            <p>Percent keys use decimals: 0.50 = 50%.</p>
          <TweakGrid>
            {backtestTweakFields.map((field) => (
              <TweakField key={field.key} data-tooltip={field.explanation}>
                <span>
                  {field.short}
                </span>
                {field.label}
                <input
                  aria-label={field.label}
                  type="number"
                  min="0"
                  step={field.step}
                  value={strategyTweaks[field.key]}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value) || value < 0) return;
                    setStrategyTweaks((currentTweaks) => ({
                      ...currentTweaks,
                      [field.key]: value,
                    }));
                  }}
                />
              </TweakField>
            ))}
          </TweakGrid>
            </ConfigCategory>
          </div>
        </RuleDisclosure>
        <PairGrid>
          <Pair
            $on={selected.length === forexPairs.length}
            onClick={() =>
              setSelected(
                selected.length === forexPairs.length ? [] : [...forexPairs],
              )
            }
          >
            ALL PAIRS
          </Pair>
          {forexPairs.map((pair) => (
            <Pair
              key={pair}
              $on={selected.includes(pair)}
              onClick={() =>
                setSelected((items) =>
                  items.includes(pair)
                    ? items.filter((x) => x !== pair)
                    : [...items, pair],
                )
              }
            >
              {pair}
            </Pair>
          ))}
        </PairGrid>
        {error && <p style={{ color: "#ff7587" }}>{error}</p>}
      </Hero>
      {/* Automated discovery controls live exclusively on /research.
      <ResearchLab>
        <Head style={{padding:0,border:0}}>
          <div>
            <h2>24/7 auto research</h2>
            <span className="muted">One OANDA acquisition, then sealed SQLite-only trials · M15/M5/M1, H1/M15/M5, and D1/H4/H1 · scores 10-18 · 23 managers</span>
          </div>
          <ResearchActions>
            {!researchCampaign||['completed','cancelled','failed'].includes(researchCampaign.status)
              ?<Button disabled={researchBusy||active||!selected.length} onClick={()=>void researchAction('start')}>Start discovery</Button>
              :<>
                {researchCampaign.status==='paused'
                  ?<Button disabled={researchBusy} onClick={()=>void researchAction('resume')}>Resume</Button>
                  :<Button disabled={researchBusy} onClick={()=>void researchAction('pause')}>Pause</Button>}
                <CancelButton disabled={researchBusy} onClick={()=>void researchAction('stop')}>Stop</CancelButton>
              </>}
          </ResearchActions>
        </Head>
        <Grid>
          <Card><Label>Campaign</Label><Metric style={{fontSize:'1rem'}}>{researchCampaign?.status?.toUpperCase()??'READY'}</Metric></Card>
          <Card><Label>{researchCampaign?.status==='preparing'?'Data histories cached':'Trials complete'}</Label><Metric>{researchCampaign?.status==='preparing'?`${researchCampaign.preparationDone??0}/${researchCampaign.preparationTotal??0}`:researchCounts.completed??0}</Metric></Card>
          <Card><Label>Queued / failed</Label><Metric>{researchCounts.queued??0} / {researchCounts.failed??0}</Metric></Card>
          <Card><Label>Candle storage</Label><Metric style={{fontSize:'1.2rem'}}>{research?.archive?`${(research.archive.usedBytes/1024/1024/1024).toFixed(2)} / ${(research.archive.maxBytes/1024/1024/1024).toFixed(0)} GiB`:'—'}</Metric></Card>
        </Grid>
        <ResearchMeter><span style={{width:`${Math.min(100,research?.archive.percent??0)}%`}} /></ResearchMeter>
        {topResearchTrials.length>0&&<Table style={{marginTop:14,maxHeight:300}}><table><thead><tr><th>Configuration</th><th>Stack</th><th>Score</th><th>Trades</th><th>Expectancy</th><th>Profit factor</th><th>Max DD</th><th>Best manager</th></tr></thead><tbody>{topResearchTrials.map(trial=>{
          const metrics=trial.metrics?.official;
          const bestPolicy=trial.metrics?.policies?.[0];
          return <tr key={trial.id}><td><Link href={`/research/trials/${trial.id}`} style={{color:'#87eaff'}}>{trial.config.label}</Link></td><td>{getGoldilocksTimeframeProfile(trial.config.timeframeProfile).label}</td><td>{trial.config.minimumScore}/20</td><td>{metrics?.sampleTrades??0}</td><td>{formatR(metrics?.expectancyR??null,true)}</td><td>{formatFactor(metrics?.profitFactor??null)}</td><td>{formatR(metrics?.maxDrawdownR??null)}</td><td>{String(bestPolicy?.policyId??'—')}</td></tr>;
        })}</tbody></table></Table>}
        <MoneyNote>{topResearchTrials.length?'Only configurations with at least 100 trades are ranked. Click a configuration to inspect every frozen input, gate, score component, diagnostic, manager, pair result, and trade audit.':`${completedResearchTrials.length} completed configuration(s), but none has the 100-trade evidence required for ranking yet.`}</MoneyNote>
      </ResearchLab> */}
      <Grid>
        <Card>
          <Label>Trade signals</Label>
          <Metric>{current?.totalTrades ?? 0}</Metric>
        </Card>
        <Card>
          <Label>Expectancy / trade</Label>
          <Metric
            style={{
              color:
                performance.expectancyR == null
                  ? "#fff"
                  : performance.expectancyR >= 0
                    ? "#60f0a2"
                    : "#ff6678",
            }}
          >
            {formatR(performance.expectancyR, true)}
          </Metric>
        </Card>
        <Card>
          <Label>Profit factor</Label>
          <Metric
            style={{
              color:
                performance.profitFactor == null
                  ? "#fff"
                  : performance.profitFactor >= 1
                    ? "#60f0a2"
                    : "#ff6678",
            }}
          >
            {formatFactor(performance.profitFactor)}
          </Metric>
        </Card>
        <Card>
          <Label>Status</Label>
          <Metric
            style={{
              fontSize: "1.05rem",
              color:
                current?.status === "failed" || current?.status === "cancelled"
                  ? "#ff6678"
                  : "#eaa3ff",
            }}
          >
            {current?.status?.toUpperCase() ?? "READY"}
          </Metric>
          {running && (
            <>
              <div style={{ color: "#7d899b", fontSize: 12, marginTop: 8 }}>
                {current?.progressDone}/{current?.progressTotal} -{" "}
                {current?.progressPair ?? "preparing"}
                <br />
                {current?.progressStage ?? "working"} - {progress.toFixed(1)}%
                overall
              </div>
              <Progress>
                <span style={{ width: `${progress}%` }} />
              </Progress>
            </>
          )}
        </Card>
      </Grid>
      <EdgeLab>
        <Head style={{ padding: 0, border: 0 }}>
          <div>
            <h2>Math-first strategy edge</h2>
            <span className="muted">
              Realized R, not the win label, determines whether the setup has an
              edge
            </span>
          </div>
        </Head>
        <EdgeGrid>
          <Card>
            <Label>Profitable rate</Label>
            <Metric>{performance.profitableRate.toFixed(1)}%</Metric>
            <span className="muted">
              {performance.profitableTrades} positive-R trades
            </span>
          </Card>
          <Card>
            <Label>Average win / loss</Label>
            <Metric style={{ fontSize: "1.35rem" }}>
              {formatR(performance.averageWinR)} /{" "}
              {formatR(performance.averageLossR)}
            </Metric>
          </Card>
          <Card>
            <Label>Payoff ratio</Label>
            <Metric>{formatPayoff(performance.payoffRatio)}</Metric>
          </Card>
          <Card>
            <Label>Break-even win rate</Label>
            <Metric>
              {performance.breakEvenWinRate == null
                ? "N/A"
                : `${performance.breakEvenWinRate.toFixed(1)}%`}
            </Metric>
          </Card>
          <Card>
            <Label>Net realized R</Label>
            <Metric
              style={{ color: performance.netR >= 0 ? "#60f0a2" : "#ff6678" }}
            >
              {formatR(performance.netR, true)}
            </Metric>
          </Card>
          <Card>
            <Label>Max drawdown</Label>
            <Metric style={{ color: "#ffb65c" }}>
              {formatR(performance.maxDrawdownR)}
            </Metric>
          </Card>
          <Card>
            <Label>Longest loss streak</Label>
            <Metric>{performance.longestLosingStreak}</Metric>
          </Card>
          <Card>
            <Label>Profitable / flat exits</Label>
            <Metric style={{ fontSize: "1.35rem" }}>
              {current?.wins ?? 0} / {performance.breakEvenTrades}
            </Metric>
            <span className="muted">{reachRate.toFixed(1)}% reached +1R</span>
          </Card>
        </EdgeGrid>
        <EdgeNote>
          <strong>Read win rate as consistency, not as the objective.</strong>{" "}
          {current &&
          managerForRunConfig(current.config).id ===
            GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID
            ? " Under the previous manager, +1R protects at break-even; 2R exits fully below score 16 or starts the score-tiered runner."
            : " Under the default manager, reaching +1R banks half and a later break-even exit records +0.5R."}
          Rankings below use expectancy first.{" "}
          {performance.sampleTrades < 50
            ? `This run has only ${performance.sampleTrades} realized-R trades; treat it as an early signal until it reaches at least 50, ideally 100+.`
            : `${performance.sampleTrades} realized-R trades are included.`}
          {performance.omittedTrades
            ? ` ${performance.omittedTrades} legacy trade(s) without realized R are excluded from edge math.`
            : ""}
        </EdgeNote>
      </EdgeLab>
      <MoneyLab>
        <Head style={{ padding: 0, border: 0 }}>
          <div>
            <h2>Projected account money</h2>
            <span className="muted">
              Chronological equity, dynamic risk, and reserved-margin simulation
            </span>
          </div>
        </Head>
        <MoneyControls>
          <Field>
            Starting account (USD)
            <input
              type="number"
              min="1"
              step="100"
              value={startingBalance}
              onChange={(e) => setStartingBalance(Number(e.target.value))}
            />
          </Field>
          <Field>
            Dynamic risk profile
            <select
              value={riskProfile}
              onChange={(e) =>
                setProjectionRiskProfile(e.target.value as RiskProfile)
              }
            >
              {(Object.keys(RISK_PROFILES) as RiskProfile[]).map((profile) => (
                <option key={profile} value={profile}>
                  {RISK_PROFILES[profile].label} ·{" "}
                  {RISK_PROFILES[profile].minimumRisk}%–
                  {RISK_PROFILES[profile].maximumRisk}%
                </option>
              ))}
            </select>
          </Field>
          <Field>
            Maximum account leverage
            <select
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
            >
              <option value={10}>10:1</option>
              <option value={20}>20:1</option>
              <option value={30}>30:1</option>
              <option value={50}>50:1</option>
            </select>
          </Field>
        </MoneyControls>
        <MoneyGrid>
          <Card>
            <Label>Ending balance</Label>
            <Metric style={{ fontSize: "1.35rem" }}>
              {money(projection.ending)}
            </Metric>
          </Card>
          <Card>
            <Label>Net profit / loss</Label>
            <Metric
              style={{
                fontSize: "1.35rem",
                color: projection.net >= 0 ? "#60f0a2" : "#ff6678",
              }}
            >
              {money(projection.net)}
            </Metric>
          </Card>
          <Card>
            <Label>Account return</Label>
            <Metric
              style={{
                fontSize: "1.35rem",
                color: projection.returnPercent >= 0 ? "#60f0a2" : "#ff6678",
              }}
            >
              {projection.returnPercent.toFixed(2)}%
            </Metric>
          </Card>
          <Card>
            <Label>Max drawdown</Label>
            <Metric style={{ fontSize: "1.35rem", color: "#ffb65c" }}>
              {projection.maxDrawdown.toFixed(2)}%
            </Metric>
          </Card>
          <Card>
            <Label>Peak margin used</Label>
            <Metric style={{ fontSize: "1.35rem" }}>
              {money(projection.peakMargin)}
            </Metric>
          </Card>
          <Card>
            <Label>Margin-blocked trades</Label>
            <Metric
              style={{
                fontSize: "1.35rem",
                color: projection.marginBlocked ? "#ffb65c" : "#fff",
              }}
            >
              {projection.marginBlocked}
            </Metric>
          </Card>
        </MoneyGrid>
        <MoneyNote>
          Each trade contributes one final realized-R number to P/L. Positions
          reserve margin from entry until exit; if the requested score-sized
          position does not fit the remaining margin, that trade is rejected and
          contributes no profit or loss. Accepted {projection.acceptedTrades} of{" "}
          {data?.trades.length ?? 0} signals. The selected leverage is capped
          per OANDA US rules at 50:1 for major pairs and 20:1 for other pairs.
          Spread-only commission is generally included in the spread; exact
          historical spread and daily/triple-rollover financing remain excluded;
          simulated positions are force-closed before the Friday weekend cutoff.
        </MoneyNote>
      </MoneyLab>
      {Boolean(0) && current && (
        <Section>
          <Head>
            <div>
              <h2>Tweaks for this backtest run</h2>
              <span className="muted">
                Saved configuration for “{current.label}” · run {current.id}
              </span>
            </div>
          </Head>
          <Table>
            <table>
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Saved value for this run</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Strategy / tweak label</td>
                  <td>{current.label}</td>
                </tr>
                <tr>
                  <td>Strategy version</td>
                  <td>
                    {current.config.strategyVersion ?? "Legacy / not recorded"}
                  </td>
                </tr>
                <tr>
                  <td>Timeframe stack</td>
                  <td>{timeframeLabel(current.config)}</td>
                </tr>
                <tr>
                  <td>Minimum score</td>
                  <td>{current.config.minimumScore}/20</td>
                </tr>
                <tr>
                  <td>Lookback</td>
                  <td>{current.config.lookbackDays} days</td>
                </tr>
                <tr>
                  <td>Selected pairs</td>
                  <td>{current.config.pairs?.join(", ") || "None recorded"}</td>
                </tr>
                <tr>
                  <td>Starting account</td>
                  <td>{money(current.config.startingBalance ?? 1000)}</td>
                </tr>
                <tr>
                  <td>Dynamic risk profile</td>
                  <td>{riskLabel(current.config)}</td>
                </tr>
                <tr>
                  <td>Trade manager</td>
                  <td>
                    {managerForRunConfig(current.config).label}
                  </td>
                </tr>
                <tr>
                  <td>Maximum account leverage</td>
                  <td>{current.config.leverage ?? 30}:1</td>
                </tr>
                <tr>
                  <td>Protected-win R</td>
                  <td>{current.config.protectedWinR ?? "Default"}</td>
                </tr>
                <tr>
                  <td>Candle source</td>
                  <td>
                    {current.config.archiveOnly
                      ? "Saved archive only"
                      : "Archive with configured acquisition"}
                  </td>
                </tr>
              </tbody>
            </table>
          </Table>
        </Section>
      )}
      <Section>
        <Head>
          <div>
            <h2>Recorded trades</h2>
            <span className="muted">
              {tradeSearchResult
                ? "Showing only the matching trade"
                : `Trades from the selected backtest run${current ? ` · ${current.label}` : ""}`}
            </span>
          </div>
          <TradeSearch onSubmit={searchTrade}>
            <input
              aria-label="Search trade ID"
              placeholder="GL-EURUSD-YYYYMMDD-HHMM-XXXXXXXX"
              value={tradeIdQuery}
              onChange={(event) => {
                const value = event.target.value;
                setTradeIdQuery(value);
                if (!value.trim()) clearTradeSearch();
              }}
            />
            <button type="submit" disabled={tradeSearching}>
              {tradeSearching ? "Searching…" : "Find trade"}
            </button>
            {tradeIdQuery && (
              <button type="button" onClick={clearTradeSearch}>
                Clear
              </button>
            )}
          </TradeSearch>
        </Head>
        {tradeSearchResult && (
          <TradeSearchResult>
            Found <code>{tradeSearchResult.tradeId}</code> ·{" "}
            {tradeSearchResult.pair} {tradeSearchResult.direction} ·{" "}
            {new Date(
              Number(tradeSearchResult.confirmationTime) * 1000,
            ).toLocaleString()}{" "}
            · tweak “{tradeSearchResult.runLabel}”
          </TradeSearchResult>
        )}
        {tradeSearchResult && (
          <TradeSearchResult>
             <ReplayLink
               href={`/strategy-lab?pair=${encodeURIComponent(tradeSearchResult.pair)}&stack=${replayStack(tradeSearchResult.config)}&timeframe=${replayTimeframe(tradeSearchResult.config)}&tradeTime=${tradeSearchResult.confirmationTime}&exitTime=${tradeSearchResult.outcomeTime}&tradeId=${encodeURIComponent(tradeSearchResult.tradeId)}`}
               target="_blank"
               rel="noopener noreferrer"
             >
              View chart
            </ReplayLink>
          </TradeSearchResult>
        )}
        <Table>
          <table>
            <thead>
              <tr>
                <th>Chart</th>
                {[
                  ["tradeId", "Trade ID"], ["confirmationTime", "Time"],
                  ["pair", "Pair"], ["direction", "Side"],
                  ["score", "Score"], ["realizedR", "Total R"],
                ].map(([key, heading]) => (
                  <th key={key}>
                    <SortableHeading type="button" onClick={() => sortTradesBy(key)}>
                      {heading}{tradeSortMark(key)}
                    </SortableHeading>
                  </th>
                ))}
                <th>Result</th>
                <th>Projected net P/L</th>
              </tr>
            </thead>
            <tbody>
              {sortedTrades.map((t: TradeRow) => {
                const projected = projectedTradeResults.get(String(t.id));
                const displayedR = projected?.realizedR ?? Number(t.realizedR);
                const totalR =
                  t.realizedR == null
                    ? t.outcome === "WIN"
                      ? "Legacy"
                      : "-1.00R"
                    : `${Number(t.realizedR).toFixed(2)}R`;
                return (
                  <tr key={t.id} style={{background:tradeSearchResult?.tradeId===t.tradeId?"#12382e":""}}>
                    <td>
                       <ReplayLink
                         href={`/strategy-lab?pair=${encodeURIComponent(t.pair)}&stack=${replayStack(current?.config)}&timeframe=${replayTimeframe(current?.config)}&tradeTime=${t.confirmationTime}&exitTime=${t.outcomeTime}&tradeId=${encodeURIComponent(t.tradeId)}`}
                         target="_blank"
                         rel="noopener noreferrer"
                       >
                        View chart
                      </ReplayLink>
                    </td>
                    <td><TradeId>{t.tradeId}</TradeId></td>
                    <td>
                      {new Date(t.confirmationTime * 1000).toLocaleString()}
                    </td>
                    <td>{t.pair}</td>
                    <td>{t.direction}</td>
                    <td>{t.score}/20</td>
                    <td className={Number(t.realizedR) >= 0 ? "win" : "loss"}>
                      {totalR}
                    </td>
                    <td
                      className={
                        displayedR > 0
                          ? "win"
                          : displayedR < 0
                            ? "loss"
                            : "break-even"
                      }
                    >
                      {projected
                        ? displayedR > 0
                          ? "Won"
                          : displayedR < 0
                            ? "Loss"
                            : "Break-even"
                        : "Margin blocked"}
                    </td>
                    <td
                      className={
                        projected && projected.pnl >= 0 ? "win" : "loss"
                      }
                    >
                      {projected ? money(projected.pnl) : "Not accepted"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Table>
      </Section>
      <Section>
        <Head>
          <div>
            <h2>Backtest runs</h2>
            <span className="muted">
              One row per saved run · click a row to load its settings, account
              results, trades, chart links, and event log
            </span>
          </div>
          <SortControls>
            <select
              aria-label="Sort backtest runs by"
              value={runSortKey}
              onChange={(event) => setRunSortKey(event.target.value)}
            >
              {runSortOptions.map(([value, text]) => (
                <option key={value} value={value}>Sort by: {text}</option>
              ))}
            </select>
            <select
              aria-label="Backtest run sort direction"
              value={runSortDirection}
              onChange={(event) => setRunSortDirection(event.target.value as SortDirection)}
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          <ClearAllButton
            disabled={active || clearingAll}
            title={
              active
                ? "Cancel the active backtest first"
                : "Delete all backtest runs, trades, and events"
            }
            onClick={() => void clearAllBacktests()}
          >
            {clearingAll ? "Clearing…" : "Clear all backtest data"}
          </ClearAllButton>
          </SortControls>
        </Head>
        <LeaderboardTable>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Run</th>
                <th>Run date</th>
                <th>Pairs</th>
                <th>Min score</th>
                <th>Lookback</th>
                <th>Trades</th>
                <th>Net R</th>
                <th>Expectancy</th>
                <th>Profit factor</th>
                <th>Avg win</th>
                <th>Avg loss</th>
                <th>Payoff</th>
                <th>Profitable rate</th>
                <th>BE trades</th>
                <th>Max DD (R)</th>
                <th>Max DD (%)</th>
                <th>Starting</th>
                <th>Ending</th>
                <th>Net P/L</th>
                <th>Return</th>
                <th>Leverage</th>
                <th>Risk</th>
                <th>Sample</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedRunResults.map((row, index) => {
                const runPairs = row.config.pairs ?? [];
                const details = tweakSummary(row);
                return (
                  <tr
                    key={row.id}
                    onClick={() =>
                      selectSnapshot(row.id, row.config, row.label)
                    }
                    style={{
                      cursor: "pointer",
                      background:
                        row.id === data?.selectedRunId ? "#152c29" : "",
                    }}
                    title={`Load complete run: ${row.label}`}
                  >
                    <td>{index + 1}</td>
                    <td>
                      <PairCount
                        type="button"
                        aria-label={`View saved tweaks for ${row.label}`}
                      >
                        View tweaks
                        <PairTip>
                          <strong>Saved run configuration</strong>
                          {details.map((detail) => (
                            <span key={detail} className="list">
                              {detail}
                            </span>
                          ))}
                        </PairTip>
                      </PairCount>
                    </td>
                    <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                    <td>{runPairs.length}</td>
                    <td>{row.config.minimumScore}/20</td>
                    <td>{row.config.lookbackDays} days</td>
                    <td>{row.totalTrades}</td>
                    <td className={row.netR >= 0 ? "win" : "loss"}>
                      {formatR(row.netR, true)}
                    </td>
                    <td
                      className={(row.expectancyR ?? 0) >= 0 ? "win" : "loss"}
                    >
                      {formatR(row.expectancyR, true)}
                    </td>
                    <td
                      title={
                        row.profitFactor === "infinite"
                          ? "Gross profit exists with no losing R, so profit factor is infinite."
                          : row.profitFactor == null
                            ? "No positive or negative realized R exists yet, so profit factor cannot be calculated."
                            : "Gross winning R divided by gross losing R."
                      }
                    >
                      {formatFactor(row.profitFactor)}
                    </td>
                    <td className="win">{formatR(row.averageWinR)}</td>
                    <td className="loss">{formatR(row.averageLossR)}</td>
                    <td>{formatPayoff(row.payoffRatio)}</td>
                    <td>{row.profitableRate.toFixed(1)}%</td>
                    <td>{row.breakEvenTrades}</td>
                    <td className="loss">{formatR(row.maxDrawdownR)}</td>
                    <td className="loss">
                      {row.maxDrawdownPercent.toFixed(2)}%
                    </td>
                    <td>{money(row.config.startingBalance ?? 1000)}</td>
                    <td>{money(row.endingBalance)}</td>
                    <td className={row.netProfitLoss >= 0 ? "win" : "loss"}>
                      {money(row.netProfitLoss)}
                    </td>
                    <td className={row.accountReturn >= 0 ? "win" : "loss"}>
                      {row.accountReturn.toFixed(2)}%
                    </td>
                    <td>{row.config.leverage ?? 30}:1</td>
                    <td>{riskLabel(row.config)}</td>
                    <td
                      title={
                        row.sampleTrades < 50
                          ? "Early sample: below 50 realized-R trades"
                          : row.sampleTrades < 100
                            ? "Useful sample: continue toward 100+"
                            : "Stronger sample: 100+ realized-R trades"
                      }
                    >
                      {row.sampleTrades}{" "}
                      {row.sampleTrades < 50
                        ? "| EARLY"
                        : row.sampleTrades < 100
                          ? "| BUILDING"
                          : "| 100+"}
                    </td>
                    <td>
                      <DeleteButton
                        disabled={deletingId === row.id}
                        title="Delete this entire run and all of its trades"
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeRun(row.id, row.label);
                        }}
                      >
                        {deletingId === row.id ? "Deleting…" : "Delete run"}
                      </DeleteButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </LeaderboardTable>
      </Section>
      <Section>
        <Head>
          <h2>Backtest candylog</h2>
          <span className="muted">Newest steps first</span>
        </Head>
        <Feed>
          {data?.events.map((e) => (
            <Event key={e.id}>
              <span className="dot" />
              <span className="time">
                {new Date(e.createdAt).toLocaleTimeString()}
              </span>
              <span className="pair">{e.pair ?? "RUN"}</span>
              <span className="message">{e.message}</span>
            </Event>
          ))}
        </Feed>
      </Section>
    </Page>
  );
}
