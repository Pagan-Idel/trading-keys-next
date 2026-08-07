import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import {useRouter} from 'next/router';
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
  GOLDILOCKS_CONFIRMATION_MODES,
  rebalanceGoldilocksScoreCategories,
  expandGoldilocksScoreCategoryWeights,
  type GoldilocksBacktestGates,
  type GoldilocksBacktestTweaks,
  type GoldilocksConfirmationMode,
  type GoldilocksScoreWeights,
  type GoldilocksScoreCategory,
  type GoldilocksTimeframeProfileId,
} from "../utils/goldilocksConfig";
import { calculateBacktestPerformance } from "../utils/backtestAnalytics";
import {
  GOLDILOCKS_BACKTEST_MANAGERS,
  GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID,
  GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID,
  GOLDILOCKS_UNTOUCHED_STOP_RUNNER_MANAGEMENT_ID,
  GOLDILOCKS_ADAPTIVE_SCALE_OUT_MANAGEMENT_ID,
  getGoldilocksBacktestManager,
  getGoldilocksBacktestManagerForRun,
  type GoldilocksBacktestManagerId,
} from "../utils/goldilocksTradeManagement";
import {
  GOLDILOCKS_COMPARISON_START_TIME,
  GOLDILOCKS_COMPARISON_END_TIME,
  GOLDILOCKS_COMPARISON_WINDOW_LABEL,
} from "../utils/comparisonDataset";

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
  span {
    color: #dce7f5;
  }
  small {
    color: #77869a;
    font-size: 0.61rem;
    font-weight: 650;
    line-height: 1.4;
  }
  span[title] {
    cursor: help;
    text-decoration: underline dotted #647287;
    text-underline-offset: 3px;
  }
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
  &[data-tooltip] {
    cursor: help;
  }
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
  &:hover:not(:disabled) {
    background: #382043;
  }
  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
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
  summary:hover {
    background: #121925;
  }
  &[open] summary {
    border-bottom: 1px solid #293445;
  }
  .rule-body {
    padding: 0 14px 16px;
  }
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
const TradeHeadActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
`;
const ResetTradeSortButton = styled.button`
  border: 1px solid #3b4656;
  background: #151a22;
  color: #c8d1df;
  border-radius: 9px;
  padding: 8px 12px;
  font-size: 0.72rem;
  font-weight: 850;
  cursor: pointer;
  &:hover,
  &:focus-visible {
    border-color: #7dffd4;
    color: #7dffd4;
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
const CampaignSearchResult=styled(TradeSearchResult)`
  display:grid;gap:9px;
  .campaign-runs{display:flex;gap:7px;flex-wrap:wrap;}
  button{border:1px solid #48788a;background:#112735;color:#a8ecff;border-radius:8px;padding:7px 9px;font-weight:850;cursor:pointer;}
  button:disabled{opacity:.5;cursor:not-allowed;}
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
    min-width: 920px;
  }
  th {
    white-space: nowrap;
  }
`;
const RunConfigGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 9px;
  padding: 16px;
`;
const RunConfigItem = styled.div`
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid #293445;
  border-radius: 11px;
  background: #091019;
  color: #dce7f5;
  font-size: 0.72rem;
  font-weight: 750;
  line-height: 1.45;
  overflow-wrap: anywhere;
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

type RunConfig = {
  minimumScore: number;
  lookbackDays: number;
  pairs: string[];
  strategyVersion?: string;
  startingBalance?: number;
  leverage?: number;
  riskProfile?: RiskProfile;
  tradeManager?: GoldilocksBacktestManagerId;
  confirmationMode?: GoldilocksConfirmationMode;
  setAndForgetTargetR?: number;
  setAndForgetTargetMode?: "fixed-r" | "opposing-base";
  closeTradesBeforeWeekend?: boolean;
  reverseFinalSignal?: boolean;
  protectedWinR?: number;
  timeframeProfile?: GoldilocksTimeframeProfileId;
  strategyTweaks?: GoldilocksBacktestTweaks;
  gateSettings?: GoldilocksBacktestGates;
  scoreWeights?: GoldilocksScoreWeights;
  backfillPages?: number;
  archiveOnly?: boolean;
  datasetEndTime?: number;
  datasetStartTime?: number;
  datasetKey?: string;
};
type Run = {
  id: string;
  runUid?: string;
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
  marginBlockReasons?: Array<{ reason: string; count: number }>;
  acceptedTrades: number;
};
type Dashboard = {
  defaultConfig?: RunConfig|null;
  runs: Run[];
  runResults: RunResult[];
  selectedRunId: string;
  trades: Array<Record<string, any>>;
  pairs: Array<Record<string, any>>;
  pairResults: PairResult[];
  events: Array<Record<string, any>>;
  leaderboard: Array<{
    runUid: string;
    sourceRunId: string;
    label: string;
    completedAt: string;
    netR: number;
    config: RunConfig;
    metrics: {
      totalSignals: number;
      acceptedTrades: number;
      marginBlocked: number;
      expectancyR: number | null;
      profitFactor: number | "infinite" | null;
      netR: number;
      maxDrawdownR: number;
      accountReturn: number;
      endingBalance: number;
    };
  }>;
  campaignSearch?:CampaignSearch;
};
type CampaignSearch={
  kind:'manual-campaign'|'research-campaign'|'research-trial'|'research-run';
  id:string;label:string;status:string;matchedTrialId?:string;
  runs:Array<{trialId?:string;backtestRunId:string|null;runUid?:string|null;label:string;status:string}>;
};
type SortDirection = "asc" | "desc";
type ScoreComponent = { name: string; points: number; detail: string };
type TradeRow = Record<string, any> & {
  scoreDetail?: { components?: ScoreComponent[] };
};
const managerForRunConfig = (config: RunConfig) => {
  return getGoldilocksBacktestManagerForRun(
    config.tradeManager,
    config.strategyVersion,
  );
};
const backtestTweakFields: Array<{
  key: keyof GoldilocksBacktestTweaks;
  label: string;
  short: string;
  explanation: string;
  step: number;
  max: number;
}> = [
  {
    key: "maximumPriorTouches",
    label: "Zone validity · maximum prior touches",
    short: "3 TOUCHES",
    explanation:
      "Maximum completed confirmation-timeframe touch candles before the trade trigger. Three remains valid; the fourth invalidates the zone.",
    step: 1,
    max: 3,
  },
  {
    key: "maxEntryDistanceZoneFraction",
    label: "Entry proximity · executable distance",
    short: "50% OF ZONE",
    explanation:
      "The executable price may be no more than 50% of one zone width beyond the proximal edge. Historical backtests use the confirmation close because bid/ask history is unavailable.",
    step: 0.05,
    max: 1,
  },
];
const backtestGateFields: Array<{
  key: keyof GoldilocksBacktestGates;
  label: string;
  value: string;
  explanation: string;
}> = [
  {
    key: "weeklyMarketHours",
    label: "Weekly market hours",
    value: "Friday 16:00 → Sunday 18:00 New York blocked",
    explanation:
      "Matches the chart audit's weekly market-hours gate and prevents entries around the weekly close and reopen.",
  },
  {
    key: "holiday",
    label: "Historical holiday",
    value: "Configured holiday windows blocked",
    explanation: "Matches the chart audit's historical-holiday gate.",
  },
  {
    key: "pairSession",
    label: "Historical pair session",
    value: "At least one pair currency session active",
    explanation: "Matches the chart audit's historical pair-session gate.",
  },
  {
    key: "zoneFormationNews",
    label: "Zone formation news",
    value: "High-impact news cannot overlap base through departure",
    explanation:
      "Missing historical coverage fails closed. This is separate from the entry-time news gate.",
  },
  {
    key: "entryProximity",
    label: "Entry proximity",
    value: "Executable distance ≤ 50% of zone",
    explanation:
      "Touch-candle size is diagnostic only. This hard gate checks the modeled executable entry; the final runway gate separately requires the configured target from that entry.",
  },
  {
    key: "entryNews",
    label: "Historical news",
    value: "Either currency blocked around high-impact news",
    explanation:
      "Matches the chart audit's historical-news gate; missing coverage fails closed.",
  },
  {
    key: "twoToOneRunway",
    label: "2:1 runway",
    value: "Clear path from entry to the exact 2R target",
    explanation:
      "Matches the chart audit's 2:1-runway gate and checks the nearest active opposing zone.",
  },
];
const scoreWeightFields: Array<{
  key: GoldilocksScoreCategory;
  label: string;
  explanation: string;
}> = [
  {
    key: "trend",
    label: "Trend-timeframe alignment · default 3",
    explanation:
      "Rewards agreement between trade direction and protected structure at trade time. The other four categories rebalance when this research weight changes.",
  },
  {
    key: "departure",
    label: "Zone-timeframe departure quality · default 4",
    explanation:
      "Three points cover total formation compactness; one point covers sustained close displacement away from the zone.",
  },
  {
    key: "approachWarnings",
    label: "Confirmation-timeframe approach warnings · default 5",
    explanation:
      "Zero warnings earns 5 points, one earns 3, and both earn 0. The categories are a confirmed liquidity-pool sweep and a fast momentum approach. Compression is not penalized.",
  },
  {
    key: "purity",
    label: "Confirmation-timeframe zone purity · default 4",
    explanation:
      "Zero prior touch candles earns 4 points, exactly one earns 2, and two or more earn 0.",
  },
  {
    key: "zoneInsideZone",
    label: "Multi-timeframe zone confluence (ZIZ) · default 4",
    explanation: "ZIZ 1/3 earns 0, ZIZ 2/3 earns 2, and ZIZ 3/3 earns 4.",
  },
];
const runSortOptions = [
  ["createdAt", "Campaign date"],
  ["label", "Campaign label"],
  ["minimumScore", "Minimum score"],
  ["totalTrades", "Signals"],
  ["acceptedTrades", "Portfolio admitted"],
  ["netR", "Net R"],
  ["expectancyR", "Expectancy"],
  ["profitFactor", "Profit factor"],
  ["maxDrawdownR", "Max drawdown"],
  ["accountReturn", "Account return"],
] as const;
const normalizedSortValue = (value: unknown) => {
  if (value == null) return Number.NEGATIVE_INFINITY;
  if (value === "infinite") return Number.POSITIVE_INFINITY;
  if (typeof value === "number") return value;
  const date = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(date) ? String(value).toLowerCase() : date;
};
const compareValues = (
  left: unknown,
  right: unknown,
  direction: SortDirection,
) => {
  const a = normalizedSortValue(left);
  const b = normalizedSortValue(right);
  const result =
    typeof a === "number" && typeof b === "number"
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
  const router=useRouter();
  const dashboardRequestInFlight = useRef(false);
  const leaderDefaultsApplied = useRef(false);
  const [data, setData] = useState<Dashboard | null>(null),
    [selected, setSelected] = useState<string[]>([...forexPairs]);
  const [label, setLabel] = useState(() =>
      getGoldilocksBacktestRunLabel("intraday"),
    ),
    [timeframeProfile, setTimeframeProfile] =
      useState<GoldilocksTimeframeProfileId>("intraday"),
    [minimumScore, setMinimumScore] = useState(14),
    [tradeManager, setTradeManager] = useState<GoldilocksBacktestManagerId>(
      GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID,
    ),
    [confirmationMode, setConfirmationMode] =
      useState<GoldilocksConfirmationMode>("close-through"),
    [setAndForgetTargetR, setSetAndForgetTargetR] = useState(2),
    [setAndForgetTargetMode, setSetAndForgetTargetMode] = useState<
      "fixed-r" | "opposing-base"
    >("opposing-base"),
    [closeTradesBeforeWeekend, setCloseTradesBeforeWeekend] = useState(true),
    [reverseFinalSignal, setReverseFinalSignal] = useState(false),
    [strategyTweaks, setStrategyTweaks] = useState<GoldilocksBacktestTweaks>(
      () => normalizeGoldilocksBacktestTweaks(undefined),
    ),
    [gateSettings, setGateSettings] = useState<GoldilocksBacktestGates>(() =>
      normalizeGoldilocksBacktestGates(undefined),
    ),
    [scoreWeights, setScoreWeights] = useState<GoldilocksScoreWeights>(() =>
      normalizeGoldilocksScoreWeights(undefined),
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
  const [tradeSortKey, setTradeSortKey] = useState("recordedOrder");
  const [tradeSortDirection, setTradeSortDirection] =
    useState<SortDirection>("desc");
  const [runUidQuery, setRunUidQuery] = useState("");
  const [campaignSearchResult,setCampaignSearchResult]=useState<CampaignSearch|null>(null);
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
    setTimeframeProfile(config.timeframeProfile ?? "intraday");
    setStartingBalance(config.startingBalance ?? 1000);
    setLeverage(config.leverage ?? 30);
    setProjectionRiskProfile(config.riskProfile ?? "default");
    setTradeManager(managerForRunConfig(config).id);
    setConfirmationMode(config.confirmationMode ?? "close-through");
    setSetAndForgetTargetR(config.setAndForgetTargetR ?? 2);
    setSetAndForgetTargetMode(
      config.setAndForgetTargetMode === "opposing-base"
        ? "opposing-base"
        : "fixed-r",
    );
    setCloseTradesBeforeWeekend(config.closeTradesBeforeWeekend !== false);
    setReverseFinalSignal(Boolean(config.reverseFinalSignal));
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
  const searchCampaign = useCallback(async (queryInput?:string) => {
    const query=(queryInput??runUidQuery).trim();
    if (!query) return;
    try {
      const response = await fetch(
        `/api/backtests?campaignId=${encodeURIComponent(query)}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setCampaignSearchResult(body.campaignSearch??null);
      setData(body);
      setError("");
    } catch (searchError) {
      setCampaignSearchResult(null);
      setError((searchError as Error).message);
    }
  },[runUidQuery]);
  const searchCampaignSubmit=(event:FormEvent)=>{event.preventDefault();void searchCampaign()};
  const active =
    data?.runs.some(
      (run) => run.status === "running" || run.status === "queued",
    ) ?? false;
  const lastRouteQuery=useRef('');
  useEffect(() => {
    if(!router.isReady)return;
    const campaignId=typeof router.query.campaignId==='string'?router.query.campaignId:'';
    const runId=typeof router.query.runId==='string'?router.query.runId:'';
    const routeQuery=campaignId?`campaign:${campaignId}`:runId?`run:${runId}`:'dashboard';
    if(lastRouteQuery.current===routeQuery)return;
    lastRouteQuery.current=routeQuery;
    if(campaignId){setRunUidQuery(campaignId);void searchCampaign(campaignId);return;}
    void load(runId||undefined);
  }, [load,router.isReady,router.query.campaignId,router.query.runId,searchCampaign]);
  useEffect(()=>{
    const config=data?.defaultConfig;
    if(!config||leaderDefaultsApplied.current)return;
    leaderDefaultsApplied.current=true;
    setSelected(Array.isArray(config.pairs)?[...config.pairs]:[...forexPairs]);
    setMinimumScore(config.minimumScore);
    setTimeframeProfile(config.timeframeProfile??'intraday');
    setStartingBalance(config.startingBalance??1000);
    setLeverage(config.leverage??30);
    setProjectionRiskProfile(config.riskProfile??'default');
    setTradeManager(managerForRunConfig(config).id);
    setConfirmationMode(config.confirmationMode??'close-through');
    setSetAndForgetTargetR(config.setAndForgetTargetR??2);
    setSetAndForgetTargetMode(config.setAndForgetTargetMode==='opposing-base'?'opposing-base':'fixed-r');
    setCloseTradesBeforeWeekend(config.closeTradesBeforeWeekend!==false);
    setReverseFinalSignal(Boolean(config.reverseFinalSignal));
    setStrategyTweaks(normalizeGoldilocksBacktestTweaks(config.strategyTweaks));
    setGateSettings(normalizeGoldilocksBacktestGates(config.gateSettings));
    setScoreWeights(expandGoldilocksScoreCategoryWeights(getGoldilocksScoreCategoryWeights(config.scoreWeights)));
    setLabel(getGoldilocksBacktestRunLabel(config.timeframeProfile??'intraday'));
  },[data?.defaultConfig]);
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
          label: label.trim() || undefined,
          minimumScore,
          startingBalance,
          leverage,
          riskProfile,
          tradeManager,
          confirmationMode,
          setAndForgetTargetR:
            tradeManager === GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID
              ? setAndForgetTargetR
              : undefined,
          setAndForgetTargetMode:
            tradeManager === GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID
              ? setAndForgetTargetMode
              : undefined,
          closeTradesBeforeWeekend,
          reverseFinalSignal,
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
          runUid:body.runUid,
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
    () =>
      [...(data?.runResults ?? [])].sort((left, right) =>
        compareValues(
          runSortValue(left, runSortKey),
          runSortValue(right, runSortKey),
          runSortDirection,
        ),
      ),
    [data?.runResults, runSortDirection, runSortKey, runSortValue],
  );
  const sortTradesBy = (key: string) => {
    if (tradeSortKey === key) {
      setTradeSortDirection((direction) =>
        direction === "asc" ? "desc" : "asc",
      );
    } else {
      setTradeSortKey(key);
      setTradeSortDirection("asc");
    }
  };
  const tradeSortMark = (key: string) =>
    tradeSortKey === key ? (tradeSortDirection === "asc" ? " ▲" : " ▼") : "";
  const resetTradeSort = () => {
    setTradeSortKey("recordedOrder");
    setTradeSortDirection("desc");
  };
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
        "Permanently clear every campaign run, trade, and event? Historical news coverage will be preserved. This cannot be undone.",
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
  const blockedTradeResults = useMemo(
    () =>
      new Map(
        projection.blockedTrades.map((blocked) => [
          String(blocked.trade.id),
          blocked,
        ]),
      ),
    [projection.blockedTrades],
  );
  const marginBlockSummary = useMemo(
    () =>
      Object.entries(
        projection.blockedTrades.reduce<Record<string, number>>(
          (counts, blocked) => {
            counts[blocked.reason] = (counts[blocked.reason] ?? 0) + 1;
            return counts;
          },
          {},
        ),
      )
        .map(([reason, count]) => ({ reason, count }))
        .sort((left, right) => right.count - left.count),
    [projection.blockedTrades],
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
  const tradeSortValue = useCallback(
    (trade: TradeRow, key: string) => {
      const projected = projectedTradeResults.get(String(trade.id));
      if (key === "recordedOrder") return Number(trade.id);
      if (key === "result")
        return projected
          ? projected.realizedR > 0
            ? 1
            : projected.realizedR < 0
              ? -1
              : 0
          : Number.NEGATIVE_INFINITY;
      if (key === "projectedPnl")
        return projected?.pnl ?? Number.NEGATIVE_INFINITY;
      return trade[key];
    },
    [projectedTradeResults],
  );
  const sortedTrades = useMemo(
    () =>
      [...visibleTrades].sort((left, right) => {
        const selectedComparison = compareValues(
          tradeSortValue(left, tradeSortKey),
          tradeSortValue(right, tradeSortKey),
          tradeSortDirection,
        );
        return (
          selectedComparison ||
          compareValues(Number(left.id), Number(right.id), "desc")
        );
      }),
    [tradeSortDirection, tradeSortKey, tradeSortValue, visibleTrades],
  );
  const performance = useMemo(
    () =>
      calculateBacktestPerformance(
        projection.trades.map(({ trade, realizedR }) => ({
          confirmationTime: Number(trade.confirmationTime),
          realizedR,
        })),
      ),
    [projection.trades],
  );
  const acceptedReachedOneR = projection.trades.filter(
    ({ trade }) => trade.outcome === "WIN",
  ).length;
  const reachRate = projection.acceptedTrades
    ? Math.round((acceptedReachedOneR / projection.acceptedTrades) * 1000) / 10
    : 0;
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
  const tweakSummary = (result: Run) =>
    [
      `Strategy: ${result.config.strategyVersion ?? result.label}`,
      `Timeframes: ${timeframeLabel(result.config)}`,
      `Minimum score: ${result.config.minimumScore}/20`,
      result.config.datasetStartTime===GOLDILOCKS_COMPARISON_START_TIME&&result.config.datasetEndTime===GOLDILOCKS_COMPARISON_END_TIME
        ?`Comparison data: ${GOLDILOCKS_COMPARISON_WINDOW_LABEL}`
        :`Legacy data window: ${result.config.lookbackDays} days ending ${result.config.datasetEndTime?new Date(result.config.datasetEndTime*1000).toISOString():'at its run time'}`,
      `Risk: ${riskLabel(result.config)}`,
      `Trade manager: ${managerForRunConfig(result.config).label}`,
      `YOLO reverse final signal: ${result.config.reverseFinalSignal ? "enabled" : "disabled"}`,
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
  const updateScoreCategory = (key: GoldilocksScoreCategory, value: number) => {
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
        <Kicker>Campaign builder + evidence viewer</Kicker>
        <Title>Campaign Backtester</Title>
        <Sub>
          Run H1 trend → M15 zones → M5 departure, touch, and later
          close-through confirmation. M1 is retained only for post-entry stop,
          +1R, and target ordering. Every campaign run stores one final realized-R result
          and a permanent version snapshot against the same fixed 2025 UTC candles.
        </Sub>
        <Controls>
          <Field>
            Campaign label
            <input
              value={label}
              placeholder={getGoldilocksBacktestRunLabel(timeframeProfile)}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => {
                if (!label.trim())
                  setLabel(getGoldilocksBacktestRunLabel(timeframeProfile));
              }}
            />
          </Field>
          <Field>
            Timeframe stack
            <select
              value={timeframeProfile}
              onChange={(e) => {
                const value = e.target.value as GoldilocksTimeframeProfileId;
                setTimeframeProfile(value);
                setLabel(getGoldilocksBacktestRunLabel(value));
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
          <Field
            title={
              confirmationMode === "touch-entry"
                ? GOLDILOCKS_CONFIRMATION_MODES.touchEntry.description
                : GOLDILOCKS_CONFIRMATION_MODES.closeThrough.description
            }
          >
            Entry confirmation
            <select
              aria-label="Entry confirmation"
              value={confirmationMode}
              onChange={(event) =>
                setConfirmationMode(
                  event.target.value as GoldilocksConfirmationMode,
                )
              }
            >
              <option value="close-through">
                First touch + engulf confirmation
              </option>
              <option value="touch-entry">Immediate first-touch entry</option>
            </select>
          </Field>
          <Field title="Every new manual and Research campaign uses the identical immutable UTC candle window. This is not configurable.">
            Comparison data
            <input aria-label="Comparison data window" value="2025 UTC · fixed" readOnly />
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
          {tradeManager === GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID && (
            <Field title="Choose a fixed RR target or exit at the first touch of the causally available opposing base. This applies only to Set and forget.">
              Target
              <select
                aria-label="Set and forget target"
                value={
                  setAndForgetTargetMode === "opposing-base"
                    ? "opposing-base"
                    : String(setAndForgetTargetR)
                }
                onChange={(event) => {
                  if (event.target.value === "opposing-base") {
                    setSetAndForgetTargetMode("opposing-base");
                    return;
                  }
                  setSetAndForgetTargetMode("fixed-r");
                  setSetAndForgetTargetR(Number(event.target.value));
                }}
              >
                {Array.from({ length: 77 }, (_, index) => 1 + index * 0.25).map(
                  (targetR) => (
                    <option key={targetR} value={targetR}>
                      1:{targetR} ({targetR}R)
                    </option>
                  ),
                )}
                <option value="opposing-base">
                  Touch of opposing base (automatic)
                </option>
              </select>
            </Field>
          )}
          <Field title="Backtest only: after the normal signal qualifies, execute the opposite side with mirrored risk and a fresh reversed 2R runway check.">
            YOLO reverse final signal
            <input
              aria-label="YOLO reverse final signal"
              type="checkbox"
              checked={reverseFinalSignal}
              onChange={(event) => setReverseFinalSignal(event.target.checked)}
            />
          </Field>
          <Field title="Backtest only. When disabled, simulated trades may remain open across the weekend. Live/demo Friday liquidation is unchanged.">
            Close trades before weekend
            <input
              aria-label="Close trades before weekend"
              type="checkbox"
              checked={closeTradesBeforeWeekend}
              onChange={(event) =>
                setCloseTradesBeforeWeekend(event.target.checked)
              }
            />
          </Field>
          {running ? (
            <CancelButton disabled={busy} onClick={cancel}>
              {busy ? "Stopping..." : "Cancel campaign"}
            </CancelButton>
          ) : (
            <Button disabled={busy || !selected.length || active} onClick={run}>
              {busy ? "Launching..." : "Run campaign"}
            </Button>
          )}
        </Controls>
        <RuleDisclosure>
          <summary>
            Show backtest rule controls · {backtestGateFields.length} gates ·{" "}
            {scoreWeightFields.length} weights · {backtestTweakFields.length}{" "}
            thresholds
          </summary>
          <div className="rule-body">
            <Sub style={{ fontSize: ".72rem", marginTop: 12 }}>
              These settings are saved with the campaign run and affect only historical simulation.
            </Sub>
            <ConfigCategory>
              <h3>1. Hard gates</h3>
              <p>
                The names and values below match the chart audit.
                Liquidity-sweep and fast-approach evidence belong to the
                five-point warning score; they are not separate hard gates.
              </p>
              <TweakGrid>
                {backtestGateFields.map((field) => (
                  <TweakField key={field.key} data-tooltip={field.explanation}>
                    <span>{field.label}</span>
                    {gateSettings[field.key] ? "ENABLED" : "DISABLED"}
                    <small>{field.value}</small>
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
                These initialize to the chart&apos;s official 3 + 4 + 5 + 4 + 4
                distribution. Total: <strong>20.00 points</strong>. Move any
                slider and the other categories rebalance automatically.
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
                        updateScoreCategory(
                          field.key,
                          Number(event.target.value),
                        )
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
              <p>
                Only thresholds consumed by the current contract are shown.
                Decimal zone fractions use 0.50 = 50%.
              </p>
              <TweakGrid>
                {backtestTweakFields.map((field) => (
                  <TweakField key={field.key} data-tooltip={field.explanation}>
                    <span>{field.short}</span>
                    {field.label}
                    <small>{field.explanation}</small>
                    <input
                      aria-label={field.label}
                      type="number"
                      min="0"
                      max={field.max}
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
              {performance.profitableTrades} / {performance.breakEvenTrades}
            </Metric>
            <span className="muted">{reachRate.toFixed(1)}% reached +1R</span>
          </Card>
        </EdgeGrid>
        <EdgeNote>
          <strong>Read win rate as consistency, not as the objective.</strong>{" "}
          {current &&
          managerForRunConfig(current.config).id ===
            GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID
            ? " Under the break-even strategy, +1R moves the stop to entry; 2R exits fully below score 16 or starts the score-tiered runner."
            : current &&
                managerForRunConfig(current.config).id ===
                  GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID
              ? current.config.setAndForgetTargetMode === "opposing-base"
                ? " Under set and forget, the original stop remains untouched and the full position targets first touch of the opposing base, except for the mandatory Friday close."
                : ` Under set and forget, the original stop and full ${current.config.setAndForgetTargetR ?? 2}R target remain untouched until either is hit, except for the mandatory Friday close.`
              : current &&
                  managerForRunConfig(current.config).id ===
                    GOLDILOCKS_UNTOUCHED_STOP_RUNNER_MANAGEMENT_ID
                ? " Under the untouched-stop runner, +1R banks half while the remaining half keeps the original stop and has no fixed upside target."
                : current &&
                    managerForRunConfig(current.config).id ===
                      GOLDILOCKS_ADAPTIVE_SCALE_OUT_MANAGEMENT_ID
                  ? " Under adaptive scale-out, fast 0.5R attacks bank 25% and slower attacks bank up to 50% at +1R, +2R, and +3R; a final 25% runner keeps the original stop."
                  : " Under the default manager, reaching +1R banks half and a later break-even exit records +0.5R."}
          Rankings below use expectancy first.{" "}
          {performance.sampleTrades < 50
            ? `This run has only ${performance.sampleTrades} realized-R trades; treat it as an early signal until it reaches at least 50, ideally 100+.`
            : `${performance.sampleTrades} realized-R trades are included.`}
          {performance.omittedTrades
            ? ` ${performance.omittedTrades} legacy trade(s) without realized R are excluded from edge math.`
            : ""}
          {projection.marginBlocked
            ? ` ${projection.marginBlocked} margin-blocked signal(s) were not executed and are excluded from every strategy-edge metric above.`
            : ""}
          {marginBlockSummary.length
            ? ` Main cause: ${marginBlockSummary[0].count} × ${marginBlockSummary[0].reason}`
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
            <Label>Portfolio-capacity blocked</Label>
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
          reserve margin and stop risk from entry until exit. A signal is
          capacity-blocked if admitting it would leave less than 50% of NAV in
          available-margin headroom, raise projected closeout utilization above
          25%, or raise combined open stop risk above 2% of NAV. It contributes
          no profit or loss and is not treated as a bad setup. Accepted{" "}
          {projection.acceptedTrades} of {data?.trades.length ?? 0} signals. The
          selected leverage is capped per OANDA US rules at 50:1 for major pairs
          and 20:1 for other pairs. Spread-only commission is generally included
          in the spread; exact historical spread and daily/triple-rollover
          financing remain excluded;
          {closeTradesBeforeWeekend
            ? " simulated positions are force-closed before the Friday weekend cutoff."
            : " weekend holding is enabled for this backtest, while live/demo Friday liquidation remains unchanged."}
        </MoneyNote>
      </MoneyLab>
      <Section>
        <Head>
          <div>
            <h2>Recorded trades</h2>
            <span className="muted">
              {tradeSearchResult
                ? "Showing only the matching trade"
                : `Trades from the selected campaign run${current ? ` · ${current.label}` : ""}`}
            </span>
          </div>
          <TradeHeadActions>
            <ResetTradeSortButton type="button" onClick={resetTradeSort}>
              Reset sort · newest recorded first
            </ResetTradeSortButton>
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
          </TradeHeadActions>
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
                  ["tradeId", "Trade ID"],
                  ["confirmationTime", "Time"],
                  ["pair", "Pair"],
                  ["direction", "Side"],
                  ["score", "Score"],
                  ["realizedR", "Signal R"],
                ].map(([key, heading]) => (
                  <th key={key}>
                    <SortableHeading
                      type="button"
                      onClick={() => sortTradesBy(key)}
                    >
                      {heading}
                      {tradeSortMark(key)}
                    </SortableHeading>
                  </th>
                ))}
                <th>
                  <SortableHeading
                    type="button"
                    onClick={() => sortTradesBy("result")}
                  >
                    Result{tradeSortMark("result")}
                  </SortableHeading>
                </th>
                <th>
                  <SortableHeading
                    type="button"
                    onClick={() => sortTradesBy("projectedPnl")}
                  >
                    Projected net P/L{tradeSortMark("projectedPnl")}
                  </SortableHeading>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedTrades.map((t: TradeRow) => {
                const projected = projectedTradeResults.get(String(t.id));
                const blocked = blockedTradeResults.get(String(t.id));
                const displayedR = projected?.realizedR ?? Number(t.realizedR);
                const totalR =
                  t.realizedR == null
                    ? t.outcome === "WIN"
                      ? "Legacy"
                      : "-1.00R"
                    : `${Number(t.realizedR).toFixed(2)}R`;
                return (
                  <tr
                    key={t.id}
                    style={{
                      background:
                        tradeSearchResult?.tradeId === t.tradeId
                          ? "#12382e"
                          : "",
                    }}
                  >
                    <td>
                      <ReplayLink
                        href={`/strategy-lab?pair=${encodeURIComponent(t.pair)}&stack=${replayStack(current?.config)}&timeframe=${replayTimeframe(current?.config)}&tradeTime=${t.confirmationTime}&exitTime=${t.outcomeTime}&tradeId=${encodeURIComponent(t.tradeId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View chart
                      </ReplayLink>
                    </td>
                    <td>
                      <TradeId>{t.tradeId}</TradeId>
                    </td>
                    <td>
                      {new Date(t.confirmationTime * 1000).toLocaleString()}
                    </td>
                    <td>{t.pair}</td>
                    <td>{t.direction}</td>
                    <td>{t.score}/20</td>
                    <td className={Number(t.realizedR) >= 0 ? "win" : "loss"}>
                      {totalR}
                      {!projected && (
                        <div
                          style={{
                            marginTop: 3,
                            color: "#748195",
                            fontSize: ".6rem",
                          }}
                        >
                          counterfactual only
                        </div>
                      )}
                    </td>
                    <td
                      className={
                        projected
                          ? displayedR > 0
                            ? "win"
                            : displayedR < 0
                              ? "loss"
                              : "break-even"
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
                      {blocked && (
                        <div
                          title={blocked.reason}
                          style={{
                            marginTop: 4,
                            maxWidth: 240,
                            color: "#ffb65c",
                            fontSize: ".62rem",
                            lineHeight: 1.3,
                          }}
                        >
                          Needs {money(blocked.requiredMargin)} margin at{" "}
                          {blocked.effectiveLeverage}:1 ·{" "}
                          {(
                            blocked.projectedAvailableMarginNavFraction * 100
                          ).toFixed(1)}
                          % NAV left
                        </div>
                      )}
                    </td>
                    <td
                      className={
                        projected
                          ? projected.pnl >= 0
                            ? "win"
                            : "loss"
                          : "break-even"
                      }
                    >
                      {projected ? money(projected.pnl) : "N/A"}
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
            <h2>🏆 Permanent Top 3</h2>
            <span className="muted">
              Highest net realized-R campaigns on the identical fixed 2025 UTC
              candle set · automatically replaces only the lowest record
            </span>
          </div>
        </Head>
        <LeaderboardTable>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Campaign ID</th>
                <th>Campaign</th>
                <th>Manager / target</th>
                <th>Score</th>
                <th>Signals / admitted</th>
                <th>Expectancy</th>
                <th>Net R</th>
                <th>Max drawdown</th>
                <th>Account return</th>
              </tr>
            </thead>
            <tbody>
              {(data?.leaderboard ?? []).map((record, index) => (
                <tr key={record.runUid}>
                  <td>
                    <strong>{["🥇", "🥈", "🥉"][index]}</strong>
                  </td>
                  <td>
                    <TradeId>{record.runUid}</TradeId>
                  </td>
                  <td>
                    <strong>{record.label}</strong>
                    <div
                      style={{
                        marginTop: 4,
                        color: "#748195",
                        fontSize: ".64rem",
                      }}
                    >
                      {new Date(record.completedAt).toLocaleDateString()} ·{" "}
                      {timeframeLabel(record.config)}
                    </div>
                  </td>
                  <td>
                    {getGoldilocksBacktestManager(
                      record.config.tradeManager,
                    ).label}
                    <div
                      style={{
                        marginTop: 4,
                        color: "#748195",
                        fontSize: ".64rem",
                      }}
                    >
                      {record.config.setAndForgetTargetMode === "opposing-base"
                        ? "Opposing base"
                        : record.config.setAndForgetTargetR
                          ? `${record.config.setAndForgetTargetR}R`
                          : "Manager default"}
                    </div>
                  </td>
                  <td>{record.config.minimumScore}/20</td>
                  <td>
                    {record.metrics.totalSignals} /{" "}
                    {record.metrics.acceptedTrades}
                  </td>
                  <td
                    className={
                      (record.metrics.expectancyR ?? 0) >= 0 ? "win" : "loss"
                    }
                  >
                    {formatR(record.metrics.expectancyR, true)}
                  </td>
                  <td className={record.metrics.netR >= 0 ? "win" : "loss"}>
                    {formatR(record.metrics.netR, true)}
                  </td>
                  <td className="loss">
                    {formatR(record.metrics.maxDrawdownR)}
                  </td>
                  <td
                    className={
                      record.metrics.accountReturn >= 0 ? "win" : "loss"
                    }
                  >
                    {record.metrics.accountReturn.toFixed(2)}%
                  </td>
                </tr>
              ))}
              {!data?.leaderboard?.length && (
                <tr>
                  <td colSpan={10} className="muted">
                    Complete a campaign to establish the first permanent record.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </LeaderboardTable>
      </Section>
      <Section>
        <Head>
          <div>
            <h2>Campaign runs</h2>
            <span className="muted">
              One row per saved campaign run · click a row to load its settings, account
              results, trades, chart links, and event log
            </span>
          </div>
          <SortControls>
            <TradeSearch onSubmit={searchCampaignSubmit}>
              <input
                aria-label="Search campaign ID"
                placeholder="Campaign, trial, UUID, or GLR-…"
                value={runUidQuery}
                onChange={(event) => setRunUidQuery(event.target.value)}
              />
              <button type="submit">Find campaign</button>
            </TradeSearch>
            <select
              aria-label="Sort campaign runs by"
              value={runSortKey}
              onChange={(event) => setRunSortKey(event.target.value)}
            >
              {runSortOptions.map(([value, text]) => (
                <option key={value} value={value}>
                  Sort by: {text}
                </option>
              ))}
            </select>
            <select
              aria-label="Campaign run sort direction"
              value={runSortDirection}
              onChange={(event) =>
                setRunSortDirection(event.target.value as SortDirection)
              }
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
            <ClearAllButton
              disabled={active || clearingAll}
              title={
                active
                  ? "Cancel the active backtest first"
                  : "Delete all campaign runs, trades, and events"
              }
              onClick={() => void clearAllBacktests()}
            >
              {clearingAll ? "Clearing…" : "Clear all campaign data"}
            </ClearAllButton>
          </SortControls>
        </Head>
        {campaignSearchResult&&<CampaignSearchResult>
          <div>Found {campaignSearchResult.kind==='manual-campaign'?'manual':'research'} campaign <code>{campaignSearchResult.id}</code> · {campaignSearchResult.status.toUpperCase()} · {campaignSearchResult.runs.length} campaign run{campaignSearchResult.runs.length===1?'':'s'}</div>
          <div className="campaign-runs">{campaignSearchResult.runs.map((item,index)=><button key={item.trialId??item.backtestRunId??index} type="button" disabled={!item.backtestRunId} onClick={()=>item.backtestRunId&&void load(item.backtestRunId)} title={`${item.trialId?`Research trial ${item.trialId}. `:''}${item.backtestRunId?`Backtester run ${item.backtestRunId}. Load its trades and chart links.`:'This campaign run has not created its Backtester record yet.'}`}>{item.runUid??item.trialId?.slice(0,8)??`Run ${index+1}`} · {item.status}</button>)}</div>
        </CampaignSearchResult>}
        <LeaderboardTable>
          <table>
            <thead>
              <tr>
                <th>Delete</th>
                <th>Campaign</th>
                <th>Score</th>
                <th>Signals / admitted</th>
                <th>Expectancy</th>
                <th>Profit factor</th>
                <th>Net R</th>
                <th>Max drawdown</th>
                <th>Account return</th>
              </tr>
            </thead>
            <tbody>
              {sortedRunResults.map((row) => {
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
                    title={`Load complete campaign run: ${row.label}`}
                  >
                    <td>
                      <DeleteButton
                        disabled={deletingId === row.id}
                        title="Delete this entire campaign run and all of its trades"
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeRun(row.id, row.label);
                        }}
                      >
                        {deletingId === row.id ? "Deleting…" : "Delete"}
                      </DeleteButton>
                    </td>
                    <td>
                      <strong>{row.label}</strong>
                      <div style={{ marginTop: 5 }}>
                        <TradeId>{row.runUid ?? "Assigning campaign ID…"}</TradeId>
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          color: "#748195",
                          fontSize: ".66rem",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {new Date(row.createdAt).toLocaleDateString()} ·{" "}
                        {timeframeLabel(row.config)} ·{" "}
                        {row.status.toUpperCase()}
                      </div>
                    </td>
                    <td>{row.config.minimumScore}/20</td>
                    <td
                      title={
                        row.sampleTrades < 50
                          ? "Early sample: below 50 realized-R signals"
                          : row.sampleTrades < 100
                            ? "Building sample: continue toward 100+"
                            : "Stronger sample: 100+ realized-R signals"
                      }
                    >
                      <strong>
                        {row.totalTrades} / {row.acceptedTrades}
                      </strong>
                      <div
                        style={{
                          marginTop: 4,
                          color: row.sampleTrades < 50 ? "#ffb65c" : "#748195",
                          fontSize: ".64rem",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.sampleTrades < 50
                          ? "EARLY"
                          : row.sampleTrades < 100
                            ? "BUILDING"
                            : "100+"}
                      </div>
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
                    <td className={row.netR >= 0 ? "win" : "loss"}>
                      {formatR(row.netR, true)}
                    </td>
                    <td className="loss">
                      {formatR(row.maxDrawdownR)} ·{" "}
                      {row.maxDrawdownPercent.toFixed(2)}%
                    </td>
                    <td className={row.accountReturn >= 0 ? "win" : "loss"}>
                      {row.accountReturn.toFixed(2)}%
                      <div
                        style={{
                          marginTop: 4,
                          color: "inherit",
                          fontSize: ".64rem",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {money(row.netProfitLoss)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </LeaderboardTable>
      </Section>
      {current && (
        <Section>
          <Head>
            <div>
              <h2>Selected campaign configuration</h2>
              <span className="muted">
                Click any campaign-run row above to populate this card ·
                currently showing “{current.label}”
              </span>
            </div>
          </Head>
          <RunConfigGrid>
            <RunConfigItem>Campaign ID: {current.runUid??current.id}</RunConfigItem>
            <RunConfigItem>Saved label: {current.label}</RunConfigItem>
            {tweakSummary(current).map((detail) => (
              <RunConfigItem key={detail}>{detail}</RunConfigItem>
            ))}
          </RunConfigGrid>
        </Section>
      )}
      <Section>
        <Head>
          <h2>Campaign candylog</h2>
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
