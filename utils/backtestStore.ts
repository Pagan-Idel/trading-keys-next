import Database from "better-sqlite3";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { RiskProfile } from "./dynamicRisk.ts";
import {
  simulateBacktestPortfolio,
  type PortfolioTrade,
} from "./backtestPortfolio.ts";
import { calculateBacktestPerformance } from "./backtestAnalytics.ts";
import type { GoldilocksApproachPressure } from "./approachPressure.ts";
import {
  GOLDILOCKS_RESEARCH_SCHEMA_VERSION,
  type TradeManagementResearchResult,
  type TradePathSummary,
} from "./tradeManagementResearch.ts";
import type { ZoneCorridorMeasurement } from "./zoneCorridor.ts";
import type {
  GoldilocksBacktestTweaks,
  GoldilocksBacktestGates,
  GoldilocksScoreWeights,
  GoldilocksConfirmationMode,
  GoldilocksTimeframeProfileId,
} from "./goldilocksConfig.ts";
import type { GoldilocksResearchManifest } from "./goldilocksResearchManifest.ts";
import {
  getGoldilocksBacktestManagerForRun,
  type GoldilocksBacktestManagerId,
  type GoldilocksScaleOut,
} from "./goldilocksTradeManagement.ts";
import {includeRequestedCampaignRun} from './campaignSearch.ts';
import {isGoldilocksComparisonDataset} from './comparisonDataset.ts';

export type BacktestStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled";
export interface BacktestRunConfig {
  pairs: string[];
  lookbackDays: number;
  minimumScore: number;
  label: string;
  strategyVersion?: string;
  confirmationMode?: GoldilocksConfirmationMode;
  timeframeProfile?: GoldilocksTimeframeProfileId;
  backfillPages?: number;
  startingBalance?: number;
  leverage?: number;
  riskProfile?: RiskProfile;
  tradeManager?: GoldilocksBacktestManagerId;
  setAndForgetTargetR?: number;
  setAndForgetTargetMode?: "fixed-r" | "opposing-base";
  closeTradesBeforeWeekend?: boolean;
  reverseFinalSignal?: boolean;
  protectedWinR?: number;
  archiveOnly?: boolean;
  datasetStartTime?: number;
  datasetEndTime?: number;
  datasetKey?: string;
  researchManifest?: GoldilocksResearchManifest;
  strategyTweaks?: GoldilocksBacktestTweaks;
  gateSettings?: GoldilocksBacktestGates;
  scoreWeights?: GoldilocksScoreWeights;
}
export interface BacktestTradeInput {
  runId: string;
  pair: string;
  zoneId: string;
  zoneKind: string;
  direction: "BUY" | "SELL";
  confirmationTime: number;
  zoneAgeSeconds: number;
  firstOutsideTime?: number;
  outcome: "WIN" | "LOSS";
  outcomeTime: number;
  exitReason:
    | "target"
    | "break_even"
    | "runner_target"
    | "runner_stop"
    | "runner_open"
    | "one_r_protected"
    | "weekend_close"
    | "stop";
  realizedR: number;
  entry: number;
  stopLoss: number;
  oneR: number;
  takeProfit: number;
  score: number;
  scoreJson: unknown;
  priorTouches: number;
  maxPenetration: number;
  availableRrr: number;
  confluenceCount: number;
  trend: string;
  approachPressure?: GoldilocksApproachPressure;
  zoneCorridors?: ZoneCorridorMeasurement[];
  marketPath?: TradePathSummary | null;
  partialExits?: GoldilocksScaleOut[];
  managementPolicyResults?: TradeManagementResearchResult[];
}

const dbPath = path.resolve(process.cwd(), "data", "automation.sqlite");
let db: Database.Database | null = null;
let completedPairResultsCache:
  { key: string; rows: Array<Record<string, any>> } | undefined;
export const stableBacktestTradeId = (
  trade: Pick<
    BacktestTradeInput,
    "runId" | "pair" | "zoneId" | "confirmationTime"
  >,
) => {
  const date = new Date(trade.confirmationTime * 1000);
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}-${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}`;
  const pair = trade.pair.replace(/[^A-Z]/gi, "").toUpperCase();
  const hash = createHash("sha256")
    .update(
      `${trade.runId}|${trade.pair}|${trade.zoneId}|${trade.confirmationTime}`,
    )
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `GL-${pair}-${stamp}-${hash}`;
};

export const stableBacktestRunUid = (input: {
  id: string;
  createdAt: string;
}) => {
  const created = new Date(input.createdAt);
  const stamp = Number.isFinite(created.getTime())
    ? created
        .toISOString()
        .slice(0, 16)
        .replace(/[-T:]/g, "")
    : "UNKNOWN";
  const hash = createHash("sha256")
    .update(`${input.id}|${input.createdAt}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `GLR-${stamp}-${hash}`;
};

export const selectTopBacktestLeaderboardRecords = <
  T extends { runUid: string; netR: number; completedAt: string },
>(
  records: T[],
  limit = 3,
) =>
  [...records]
    .sort(
      (left, right) =>
        right.netR - left.netR ||
        right.completedAt.localeCompare(left.completedAt) ||
        left.runUid.localeCompare(right.runUid),
    )
    .slice(0, Math.max(0, limit));
const database = () => {
  if (db) return db;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS backtest_runs (
      id TEXT PRIMARY KEY,status TEXT NOT NULL,label TEXT NOT NULL,config_json TEXT NOT NULL,
      pairs_json TEXT NOT NULL,created_at TEXT NOT NULL,started_at TEXT,completed_at TEXT,
      progress_pair TEXT,progress_done INTEGER NOT NULL DEFAULT 0,progress_total INTEGER NOT NULL DEFAULT 0,
      total_trades INTEGER NOT NULL DEFAULT 0,wins INTEGER NOT NULL DEFAULT 0,losses INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS backtest_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,trade_uid TEXT,run_id TEXT NOT NULL,pair TEXT NOT NULL,zone_id TEXT NOT NULL,
      zone_kind TEXT NOT NULL,direction TEXT NOT NULL,confirmation_time INTEGER NOT NULL,zone_age_seconds INTEGER,
      outcome TEXT NOT NULL,outcome_time INTEGER NOT NULL,exit_reason TEXT NOT NULL,
      entry REAL NOT NULL,stop_loss REAL NOT NULL,one_r REAL NOT NULL,take_profit REAL NOT NULL,
      score INTEGER NOT NULL,score_json TEXT NOT NULL,prior_touches INTEGER NOT NULL,max_penetration REAL NOT NULL,
      available_rrr REAL,confluence_count INTEGER NOT NULL,trend TEXT NOT NULL,
      approach_pressure_json TEXT,
      zone_corridors_json TEXT,
      market_path_json TEXT,
      partial_exits_json TEXT,
      FOREIGN KEY(run_id) REFERENCES backtest_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_backtest_trades_run_pair ON backtest_trades(run_id,pair,confirmation_time);
    CREATE TABLE IF NOT EXISTS backtest_trade_management_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,trade_uid TEXT NOT NULL,run_id TEXT NOT NULL,pair TEXT NOT NULL,
      confirmation_time INTEGER NOT NULL,policy_id TEXT NOT NULL,policy_version INTEGER NOT NULL,
      config_json TEXT NOT NULL,result_json TEXT NOT NULL,realized_r REAL,exit_time INTEGER,exit_reason TEXT NOT NULL,
      created_at TEXT NOT NULL,UNIQUE(trade_uid,policy_id)
    );
    CREATE INDEX IF NOT EXISTS idx_backtest_management_run_pair ON backtest_trade_management_results(run_id,pair,confirmation_time);
    CREATE TABLE IF NOT EXISTS backtest_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,created_at TEXT NOT NULL,pair TEXT,
      step TEXT NOT NULL,message TEXT NOT NULL,data_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_backtest_events_run ON backtest_events(run_id,id DESC);
    CREATE TABLE IF NOT EXISTS backtest_leaderboard (
      run_uid TEXT PRIMARY KEY,source_run_id TEXT NOT NULL,label TEXT NOT NULL,
      config_json TEXT NOT NULL,completed_at TEXT NOT NULL,net_r REAL NOT NULL,
      metrics_json TEXT NOT NULL,recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_backtest_leaderboard_rank
      ON backtest_leaderboard(net_r DESC,completed_at DESC);
    CREATE TABLE IF NOT EXISTS backtest_leaderboard_considered (
      run_uid TEXT PRIMARY KEY,evaluated_at TEXT NOT NULL
    );
  `);
  const columns = new Set(
    (
      db.prepare("PRAGMA table_info(backtest_runs)").all() as Array<{
        name: string;
      }>
    ).map((column) => column.name),
  );
  if (!columns.has("worker_pid"))
    db.exec("ALTER TABLE backtest_runs ADD COLUMN worker_pid INTEGER");
  if (!columns.has("heartbeat_at"))
    db.exec("ALTER TABLE backtest_runs ADD COLUMN heartbeat_at TEXT");
  if (!columns.has("progress_stage"))
    db.exec("ALTER TABLE backtest_runs ADD COLUMN progress_stage TEXT");
  if (!columns.has("progress_percent"))
    db.exec(
      "ALTER TABLE backtest_runs ADD COLUMN progress_percent REAL NOT NULL DEFAULT 0",
    );
  if (!columns.has("run_uid"))
    db.exec("ALTER TABLE backtest_runs ADD COLUMN run_uid TEXT");
  const runsMissingUids = db
    .prepare(
      "SELECT id,created_at AS createdAt FROM backtest_runs WHERE run_uid IS NULL OR run_uid=''",
    )
    .all() as Array<{ id: string; createdAt: string }>;
  if (runsMissingUids.length) {
    const updateRunUid = db.prepare(
      "UPDATE backtest_runs SET run_uid=? WHERE id=?",
    );
    db.transaction(() => {
      for (const run of runsMissingUids)
        updateRunUid.run(stableBacktestRunUid(run), run.id);
    })();
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_backtest_runs_uid ON backtest_runs(run_uid)",
  );
  const tradeColumns = new Set(
    (
      db.prepare("PRAGMA table_info(backtest_trades)").all() as Array<{
        name: string;
      }>
    ).map((column) => column.name),
  );
  if (!tradeColumns.has("realized_r"))
    db.exec("ALTER TABLE backtest_trades ADD COLUMN realized_r REAL");
  if (!tradeColumns.has("trade_uid"))
    db.exec("ALTER TABLE backtest_trades ADD COLUMN trade_uid TEXT");
  if (!tradeColumns.has("first_outside_time"))
    db.exec(
      "ALTER TABLE backtest_trades ADD COLUMN first_outside_time INTEGER",
    );
  if (!tradeColumns.has("zone_age_seconds"))
    db.exec("ALTER TABLE backtest_trades ADD COLUMN zone_age_seconds INTEGER");
  if (!tradeColumns.has("approach_pressure_json"))
    db.exec(
      "ALTER TABLE backtest_trades ADD COLUMN approach_pressure_json TEXT",
    );
  if (!tradeColumns.has("zone_corridors_json"))
    db.exec("ALTER TABLE backtest_trades ADD COLUMN zone_corridors_json TEXT");
  if (!tradeColumns.has("market_path_json"))
    db.exec("ALTER TABLE backtest_trades ADD COLUMN market_path_json TEXT");
  if (!tradeColumns.has("partial_exits_json"))
    db.exec("ALTER TABLE backtest_trades ADD COLUMN partial_exits_json TEXT");
  const missingTradeIds = db
    .prepare(
      `SELECT id,run_id AS runId,pair,zone_id AS zoneId,confirmation_time AS confirmationTime FROM backtest_trades WHERE trade_uid IS NULL OR trade_uid=''`,
    )
    .all() as Array<{
    id: number;
    runId: string;
    pair: string;
    zoneId: string;
    confirmationTime: number;
  }>;
  if (missingTradeIds.length) {
    const updateTradeId = db.prepare(
      "UPDATE backtest_trades SET trade_uid=? WHERE id=?",
    );
    db.transaction(() => {
      for (const trade of missingTradeIds)
        updateTradeId.run(stableBacktestTradeId(trade), trade.id);
    })();
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_backtest_trades_uid ON backtest_trades(trade_uid)",
  );
  return db;
};
const json = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    Number.isFinite(item) ? item : item === Infinity ? "unlimited" : item,
  );
const summaryConfig = (value: unknown) => {
  const config = JSON.parse(String(value)) as BacktestRunConfig;
  delete config.researchManifest;
  return config;
};
export const getBacktestRunOrigin = (value: unknown) => {
  try {
    const config = JSON.parse(String(value)) as BacktestRunConfig;
    return config.researchManifest ? "research" : "manual";
  } catch {
    return "manual";
  }
};

export const createBacktestRun = (id: string, config: BacktestRunConfig) => {
  const createdAt = new Date().toISOString();
  return database()
    .prepare(
      `
  INSERT INTO backtest_runs(id,run_uid,status,label,config_json,pairs_json,created_at,progress_total)
  VALUES(?, ?, 'queued', ?, ?, ?, ?, ?)
`,
    )
    .run(
      id,
      stableBacktestRunUid({ id, createdAt }),
      config.label,
      json(config),
      json(config.pairs),
      createdAt,
      config.pairs.length,
    );
};
export const getActiveBacktestRun = () =>
  database()
    .prepare(
      `SELECT id FROM backtest_runs WHERE status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`,
    )
    .get() as { id: string } | undefined;
export const getBacktestRuntime = (id: string) =>
  database()
    .prepare(
      `SELECT id,status,worker_pid AS workerPid FROM backtest_runs WHERE id=?`,
    )
    .get(id) as
    | { id: string; status: BacktestStatus; workerPid: number | null }
    | undefined;
export const getBacktestStatusSnapshot = (id: string) => {
  const d = database();
  const row = d
    .prepare(
      `SELECT id,run_uid AS runUid,status,label,config_json AS configJson,created_at AS createdAt,started_at AS startedAt,
    heartbeat_at AS heartbeatAt,progress_pair AS progressPair,progress_done AS progressDone,progress_total AS progressTotal,
    progress_stage AS progressStage,progress_percent AS progressPercent,total_trades AS totalTrades,error
    FROM backtest_runs WHERE id=?`,
    )
    .get(id) as (Record<string, unknown> & { configJson: string }) | undefined;
  if (!row) return undefined;
  const latestEvent =
    d
      .prepare(
        `SELECT id,created_at AS createdAt,pair,step,message FROM backtest_events
    WHERE run_id=? ORDER BY id DESC LIMIT 1`,
      )
      .get(id) ?? null;
  const { configJson, ...fields } = row;
  const config = JSON.parse(configJson) as BacktestRunConfig;
  delete config.researchManifest;
  return { ...fields, config, latestEvent };
};
export interface BacktestTradeReplay extends Pick<
  BacktestTradeInput,
  | "zoneId"
  | "zoneKind"
  | "direction"
  | "confirmationTime"
  | "zoneAgeSeconds"
  | "firstOutsideTime"
  | "outcome"
  | "outcomeTime"
  | "exitReason"
  | "realizedR"
  | "entry"
  | "stopLoss"
  | "oneR"
  | "takeProfit"
  | "score"
  | "scoreJson"
  | "priorTouches"
  | "maxPenetration"
  | "availableRrr"
  | "confluenceCount"
  | "trend"
  | "approachPressure"
  | "zoneCorridors"
  | "marketPath"
  | "partialExits"
> {
  tradeId: string;
  strategyVersion?: string;
  confirmationMode?: GoldilocksConfirmationMode;
  tradeManager?: GoldilocksBacktestManagerId;
  setAndForgetTargetMode?: "fixed-r" | "opposing-base";
  setAndForgetTargetZoneId?: string;
  managementPolicyResults?: TradeManagementResearchResult[];
}
export const getBacktestTradeReplay = (
  pair: string,
  confirmationTime: number,
  tradeId?: string,
): BacktestTradeReplay | undefined => {
  const normalizedTradeId = tradeId?.trim().toUpperCase();
  const row = database()
    .prepare(
      `
  SELECT t.trade_uid AS tradeId,t.zone_id AS zoneId,t.zone_kind AS zoneKind,t.direction,t.confirmation_time AS confirmationTime,t.zone_age_seconds AS zoneAgeSeconds,t.first_outside_time AS firstOutsideTime,
    t.outcome,t.outcome_time AS outcomeTime,t.exit_reason AS exitReason,t.realized_r AS realizedR,
    t.entry,t.stop_loss AS stopLoss,t.one_r AS oneR,t.take_profit AS takeProfit,t.score,
    t.score_json AS scoreJson,t.prior_touches AS priorTouches,t.max_penetration AS maxPenetration,
    t.available_rrr AS availableRrr,t.confluence_count AS confluenceCount,t.trend,t.approach_pressure_json AS approachPressureJson,
    t.zone_corridors_json AS zoneCorridorsJson,t.market_path_json AS marketPathJson,t.partial_exits_json AS partialExitsJson,r.config_json AS configJson
  FROM backtest_trades t JOIN backtest_runs r ON r.id=t.run_id
  WHERE t.pair=? AND ABS(t.confirmation_time-?)<=60
    AND (? IS NULL OR UPPER(t.trade_uid)=?)
  ORDER BY r.created_at DESC LIMIT 1
  `,
    )
    .get(
      pair,
      confirmationTime,
      normalizedTradeId ?? null,
      normalizedTradeId ?? null,
    ) as
    | (Omit<
        BacktestTradeReplay,
        "scoreJson" | "approachPressure" | "zoneCorridors" | "marketPath"
      > & {
        scoreJson: string;
        approachPressureJson: string | null;
        zoneCorridorsJson: string | null;
        marketPathJson: string | null;
        partialExitsJson: string | null;
        configJson: string;
      })
    | undefined;
  if (!row) return undefined;
  const {
    configJson,
    approachPressureJson,
    zoneCorridorsJson,
    marketPathJson,
    partialExitsJson,
    ...trade
  } = row;
  const config = JSON.parse(configJson) as BacktestRunConfig;
  const managementPolicyResults = database()
    .prepare(
      "SELECT result_json AS resultJson FROM backtest_trade_management_results WHERE trade_uid=? ORDER BY policy_id",
    )
    .all(row.tradeId)
    .map((item: any) => JSON.parse(item.resultJson));
  const zoneCorridors = zoneCorridorsJson
    ? (JSON.parse(zoneCorridorsJson) as ZoneCorridorMeasurement[])
    : undefined;
  const setAndForgetTargetZoneId =
    config.setAndForgetTargetMode === "opposing-base"
      ? zoneCorridors?.find((corridor) =>
          trade.direction === "SELL"
            ? corridor.demandZoneId && corridor.demandHigh === trade.takeProfit
            : corridor.supplyZoneId && corridor.supplyLow === trade.takeProfit,
        )?.[trade.direction === "SELL" ? "demandZoneId" : "supplyZoneId"]
      : undefined;
  return {
    ...trade,
    scoreJson: JSON.parse(row.scoreJson),
    approachPressure: approachPressureJson
      ? JSON.parse(approachPressureJson)
      : undefined,
    zoneCorridors,
    marketPath: marketPathJson ? JSON.parse(marketPathJson) : undefined,
    partialExits: partialExitsJson ? JSON.parse(partialExitsJson) : undefined,
    managementPolicyResults,
    strategyVersion: config.strategyVersion,
    confirmationMode: config.confirmationMode,
    tradeManager: getGoldilocksBacktestManagerForRun(
      config.tradeManager,
      config.strategyVersion,
    ).id,
    setAndForgetTargetMode: config.setAndForgetTargetMode,
    setAndForgetTargetZoneId,
  };
};
export const getBacktestTradeById = (tradeId: string) => {
  const normalized = tradeId.trim().toUpperCase();
  if (!normalized) return undefined;
  const row = database()
    .prepare(
      `SELECT t.id,t.trade_uid AS tradeId,t.run_id AS runId,t.pair,t.zone_id AS zoneId,
    t.zone_kind AS zoneKind,t.direction,t.confirmation_time AS confirmationTime,t.zone_age_seconds AS zoneAgeSeconds,t.first_outside_time AS firstOutsideTime,t.outcome,t.outcome_time AS outcomeTime,
    t.exit_reason AS exitReason,t.realized_r AS realizedR,t.entry,t.stop_loss AS stopLoss,t.one_r AS oneR,
    t.take_profit AS takeProfit,t.score,t.prior_touches AS priorTouches,t.max_penetration AS maxPenetration,
    t.available_rrr AS availableRrr,t.confluence_count AS confluenceCount,t.trend,t.approach_pressure_json AS approachPressureJson,
    t.zone_corridors_json AS zoneCorridorsJson,t.market_path_json AS marketPathJson,t.partial_exits_json AS partialExitsJson,r.label AS runLabel,r.config_json AS configJson
    FROM backtest_trades t JOIN backtest_runs r ON r.id=t.run_id WHERE UPPER(t.trade_uid)=? LIMIT 1`,
    )
    .get(normalized) as
    (Record<string, unknown> & { configJson: string }) | undefined;
  if (!row) return undefined;
  const managementPolicyResults = database()
    .prepare(
      "SELECT result_json AS resultJson FROM backtest_trade_management_results WHERE trade_uid=? ORDER BY policy_id",
    )
    .all(normalized)
    .map((item: any) => JSON.parse(item.resultJson));
  return {
    ...row,
    approachPressure: row.approachPressureJson
      ? JSON.parse(String(row.approachPressureJson))
      : undefined,
    zoneCorridors: row.zoneCorridorsJson
      ? JSON.parse(String(row.zoneCorridorsJson))
      : undefined,
    marketPath: row.marketPathJson
      ? JSON.parse(String(row.marketPathJson))
      : undefined,
    partialExits: row.partialExitsJson
      ? JSON.parse(String(row.partialExitsJson))
      : undefined,
    managementPolicyResults,
    approachPressureJson: undefined,
    zoneCorridorsJson: undefined,
    marketPathJson: undefined,
    config: JSON.parse(row.configJson),
    configJson: undefined,
  };
};
export const deleteBacktestRun = (id: string) => {
  const d = database();
  const run = d
    .prepare("SELECT id,status,label FROM backtest_runs WHERE id=?")
    .get(id) as
    { id: string; status: BacktestStatus; label: string } | undefined;
  if (!run) throw new Error("Backtest run not found.");
  if (run.status === "running" || run.status === "queued")
    throw new Error("Cancel this backtest before deleting it.");
  const removed = d.transaction(() => {
    const managementResults = d
      .prepare("DELETE FROM backtest_trade_management_results WHERE run_id=?")
      .run(id).changes;
    const trades = d
      .prepare("DELETE FROM backtest_trades WHERE run_id=?")
      .run(id).changes;
    const events = d
      .prepare("DELETE FROM backtest_events WHERE run_id=?")
      .run(id).changes;
    const runs = d
      .prepare("DELETE FROM backtest_runs WHERE id=?")
      .run(id).changes;
    return { runs, trades, events, managementResults };
  })();
  return { deleted: true, id, label: run.label, ...removed };
};
export const clearAllBacktestData = () => {
  const d = database();
  const active = d
    .prepare(
      `SELECT id FROM backtest_runs WHERE status IN ('queued','running') LIMIT 1`,
    )
    .get() as { id: string } | undefined;
  if (active)
    throw new Error(
      `Cancel active backtest ${active.id} before clearing the database.`,
    );
  return d.transaction(() => {
    const managementResults = d
      .prepare("DELETE FROM backtest_trade_management_results")
      .run().changes;
    const trades = d.prepare("DELETE FROM backtest_trades").run().changes;
    const events = d.prepare("DELETE FROM backtest_events").run().changes;
    const runs = d.prepare("DELETE FROM backtest_runs").run().changes;
    return { cleared: true, runs, trades, events, managementResults };
  })();
};
export const clearBacktestLeaderboard = () => {
  const d = database();
  return d.transaction(() => ({
    leaderboard: d.prepare("DELETE FROM backtest_leaderboard").run().changes,
    considered: d
      .prepare("DELETE FROM backtest_leaderboard_considered")
      .run().changes,
  }))();
};
export const updateBacktestRun = (
  id: string,
  fields: Record<string, unknown>,
) => {
  const allowed: Record<string, string> = {
    status: "status",
    label: "label",
    startedAt: "started_at",
    completedAt: "completed_at",
    progressPair: "progress_pair",
    progressDone: "progress_done",
    progressStage: "progress_stage",
    progressPercent: "progress_percent",
    workerPid: "worker_pid",
    heartbeatAt: "heartbeat_at",
    totalTrades: "total_trades",
    wins: "wins",
    losses: "losses",
    error: "error",
  };
  const entries = Object.entries(fields).filter(([key]) => allowed[key]);
  if (!entries.length) return;
  database()
    .prepare(
      `UPDATE backtest_runs SET ${entries.map(([key]) => `${allowed[key]}=@${key}`).join(",")} WHERE id=@id`,
    )
    .run({ id, ...Object.fromEntries(entries) });
};
export const addBacktestEvent = (
  runId: string,
  step: string,
  message: string,
  pair?: string,
  data?: unknown,
) =>
  database()
    .prepare(
      `
  INSERT INTO backtest_events(run_id,created_at,pair,step,message,data_json) VALUES(?,?,?,?,?,?)
`,
    )
    .run(
      runId,
      new Date().toISOString(),
      pair ?? null,
      step,
      message,
      data === undefined ? null : json(data),
    );
export const replaceBacktestTrades = (
  runId: string,
  trades: BacktestTradeInput[],
) => {
  const d = database();
  const insert = d.prepare(`INSERT INTO backtest_trades(
    trade_uid,run_id,pair,zone_id,zone_kind,direction,confirmation_time,zone_age_seconds,first_outside_time,outcome,outcome_time,exit_reason,
    entry,stop_loss,one_r,take_profit,score,score_json,prior_touches,max_penetration,available_rrr,confluence_count,trend,realized_r,approach_pressure_json,zone_corridors_json,market_path_json,partial_exits_json
  ) VALUES(@tradeId,@runId,@pair,@zoneId,@zoneKind,@direction,@confirmationTime,@zoneAgeSeconds,@firstOutsideTime,@outcome,@outcomeTime,@exitReason,
    @entry,@stopLoss,@oneR,@takeProfit,@score,@scoreJson,@priorTouches,@maxPenetration,@availableRrr,@confluenceCount,@trend,@realizedR,@approachPressureJson,@zoneCorridorsJson,@marketPathJson,@partialExitsJson)`);
  const insertManagement =
    d.prepare(`INSERT INTO backtest_trade_management_results(
    trade_uid,run_id,pair,confirmation_time,policy_id,policy_version,config_json,result_json,realized_r,exit_time,exit_reason,created_at
  ) VALUES(@tradeId,@runId,@pair,@confirmationTime,@policyId,@policyVersion,@configJson,@resultJson,@realizedR,@exitTime,@exitReason,@createdAt)`);
  d.transaction(() => {
    d.prepare(
      "DELETE FROM backtest_trade_management_results WHERE run_id=?",
    ).run(runId);
    d.prepare("DELETE FROM backtest_trades WHERE run_id=?").run(runId);
    for (const trade of trades) {
      const tradeId = stableBacktestTradeId(trade);
      insert.run({
        ...trade,
        tradeId,
        firstOutsideTime: trade.firstOutsideTime ?? null,
        scoreJson: json(trade.scoreJson),
        approachPressureJson: trade.approachPressure
          ? json(trade.approachPressure)
          : null,
        zoneCorridorsJson: trade.zoneCorridors
          ? json(trade.zoneCorridors)
          : null,
        marketPathJson: trade.marketPath ? json(trade.marketPath) : null,
        partialExitsJson: trade.partialExits?.length
          ? json(trade.partialExits)
          : null,
        availableRrr: Number.isFinite(trade.availableRrr)
          ? trade.availableRrr
          : null,
      });
      for (const result of trade.managementPolicyResults ?? [])
        insertManagement.run({
          tradeId,
          runId,
          pair: trade.pair,
          confirmationTime: trade.confirmationTime,
          policyId: result.policyId,
          policyVersion: result.policyVersion,
          configJson: json(result.policy),
          resultJson: json(result),
          realizedR: result.realizedR,
          exitTime: result.exitTime,
          exitReason: result.exitReason,
          createdAt: new Date().toISOString(),
        });
    }
  })();
};

export const recordBacktestLeaderboardCandidate = (runId: string) => {
  const d = database();
  const run = d
    .prepare(
      `SELECT id,run_uid AS runUid,label,config_json AS configJson,
      completed_at AS completedAt,status FROM backtest_runs WHERE id=?`,
    )
    .get(runId) as
    | {
        id: string;
        runUid: string;
        label: string;
        configJson: string;
        completedAt: string | null;
        status: BacktestStatus;
      }
    | undefined;
  if (!run || run.status !== "completed" || !run.completedAt) return false;
  const config = summaryConfig(run.configJson);
  if (!isGoldilocksComparisonDataset(config)) {
    d.prepare(
      `INSERT INTO backtest_leaderboard_considered(run_uid,evaluated_at)
      VALUES(?,?) ON CONFLICT(run_uid) DO UPDATE SET evaluated_at=excluded.evaluated_at`,
    ).run(run.runUid, new Date().toISOString());
    return false;
  }
  const runTrades = d
    .prepare(
      `SELECT id,pair,confirmation_time AS confirmationTime,outcome_time AS outcomeTime,
      score,entry,stop_loss AS stopLoss,outcome,realized_r AS realizedR
      FROM backtest_trades WHERE run_id=? ORDER BY confirmation_time`,
    )
    .all(runId) as PortfolioTrade[];
  const portfolio = simulateBacktestPortfolio(runTrades, {
    startingBalance: config.startingBalance ?? 1000,
    leverage: config.leverage ?? 30,
    riskProfile: config.riskProfile ?? "default",
    minimumScore: config.minimumScore,
  });
  const performance = calculateBacktestPerformance(
    portfolio.trades.map(({ trade, realizedR }) => ({
      confirmationTime: trade.confirmationTime,
      realizedR,
    })),
  );
  const metrics = {
    totalSignals: runTrades.length,
    acceptedTrades: portfolio.acceptedTrades,
    marginBlocked: portfolio.marginBlocked,
    expectancyR: performance.expectancyR,
    profitFactor:
      performance.profitFactor === Number.POSITIVE_INFINITY
        ? "infinite"
        : performance.profitFactor,
    netR: performance.netR,
    maxDrawdownR: performance.maxDrawdownR,
    accountReturn: portfolio.returnPercent,
    endingBalance: portfolio.ending,
  };
  d.transaction(() => {
    d.prepare(
      `INSERT INTO backtest_leaderboard(
        run_uid,source_run_id,label,config_json,completed_at,net_r,metrics_json,recorded_at
      ) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(run_uid) DO UPDATE SET
        source_run_id=excluded.source_run_id,label=excluded.label,
        config_json=excluded.config_json,completed_at=excluded.completed_at,
        net_r=excluded.net_r,metrics_json=excluded.metrics_json,
        recorded_at=excluded.recorded_at`,
    ).run(
      run.runUid,
      run.id,
      run.label,
      json(config),
      run.completedAt,
      performance.netR,
      json(metrics),
      new Date().toISOString(),
    );
    const ranked = selectTopBacktestLeaderboardRecords(
      d.prepare(
        `SELECT run_uid AS runUid,net_r AS netR,completed_at AS completedAt
        FROM backtest_leaderboard`,
      ).all() as Array<{
        runUid: string;
        netR: number;
        completedAt: string;
      }>,
    );
    const retained = new Set(ranked.map((record) => record.runUid));
    const remove = d.prepare(
      "DELETE FROM backtest_leaderboard WHERE run_uid=?",
    );
    const allIds = d
      .prepare("SELECT run_uid AS runUid FROM backtest_leaderboard")
      .all() as Array<{ runUid: string }>;
    for (const record of allIds)
      if (!retained.has(record.runUid)) remove.run(record.runUid);
    d.prepare(
      `INSERT INTO backtest_leaderboard_considered(run_uid,evaluated_at)
      VALUES(?,?) ON CONFLICT(run_uid) DO UPDATE SET evaluated_at=excluded.evaluated_at`,
    ).run(run.runUid, new Date().toISOString());
  })();
  return true;
};

const ensureBacktestLeaderboardSeeded = () => {
  const completed = database()
    .prepare(
      `SELECT r.id FROM backtest_runs r
      LEFT JOIN backtest_leaderboard_considered c ON c.run_uid=r.run_uid
      WHERE r.status='completed' AND c.run_uid IS NULL ORDER BY r.completed_at`,
    )
    .all() as Array<{ id: string }>;
  for (const run of completed) recordBacktestLeaderboardCandidate(run.id);
};

export const getBacktestLeaderboard = () => {
  ensureBacktestLeaderboardSeeded();
  return (
    database()
      .prepare(
        `SELECT run_uid AS runUid,source_run_id AS sourceRunId,label,
        config_json AS configJson,completed_at AS completedAt,net_r AS netR,
        metrics_json AS metricsJson,recorded_at AS recordedAt
        FROM backtest_leaderboard
        ORDER BY net_r DESC,completed_at DESC,run_uid ASC LIMIT 3`,
      )
      .all() as Array<Record<string, unknown>>
  ).map((row) => ({
    ...row,
    config: summaryConfig(row.configJson),
    metrics: JSON.parse(String(row.metricsJson)),
    configJson: undefined,
    metricsJson: undefined,
  }));
};
export const getBacktestRunUid = (runId: string) => {
  const row = database()
    .prepare(
      "SELECT run_uid AS runUid FROM backtest_runs WHERE id=? OR UPPER(run_uid)=UPPER(?) LIMIT 1",
    )
    .get(runId, runId) as { runUid?: string } | undefined;
  return row?.runUid;
};
export const resolveBacktestRunId = (identifier: string) => {
  const row = database()
    .prepare(
      "SELECT id FROM backtest_runs WHERE id=? OR UPPER(run_uid)=UPPER(?) LIMIT 1",
    )
    .get(identifier, identifier) as { id?: string } | undefined;
  return row?.id;
};
type BacktestDashboardRunRow = Record<string, unknown> & {
  id: string;
  configJson: string;
};
export const getBacktestDashboard = (runId?: string) => {
  const d = database();
  const recentRuns = d
    .prepare(
      `SELECT id,run_uid AS runUid,status,label,config_json AS configJson,created_at AS createdAt,started_at AS startedAt,
    completed_at AS completedAt,progress_pair AS progressPair,progress_done AS progressDone,progress_total AS progressTotal,
    progress_stage AS progressStage,progress_percent AS progressPercent,heartbeat_at AS heartbeatAt,
    total_trades AS totalTrades,wins,losses,error FROM backtest_runs ORDER BY created_at DESC LIMIT 30`,
    )
    .all() as BacktestDashboardRunRow[];
  const requestedRun=runId?d.prepare(`SELECT id,run_uid AS runUid,status,label,config_json AS configJson,created_at AS createdAt,started_at AS startedAt,
    completed_at AS completedAt,progress_pair AS progressPair,progress_done AS progressDone,progress_total AS progressTotal,
    progress_stage AS progressStage,progress_percent AS progressPercent,heartbeat_at AS heartbeatAt,
    total_trades AS totalTrades,wins,losses,error FROM backtest_runs WHERE id=? OR UPPER(run_uid)=UPPER(?) LIMIT 1`).get(runId,runId) as BacktestDashboardRunRow|undefined:undefined;
  const runs=includeRequestedCampaignRun(recentRuns,requestedRun,30);
  const selected=runId?String(requestedRun?.id??''):String(runs[0]?.id??'');
  const trades = selected
    ? d
        .prepare(
          `SELECT id,trade_uid AS tradeId,pair,zone_id AS zoneId,zone_kind AS zoneKind,direction,confirmation_time AS confirmationTime,zone_age_seconds AS zoneAgeSeconds,first_outside_time AS firstOutsideTime,
    outcome,outcome_time AS outcomeTime,exit_reason AS exitReason,realized_r AS realizedR,entry,stop_loss AS stopLoss,one_r AS oneR,take_profit AS takeProfit,
    score,score_json AS scoreJson,prior_touches AS priorTouches,max_penetration AS maxPenetration,available_rrr AS availableRrr,
    confluence_count AS confluenceCount,trend,approach_pressure_json AS approachPressureJson FROM backtest_trades WHERE run_id=? ORDER BY confirmation_time DESC`,
        )
        .all(selected)
        .map((row: any) => ({
          ...row,
          scoreDetail: row.scoreJson ? JSON.parse(row.scoreJson) : undefined,
          approachPressure: row.approachPressureJson
            ? JSON.parse(row.approachPressureJson)
            : undefined,
          scoreJson: undefined,
          approachPressureJson: undefined,
        }))
    : [];
  const pairs = selected
    ? d
        .prepare(
          `SELECT pair,COUNT(*) AS trades,SUM(outcome='WIN') AS wins,SUM(outcome='LOSS') AS losses,
    ROUND(100.0*SUM(outcome='WIN')/COUNT(*),1) AS winRate,ROUND(AVG(score),1) AS averageScore,
    SUM(outcome='WIN') AS protectedWins FROM backtest_trades WHERE run_id=? GROUP BY pair ORDER BY pair`,
        )
        .all(selected)
    : [];
  const completedState = d
    .prepare(
      `SELECT COUNT(*) AS runCount,COALESCE(MAX(completed_at),'') AS latest,
    COALESCE(SUM(total_trades),0) AS totalTrades FROM backtest_runs WHERE status='completed'`,
    )
    .get() as { runCount: number; latest: string; totalTrades: number };
  const completedCacheKey = `${completedState.runCount}|${completedState.latest}|${completedState.totalTrades}`;
  const runResults = runs.map((run) => {
    const config = summaryConfig(run.configJson);
    const runTrades = d
      .prepare(
        `SELECT id,pair,confirmation_time AS confirmationTime,outcome_time AS outcomeTime,
      score,entry,stop_loss AS stopLoss,outcome,realized_r AS realizedR
      FROM backtest_trades WHERE run_id=? ORDER BY confirmation_time`,
      )
      .all(run.id) as PortfolioTrade[];
    const portfolio = simulateBacktestPortfolio(runTrades, {
      startingBalance: config.startingBalance ?? 1000,
      leverage: config.leverage ?? 30,
      riskProfile: config.riskProfile ?? "default",
      minimumScore: config.minimumScore,
    });
    const performance = calculateBacktestPerformance(
      portfolio.trades.map(({ trade, realizedR }) => ({
        confirmationTime: trade.confirmationTime,
        realizedR,
      })),
    );
    const marginBlockReasons = Object.entries(
      portfolio.blockedTrades.reduce<Record<string, number>>(
        (counts, blocked) => {
          counts[blocked.reason] = (counts[blocked.reason] ?? 0) + 1;
          return counts;
        },
        {},
      ),
    )
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count);
    return {
      ...run,
      origin: getBacktestRunOrigin(run.configJson),
      config,
      configJson: undefined,
      ...performance,
      profitFactor:
        performance.profitFactor === Number.POSITIVE_INFINITY
          ? "infinite"
          : performance.profitFactor,
      endingBalance: portfolio.ending,
      netProfitLoss: portfolio.net,
      accountReturn: portfolio.returnPercent,
      maxDrawdownPercent: portfolio.maxDrawdown,
      peakMargin: portfolio.peakMargin,
      marginBlocked: portfolio.marginBlocked,
      marginBlockReasons,
      acceptedTrades: portfolio.acceptedTrades,
    };
  });
  let pairResults =
    completedPairResultsCache?.key === completedCacheKey
      ? completedPairResultsCache.rows
      : undefined;
  if (!pairResults) {
    pairResults = (
      d
        .prepare(
          `SELECT r.id AS runId,r.label,r.created_at AS createdAt,r.completed_at AS completedAt,
    r.config_json AS configJson,t.pair,COUNT(*) AS trades,SUM(t.outcome='WIN') AS wins,SUM(t.outcome='LOSS') AS losses,
    ROUND(100.0*SUM(t.outcome='WIN')/COUNT(*),1) AS winRate,ROUND(AVG(t.score),1) AS averageScore,
    SUM(t.outcome='WIN') AS protectedWins
    FROM backtest_runs r JOIN backtest_trades t ON t.run_id=r.id
    WHERE r.status='completed'
    GROUP BY r.id,t.pair
    ORDER BY winRate DESC,trades DESC,r.created_at DESC`,
        )
        .all() as Array<Record<string, unknown>>
    )
      .map((row) => {
        const config = summaryConfig(row.configJson);
        const runPortfolioTrades = d
          .prepare(
            `SELECT id,pair,confirmation_time AS confirmationTime,outcome_time AS outcomeTime,
        score,entry,stop_loss AS stopLoss,outcome,realized_r AS realizedR
        FROM backtest_trades WHERE run_id=? ORDER BY confirmation_time`,
          )
          .all(row.runId) as PortfolioTrade[];
        const portfolio = simulateBacktestPortfolio(runPortfolioTrades, {
          startingBalance: config.startingBalance ?? 1000,
          leverage: config.leverage ?? 30,
          riskProfile: config.riskProfile ?? "default",
          minimumScore: config.minimumScore,
        });
        const acceptedPairTrades = portfolio.trades.filter(
          ({ trade }) => trade.pair === row.pair,
        );
        const performance = calculateBacktestPerformance(
          acceptedPairTrades.map(({ trade, realizedR }) => ({
            confirmationTime: trade.confirmationTime,
            realizedR,
          })),
        );
        const acceptedScores = acceptedPairTrades.map(({ trade }) =>
          Number(trade.score),
        );
        return {
          ...row,
          config,
          configJson: undefined,
          maxDrawdown: Number(portfolio.maxDrawdown.toFixed(2)),
          trades: acceptedPairTrades.length,
          wins: performance.profitableTrades,
          losses: performance.losingTrades,
          winRate: performance.profitableRate,
          averageScore: acceptedScores.length
            ? acceptedScores.reduce((sum, score) => sum + score, 0) /
              acceptedScores.length
            : 0,
          ...performance,
        };
      })
      .sort(
        (left, right) =>
          Number(right.expectancyR ?? Number.NEGATIVE_INFINITY) -
            Number(left.expectancyR ?? Number.NEGATIVE_INFINITY) ||
          Number(right.profitFactor ?? Number.NEGATIVE_INFINITY) -
            Number(left.profitFactor ?? Number.NEGATIVE_INFINITY) ||
          Number(right.sampleTrades) - Number(left.sampleTrades),
      );
    completedPairResultsCache = { key: completedCacheKey, rows: pairResults };
  }
  const events = selected
    ? d
        .prepare(
          `SELECT id,created_at AS createdAt,pair,step,message FROM backtest_events WHERE run_id=? ORDER BY id DESC LIMIT 200`,
        )
        .all(selected)
    : [];
  return {
    runs: runs.map((run) => ({
      ...run,
      origin: getBacktestRunOrigin(run.configJson),
      config: summaryConfig(run.configJson),
      configJson: undefined,
    })),
    runResults,
    selectedRunId: selected,
    trades,
    pairs,
    pairResults,
    events,
    leaderboard: getBacktestLeaderboard(),
  };
};

/** One row per trade/policy combination for future model training. No chart images are stored. */
export const getBacktestTrainingData = (runId?: string) => {
  const rows = database()
    .prepare(
      `SELECT m.trade_uid AS tradeId,m.run_id AS runId,m.pair,m.confirmation_time AS confirmationTime,
    m.policy_id AS policyId,m.policy_version AS policyVersion,m.config_json AS policyJson,m.result_json AS resultJson,
    m.realized_r AS policyRealizedR,m.exit_time AS policyExitTime,m.exit_reason AS policyExitReason,
    t.zone_id AS zoneId,t.zone_kind AS zoneKind,t.direction,t.zone_age_seconds AS zoneAgeSeconds,t.first_outside_time AS firstOutsideTime,
    t.entry,t.stop_loss AS stopLoss,t.one_r AS oneR,t.take_profit AS takeProfit,t.score,t.score_json AS scoreJson,
    t.prior_touches AS priorTouches,t.max_penetration AS maxPenetration,t.available_rrr AS availableRrr,
    t.confluence_count AS confluenceCount,t.trend,t.approach_pressure_json AS approachPressureJson,
    t.zone_corridors_json AS zoneCorridorsJson,t.market_path_json AS marketPathJson,r.config_json AS runConfigJson
    FROM backtest_trade_management_results m
    JOIN backtest_trades t ON t.trade_uid=m.trade_uid JOIN backtest_runs r ON r.id=m.run_id
    WHERE (? IS NULL OR m.run_id=?) ORDER BY m.confirmation_time,m.policy_id`,
    )
    .all(runId ?? null, runId ?? null) as Array<Record<string, unknown>>;
  const parse = (value: unknown) =>
    value ? JSON.parse(String(value)) : undefined;
  return rows.map((row) => ({
    ...row,
    researchSchemaVersion: GOLDILOCKS_RESEARCH_SCHEMA_VERSION,
    policy: parse(row.policyJson),
    result: parse(row.resultJson),
    scoreDetail: parse(row.scoreJson),
    approachPressure: parse(row.approachPressureJson),
    zoneCorridors: parse(row.zoneCorridorsJson),
    marketPath: parse(row.marketPathJson),
    runConfig: parse(row.runConfigJson),
    policyJson: undefined,
    resultJson: undefined,
    scoreJson: undefined,
    approachPressureJson: undefined,
    zoneCorridorsJson: undefined,
    marketPathJson: undefined,
    runConfigJson: undefined,
    image: null,
    imageStatus: "deferred",
  }));
};

export const getBacktestTradeAudits = (runId: string) => {
  const parse = (value: unknown) =>
    value ? JSON.parse(String(value)) : undefined;
  return (
    database()
      .prepare(
        `SELECT trade_uid AS tradeId,pair,zone_kind AS zoneKind,direction,
    confirmation_time AS confirmationTime,outcome,outcome_time AS outcomeTime,exit_reason AS exitReason,
    realized_r AS realizedR,score,score_json AS scoreJson,prior_touches AS priorTouches,
    max_penetration AS maxPenetration,available_rrr AS availableRrr,confluence_count AS confluenceCount,
    trend,zone_age_seconds AS zoneAgeSeconds,approach_pressure_json AS approachPressureJson,
    zone_corridors_json AS zoneCorridorsJson,market_path_json AS marketPathJson
    FROM backtest_trades WHERE run_id=? ORDER BY confirmation_time`,
      )
      .all(runId) as Array<Record<string, unknown>>
  ).map((row) => ({
    ...row,
    scoreDetail: parse(row.scoreJson),
    approachPressure: parse(row.approachPressureJson),
    zoneCorridors: parse(row.zoneCorridorsJson),
    marketPath: parse(row.marketPathJson),
    scoreJson: undefined,
    approachPressureJson: undefined,
    zoneCorridorsJson: undefined,
    marketPathJson: undefined,
  }));
};
