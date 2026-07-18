import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import styled from "styled-components";
import { forexPairs } from "../utils/constants";
import { RISK_PROFILES, type RiskProfile } from "../utils/dynamicRisk";
import { formatGoldilocksZoneAge } from "../utils/zoneAge";
import { simulateBacktestPortfolio } from "../utils/backtestPortfolio";
import { GOLDILOCKS_DEFAULT_BACKTEST_LABEL } from "../utils/goldilocksConfig";
import { calculateBacktestPerformance } from "../utils/backtestAnalytics";

const Page = styled.div`
  width: min(1380px, calc(100% - 30px));
  margin: 0 auto 80px;
  color: #eef3ff;
  font-family: Inter, system-ui, sans-serif;
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
  strong { color: #f1c7ff; }
`;
const ResearchLab = styled.section`
  margin-top: 16px;
  padding: 20px;
  border: 1px solid #2e6672;
  border-radius: 20px;
  background: radial-gradient(circle at 90% 0, #164c5b66, transparent 34%), linear-gradient(145deg, #101820, #0b1015);
`;
const ResearchActions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  button { min-width: 110px; }
`;
const ResearchMeter = styled.div`
  margin-top: 12px;
  height: 10px;
  border-radius: 999px;
  background: #202a32;
  overflow: hidden;
  span { display:block;height:100%;background:linear-gradient(90deg,#4ce1bd,#e8a4ff); }
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
    font: 750 0.72rem ui-monospace, SFMono-Regular, Consolas, monospace;
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
  code { color: #7dffd4; font-weight: 900; }
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
`;
const LeaderboardTable = styled(Table)`
  table { min-width: 1750px; }
  th { white-space: nowrap; }
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
const PairCount = styled.span`position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:30px;padding:4px 8px;border:1px solid #36d6a1;background:#10372d;color:#7dffd0;border-radius:999px;font-weight:900;cursor:help;outline:none;&:hover>span,&:focus-visible>span{opacity:1;visibility:visible;transform:translate(-50%,0)}>`;
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
  startingBalance?: number;
  leverage?: number;
  riskProfile?: RiskProfile;
  protectedWinR?: number;
  timeframeProfile?: "intraday" | "higherTimeframe";
  backfillPages?: number;
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
  profitFactor: number | null;
  payoffRatio: number | null;
  breakEvenWinRate: number | null;
  netR: number;
  maxDrawdownR: number;
  longestLosingStreak: number;
  config: RunConfig;
};
type Dashboard = {
  runs: Run[];
  selectedRunId: string;
  trades: Array<Record<string, any>>;
  pairs: Array<Record<string, any>>;
  pairResults: PairResult[];
  events: Array<Record<string, any>>;
};
type ResearchDashboard = {
  selectedCampaignId:string;
  campaigns:Array<{id:string;status:string;label:string;currentTrialId?:string;error?:string;preparationStage?:string;preparationDone?:number;preparationTotal?:number;datasetKey?:string}>;
  trials:Array<{id:string;datasetKey:string;status:string;backtestRunId?:string;config:RunConfig&{label:string};metrics?:{official?:ReturnType<typeof calculateBacktestPerformance>;policies?:Array<Record<string,any>>}}>;
  counts:Array<{status:string;count:number}>;
  events:Array<{id:number;createdAt:string;message:string}>;
  archive:{usedBytes:number;maxBytes:number;percent:number;remainingBytes:number};
};

const formatR = (value: number | null, signed = false) =>
  value == null
    ? "N/A"
    : `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}R`;
const formatFactor = (value: number | null) =>
  value == null ? "N/A" : Number.isFinite(value) ? value.toFixed(2) : "INF";
const formatPayoff = (value: number | null) =>
  value == null ? "N/A" : `${formatFactor(value)}:1`;

export default function Backtesting() {
  const [data, setData] = useState<Dashboard | null>(null),
    [selected, setSelected] = useState<string[]>([...forexPairs]);
  const [research,setResearch]=useState<ResearchDashboard|null>(null),
    [researchBusy,setResearchBusy]=useState(false);
  const [label, setLabel] = useState(GOLDILOCKS_DEFAULT_BACKTEST_LABEL),
    [timeframeProfile, setTimeframeProfile] = useState<"intraday" | "higherTimeframe">("intraday"),
    [minimumScore, setMinimumScore] = useState(14),
    [lookbackDays, setLookbackDays] = useState(730),
    [busy, setBusy] = useState(false),
    [deletingId, setDeletingId] = useState(""),
    [clearingAll, setClearingAll] = useState(false),
    [error, setError] = useState("");
  const [startingBalance, setStartingBalance] = useState(1000),
    [leverage, setLeverage] = useState(30),
    [riskProfile, setProjectionRiskProfile] = useState<RiskProfile>("default");
  const [tradeIdQuery, setTradeIdQuery] = useState(""),
    [tradeSearchResult, setTradeSearchResult] = useState<Record<string, any> | null>(null),
    [tradeSearching, setTradeSearching] = useState(false);
  const load = useCallback(async (runId?: string) => {
    try {
      const r = await fetch(`/api/backtests${runId ? `?runId=${runId}` : ""}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setData(await r.json());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const loadResearch=useCallback(async()=>{
    try{
      const response=await fetch('/api/backtests/research',{cache:'no-store'});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setResearch(body);
    }catch(researchError){setError((researchError as Error).message)}
  },[]);
  const selectSnapshot = (
    runId: string,
    config: Run["config"],
    snapshotLabel: string,
  ) => {
    setSelected(Array.isArray(config.pairs) ? [...config.pairs] : []);
    setMinimumScore(config.minimumScore);
    setLookbackDays(config.lookbackDays);
    setTimeframeProfile(config.timeframeProfile ?? "intraday");
    setStartingBalance(config.startingBalance ?? 1000);
    setLeverage(config.leverage ?? 30);
    setProjectionRiskProfile(config.riskProfile ?? "default");
    setLabel(`${snapshotLabel} · rerun`);
    void load(runId);
  };
  const searchTrade = async (event: FormEvent) => {
    event.preventDefault();
    const tradeId = tradeIdQuery.trim().toUpperCase();
    if (!tradeId) return;
    setTradeSearching(true);
    try {
      const response = await fetch(`/api/backtests?tradeId=${encodeURIComponent(tradeId)}`, { cache: "no-store" });
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
  const active =
    data?.runs.some(
      (run) => run.status === "running" || run.status === "queued",
    ) ?? false;
  useEffect(() => {
    void load();
    void loadResearch();
  }, [load,loadResearch]);
  useEffect(()=>{
    const id=setInterval(()=>void loadResearch(),5_000);
    return()=>clearInterval(id);
  },[loadResearch]);
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
          timeframeProfile,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      await load(body.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const researchAction=async(action:'start'|'pause'|'resume'|'stop')=>{
    setResearchBusy(true);
    try{
      const campaign=research?.campaigns.find(item=>item.id===research.selectedCampaignId)??research?.campaigns[0];
      const response=await fetch(action==='start'?'/api/backtests/research':`/api/backtests/research?campaignId=${encodeURIComponent(String(campaign?.id??''))}`,{
        method:action==='start'?'POST':action==='stop'?'DELETE':'PATCH',
        headers:{'Content-Type':'application/json'},
        body:action==='start'?JSON.stringify({continuous:false,pairs:selected}):action==='stop'?undefined:JSON.stringify({action}),
      });
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      await loadResearch();
      setError('');
    }catch(researchError){setError((researchError as Error).message)}finally{setResearchBusy(false)}
  };
  const current =
    data?.runs.find((item) => item.id === data.selectedRunId) ?? data?.runs[0];
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
    if (!window.confirm("Permanently clear every backtest run, trade, and event? Historical news coverage will be preserved. This cannot be undone.")) return;
    setClearingAll(true);
    try {
      const response = await fetch("/api/backtests?all=true&permanent=true", { method: "DELETE" });
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
  const researchCampaign=research?.campaigns.find(item=>item.id===research.selectedCampaignId)??research?.campaigns[0];
  const researchCounts=Object.fromEntries((research?.counts??[]).map(item=>[item.status,Number(item.count)]));
  const completedResearchTrials=[...(research?.trials??[])].filter(trial=>trial.status==='completed').sort((left,right)=>
    Number(right.metrics?.official?.expectancyR??Number.NEGATIVE_INFINITY)-Number(left.metrics?.official?.expectancyR??Number.NEGATIVE_INFINITY)
    || Number(left.metrics?.official?.maxDrawdownR??Number.POSITIVE_INFINITY)-Number(right.metrics?.official?.maxDrawdownR??Number.POSITIVE_INFINITY)
  );
  const topResearchTrials=completedResearchTrials.filter(trial=>Number(trial.metrics?.official?.sampleTrades??0)>=100).slice(0,8);
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
            Version / tweak label
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field>
            Timeframe stack
            <select
              value={timeframeProfile}
              onChange={(e) => {
                const value=e.target.value as "intraday" | "higherTimeframe";
                setTimeframeProfile(value);
                setLookbackDays(value === "higherTimeframe" ? 3650 : 730);
              }}
            >
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
      <ResearchLab>
        <Head style={{padding:0,border:0}}>
          <div>
            <h2>24/7 auto research</h2>
            <span className="muted">One OANDA acquisition, then sealed SQLite-only trials · D1/H4/H1 and H1/M15/M5 · scores 10-18 · 22 managers</span>
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
          return <tr key={trial.id}><td><Link href={`/research/trials/${trial.id}`} style={{color:'#87eaff'}}>{trial.config.label}</Link></td><td>{trial.config.timeframeProfile==='higherTimeframe'?'D1/H4/H1':'H1/M15/M5'}</td><td>{trial.config.minimumScore}/20</td><td>{metrics?.sampleTrades??0}</td><td>{formatR(metrics?.expectancyR??null,true)}</td><td>{formatFactor(metrics?.profitFactor??null)}</td><td>{formatR(metrics?.maxDrawdownR??null)}</td><td>{String(bestPolicy?.policyId??'—')}</td></tr>;
        })}</tbody></table></Table>}
        <MoneyNote>{topResearchTrials.length?'Only configurations with at least 100 trades are ranked. Click a configuration to inspect every frozen input, gate, score component, diagnostic, manager, pair result, and trade audit.':`${completedResearchTrials.length} completed configuration(s), but none has the 100-trade evidence required for ranking yet.`}</MoneyNote>
      </ResearchLab>
      <Grid>
        <Card>
          <Label>Trade signals</Label>
          <Metric>{current?.totalTrades ?? 0}</Metric>
        </Card>
        <Card>
          <Label>Expectancy / trade</Label>
          <Metric style={{ color: performance.expectancyR == null ? "#fff" : performance.expectancyR >= 0 ? "#60f0a2" : "#ff6678" }}>
            {formatR(performance.expectancyR, true)}
          </Metric>
        </Card>
        <Card>
          <Label>Profit factor</Label>
          <Metric style={{ color: performance.profitFactor == null ? "#fff" : performance.profitFactor >= 1 ? "#60f0a2" : "#ff6678" }}>
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
            <span className="muted">Realized R, not the win label, determines whether the setup has an edge</span>
          </div>
        </Head>
        <EdgeGrid>
          <Card>
            <Label>Profitable rate</Label>
            <Metric>{performance.profitableRate.toFixed(1)}%</Metric>
            <span className="muted">{performance.profitableTrades} positive-R trades</span>
          </Card>
          <Card>
            <Label>Average win / loss</Label>
            <Metric style={{ fontSize: "1.35rem" }}>{formatR(performance.averageWinR)} / {formatR(performance.averageLossR)}</Metric>
          </Card>
          <Card>
            <Label>Payoff ratio</Label>
            <Metric>{formatPayoff(performance.payoffRatio)}</Metric>
          </Card>
          <Card>
            <Label>Break-even win rate</Label>
            <Metric>{performance.breakEvenWinRate == null ? "N/A" : `${performance.breakEvenWinRate.toFixed(1)}%`}</Metric>
          </Card>
          <Card>
            <Label>Net realized R</Label>
            <Metric style={{ color: performance.netR >= 0 ? "#60f0a2" : "#ff6678" }}>{formatR(performance.netR, true)}</Metric>
          </Card>
          <Card>
            <Label>Max drawdown</Label>
            <Metric style={{ color: "#ffb65c" }}>{formatR(performance.maxDrawdownR)}</Metric>
          </Card>
          <Card>
            <Label>Longest loss streak</Label>
            <Metric>{performance.longestLosingStreak}</Metric>
          </Card>
          <Card>
            <Label>Reached +1R / protected 0R</Label>
            <Metric style={{ fontSize: "1.35rem" }}>{current?.wins ?? 0} / {performance.breakEvenTrades}</Metric>
            <span className="muted">{reachRate.toFixed(1)}% reached +1R</span>
          </Card>
        </EdgeGrid>
        <EdgeNote>
          <strong>Read win rate as consistency, not as the objective.</strong> Protected break-even trades count as 0R here, not profitable wins. Rankings below use expectancy first. {performance.sampleTrades < 50 ? `This run has only ${performance.sampleTrades} realized-R trades; treat it as an early signal until it reaches at least 50, ideally 100+.` : `${performance.sampleTrades} realized-R trades are included.`}{performance.omittedTrades ? ` ${performance.omittedTrades} legacy trade(s) without realized R are excluded from edge math.` : ""}
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
        {projection.byPair.length > 0 && (
          <Table style={{ marginTop: 14, maxHeight: 260 }}>
            <table>
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>Trades</th>
                  <th>Profitable</th>
                  <th>Losing</th>
                  <th>Total R</th>
                  <th>Projected net P/L</th>
                </tr>
              </thead>
              <tbody>
                {projection.byPair.map((row) => (
                  <tr key={row.pair}>
                    <td>{row.pair}</td>
                    <td>{row.trades}</td>
                    <td className="win">{row.wins}</td>
                    <td className="loss">{row.losses}</td>
                    <td className={row.totalR >= 0 ? "win" : "loss"}>
                      {row.totalR.toFixed(2)}R
                    </td>
                    <td className={row.net >= 0 ? "win" : "loss"}>
                      {money(row.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Table>
        )}
      </MoneyLab>
      <Section>
        <Head>
          <div><h2>Recorded trades</h2><span className="muted">Every trade has a permanent searchable ID</span></div>
          <TradeSearch onSubmit={searchTrade}>
            <input aria-label="Search trade ID" placeholder="GL-EURUSD-YYYYMMDD-HHMM-XXXXXXXX" value={tradeIdQuery} onChange={(event) => setTradeIdQuery(event.target.value)} />
            <button type="submit" disabled={tradeSearching}>{tradeSearching ? "Searching…" : "Find trade"}</button>
          </TradeSearch>
        </Head>
        {tradeSearchResult && <TradeSearchResult>Found <code>{tradeSearchResult.tradeId}</code> · {tradeSearchResult.pair} {tradeSearchResult.direction} · {new Date(Number(tradeSearchResult.confirmationTime) * 1000).toLocaleString()} · tweak “{tradeSearchResult.runLabel}”</TradeSearchResult>}
        <Table>
          <table>
            <thead>
              <tr>
                <th>Trade ID</th>
                <th>Time</th>
                <th>First outside (M15)</th>
                <th>Pair</th>
                <th>Side</th>
                <th>Zone</th>
                <th>Age</th>
                <th>Score</th>
                <th>Prior touches</th>
                <th>Penetration</th>
                <th>Available R</th>
                <th>ZIZ</th>
                <th>Approach risk</th>
                <th>Total R</th>
                <th>Replay</th>
              </tr>
            </thead>
            <tbody>
              {data?.trades.map((t) => {
                const totalR =
                  t.realizedR == null
                    ? t.outcome === "WIN"
                      ? "Legacy"
                      : "-1.00R"
                    : `${Number(t.realizedR).toFixed(2)}R`;
                return (
                  <tr key={t.id} style={{background:tradeSearchResult?.tradeId===t.tradeId?"#12382e":""}}>
                    <td><TradeId>{t.tradeId}</TradeId></td>
                    <td>
                      {new Date(t.confirmationTime * 1000).toLocaleString()}
                    </td>
                    <td>{t.firstOutsideTime ? new Date(t.firstOutsideTime * 1000).toLocaleString() : "Legacy"}</td>
                    <td>{t.pair}</td>
                    <td>{t.direction}</td>
                    <td>{t.zoneKind}</td>
                    <td>{formatGoldilocksZoneAge(t.zoneAgeSeconds)}</td>
                    <td>{t.score}/20</td>
                    <td>{t.priorTouches}</td>
                    <td>{(t.maxPenetration * 100).toFixed(1)}%</td>
                    <td>
                      {t.availableRrr == null
                        ? "unlimited"
                        : Number(t.availableRrr).toFixed(2)}
                      R
                    </td>
                    <td>{t.confluenceCount}/3</td>
                    <td title={t.approachPressure?.adversePressureFlags?.join(", ") || "No recorded approach-pressure diagnostic"}>
                      {t.approachPressure ? `${t.approachPressure.adversePressureScore}/4` : "Legacy"}
                    </td>
                    <td className={Number(t.realizedR) >= 0 ? "win" : "loss"}>
                      {totalR}
                    </td>
                    <td>
                      <ReplayLink
                        href={`/strategy-lab?pair=${encodeURIComponent(t.pair)}&timeframe=M5&tradeTime=${t.confirmationTime}&exitTime=${t.outcomeTime}&tradeId=${encodeURIComponent(t.tradeId)}`}
                      >
                        View chart
                      </ReplayLink>
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
            <h2>Tweak history by pair</h2>
            <span className="muted">One pair per tweak row | highest realized-R expectancy first | click to restore the combination</span>
          </div>
          <ClearAllButton
            disabled={active || clearingAll}
            title={active ? "Cancel the active backtest first" : "Delete all backtest runs, trades, and events"}
            onClick={() => void clearAllBacktests()}
          >
            {clearingAll ? "Clearing…" : "Clear all backtest data"}
          </ClearAllButton>
        </Head>
        <LeaderboardTable>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Pair</th>
                <th>Tweak</th>
                <th>Run date</th>
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
                <th>Sample</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.pairResults.map((row, index) => {
                const runPairs = Array.isArray(row.config?.pairs)
                  ? row.config.pairs
                  : [];
                const pairText = runPairs.length
                  ? runPairs.join(", ")
                  : "Pair details unavailable";
                return (
                  <tr
                    key={`${row.runId}:${row.pair}`}
                    onClick={() =>
                      selectSnapshot(row.runId, row.config, row.label)
                    }
                    style={{
                      cursor: "pointer",
                      background:
                        row.runId === data.selectedRunId ? "#152c29" : "",
                    }}
                    title={`Restore ${row.label} settings and results`}
                  >
                    <td>{index + 1}</td>
                    <td>
                      <strong>{row.pair}</strong>
                    </td>
                    <td>
                      {row.label}
                      <br />
                      <PairCount
                        tabIndex={0}
                        title={pairText}
                        aria-label={`${runPairs.length} run pairs: ${pairText}`}
                      >
                        {runPairs.length} pairs
                        <PairTip>
                          <strong>Full run universe</strong>
                          <span className="list">{pairText}</span>
                        </PairTip>
                      </PairCount>
                    </td>
                    <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                    <td>{row.config.minimumScore}/20</td>
                    <td>{row.config.lookbackDays} days</td>
                    <td>{row.trades}</td>
                    <td className={row.netR >= 0 ? "win" : "loss"}>{formatR(row.netR, true)}</td>
                    <td className={(row.expectancyR ?? 0) >= 0 ? "win" : "loss"}>{formatR(row.expectancyR, true)}</td>
                    <td>{formatFactor(row.profitFactor)}</td>
                    <td className="win">{formatR(row.averageWinR)}</td>
                    <td className="loss">{formatR(row.averageLossR)}</td>
                    <td>{formatPayoff(row.payoffRatio)}</td>
                    <td>{row.profitableRate.toFixed(1)}%</td>
                    <td>{row.breakEvenTrades}</td>
                    <td className="loss">{formatR(row.maxDrawdownR)}</td>
                    <td className="loss">{row.maxDrawdown.toFixed(2)}%</td>
                    <td title={row.sampleTrades < 50 ? "Early sample: below 50 realized-R trades" : row.sampleTrades < 100 ? "Useful sample: continue toward 100+" : "Stronger sample: 100+ realized-R trades"}>
                      {row.sampleTrades} {row.sampleTrades < 50 ? "| EARLY" : row.sampleTrades < 100 ? "| BUILDING" : "| 100+"}
                    </td>
                    <td>
                      <DeleteButton
                        disabled={deletingId === row.runId}
                        title="Delete this entire tweak and all pair results"
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeRun(row.runId, row.label);
                        }}
                      >
                        {deletingId === row.runId
                          ? "Deleting…"
                          : "Delete tweak"}
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
