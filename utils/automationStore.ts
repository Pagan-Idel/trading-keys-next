import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fixMojibake } from './textEncoding';
import { isRiskProfile, RISK_PROFILES, type RiskProfile } from './dynamicRisk';

export type AutomationLevel = 'debug' | 'info' | 'warn' | 'error';
export type WorkerState = 'starting' | 'scanning' | 'waiting' | 'in_trade' | 'paused' | 'stopped' | 'error';

export interface AutomationEventInput {
  level?: AutomationLevel;
  message: string;
  pair?: string;
  source?: string;
  step?: string;
  data?: unknown;
}

export interface TradeManagementEventInput {
  tradeId:string;
  pair:string;
  mode:'live'|'demo';
  step:string;
  eventTime?:string;
  policyId?:string;
  data?:unknown;
}

export interface TradeRecordInput {
  tradeId: string;
  pair: string;
  entry: number;
  sl: number;
  tp: number;
  orderSide: 'BUY' | 'SELL';
  journalData: unknown;
  outcome: 'WIN' | 'LOSS';
  closedAt: string;
  realizedPL?: string;
  mode?: 'live' | 'demo';
  score?: number;
  riskProfile?: RiskProfile;
  riskPercentage?: number;
}

export interface ActiveTradeInput {
  tradeId: string;
  pair: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  stopLoss?: number;
  takeProfit?: number;
  mode: 'live' | 'demo';
  score?: number;
  riskProfile?: RiskProfile;
  riskPercentage?: number;
}

const DATA_DIRECTORY = path.resolve(process.cwd(), 'data');
const DATABASE_PATH = path.join(DATA_DIRECTORY, 'automation.sqlite');

let database: Database.Database | null = null;
let lastRetentionRun = 0;
const EVENT_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

const runEventRetention = (db: Database.Database, force = false): void => {
  const now = Date.now();
  if (!force && now - lastRetentionRun < 60 * 60 * 1000) return;
  const cutoff = new Date(now - EVENT_RETENTION_MS).toISOString();
  db.prepare('DELETE FROM automation_events WHERE created_at < ?').run(cutoff);
  db.pragma('wal_checkpoint(PASSIVE)');
  db.pragma('incremental_vacuum');
  lastRetentionRun = now;
};

const getDatabase = (): Database.Database => {
  if (database) return database;

  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  database = new Database(DATABASE_PATH);
  database.pragma('journal_mode = WAL');
  database.pragma('busy_timeout = 5000');
  database.exec(`
    CREATE TABLE IF NOT EXISTS automation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      level TEXT NOT NULL,
      pair TEXT,
      source TEXT,
      step TEXT,
      message TEXT NOT NULL,
      data_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_automation_events_created_at
      ON automation_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_automation_events_pair
      ON automation_events(pair, created_at DESC);

    CREATE TABLE IF NOT EXISTS worker_status (
      pair TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      step TEXT NOT NULL,
      message TEXT,
      mode TEXT NOT NULL,
      pid INTEGER,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trades (
      trade_id TEXT PRIMARY KEY,
      pair TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry REAL NOT NULL,
      stop_loss REAL NOT NULL,
      take_profit REAL NOT NULL,
      outcome TEXT NOT NULL,
      realized_pl REAL,
      mode TEXT NOT NULL,
      opened_at TEXT,
      closed_at TEXT NOT NULL,
      journal_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_trades_closed_at ON trades(closed_at DESC);

    CREATE TABLE IF NOT EXISTS active_trades (
      pair TEXT PRIMARY KEY,
      trade_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry REAL NOT NULL,
      stop_loss REAL,
      take_profit REAL,
      mode TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trade_management_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id TEXT NOT NULL,pair TEXT NOT NULL,mode TEXT NOT NULL,policy_id TEXT,
      event_time TEXT NOT NULL,received_at TEXT NOT NULL,step TEXT NOT NULL,data_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_trade_management_events_trade ON trade_management_events(trade_id,id);
    CREATE INDEX IF NOT EXISTS idx_trade_management_events_pair_time ON trade_management_events(pair,event_time);

    CREATE TABLE IF NOT EXISTS automation_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const ensureColumn = (table: string, column: string, definition: string) => {
    const columns = database!.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some(item => item.name === column)) database!.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  ensureColumn('trades', 'score', 'INTEGER');
  ensureColumn('trades', 'risk_profile', 'TEXT');
  ensureColumn('trades', 'risk_percentage', 'REAL');
  ensureColumn('active_trades', 'score', 'INTEGER');
  ensureColumn('active_trades', 'risk_profile', 'TEXT');
  ensureColumn('active_trades', 'risk_percentage', 'REAL');
  runEventRetention(database, true);
  return database;
};

const safeJson = (value: unknown): string | null => {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
};

export const recordAutomationEvent = (event: AutomationEventInput): void => {
  const db = getDatabase();
  runEventRetention(db);
  db.prepare(`
    INSERT INTO automation_events
      (created_at, level, pair, source, step, message, data_json)
    VALUES
      (@createdAt, @level, @pair, @source, @step, @message, @dataJson)
  `).run({
    createdAt: new Date().toISOString(),
    level: event.level ?? 'info',
    pair: event.pair ?? null,
    source: event.source ?? null,
    step: event.step ?? null,
    message: event.message,
    dataJson: safeJson(event.data),
  });
};

/** Permanent, append-only execution research ledger. Unlike automation_events, these rows are not retention-pruned. */
export const recordTradeManagementEvent=(event:TradeManagementEventInput):void=>{
  const now=new Date().toISOString();
  getDatabase().prepare(`INSERT INTO trade_management_events(
    trade_id,pair,mode,policy_id,event_time,received_at,step,data_json
  ) VALUES(@tradeId,@pair,@mode,@policyId,@eventTime,@receivedAt,@step,@dataJson)`).run({
    tradeId:event.tradeId,pair:event.pair,mode:event.mode,policyId:event.policyId??null,
    eventTime:event.eventTime??now,receivedAt:now,step:event.step,dataJson:safeJson(event.data),
  });
};

export const getTradeManagementEvents=(tradeId:string)=>{
  return (getDatabase().prepare(`SELECT id,trade_id AS tradeId,pair,mode,policy_id AS policyId,event_time AS eventTime,
    received_at AS receivedAt,step,data_json AS dataJson FROM trade_management_events WHERE trade_id=? ORDER BY id`).all(tradeId) as Array<Record<string,unknown>>)
    .map(row=>({...row,data:row.dataJson?JSON.parse(String(row.dataJson)):undefined,dataJson:undefined}));
};

export const updateWorkerStatus = (
  pair: string,
  state: WorkerState,
  step: string,
  message: string,
  mode: 'live' | 'demo',
  pid: number = process.pid,
): void => {
  const db = getDatabase();
  const previous = db.prepare('SELECT state, step FROM worker_status WHERE pair = ?').get(pair) as
    | { state: string; step: string }
    | undefined;
  db.prepare(`
    INSERT INTO worker_status (pair, state, step, message, mode, pid, updated_at)
    VALUES (@pair, @state, @step, @message, @mode, @pid, @updatedAt)
    ON CONFLICT(pair) DO UPDATE SET
      state = excluded.state,
      step = excluded.step,
      message = excluded.message,
      mode = excluded.mode,
      pid = excluded.pid,
      updated_at = excluded.updated_at
  `).run({ pair, state, step, message, mode, pid, updatedAt: new Date().toISOString() });
  if (!previous || previous.state !== state || previous.step !== step) {
    recordAutomationEvent({
      pair,
      source: 'worker-status',
      step,
      level: state === 'error' ? 'error' : state === 'paused' ? 'warn' : 'info',
      message,
      data: { state, mode },
    });
  }
};

export const saveTradeToDatabase = (trade: TradeRecordInput): void => {
  const openedAt =
    typeof trade.journalData === 'object' && trade.journalData !== null && 'timestamp' in trade.journalData
      ? String((trade.journalData as { timestamp?: unknown }).timestamp ?? '')
      : null;

  getDatabase().prepare(`
    INSERT INTO trades
      (trade_id, pair, direction, entry, stop_loss, take_profit, outcome,
       realized_pl, mode, opened_at, closed_at, journal_json, score, risk_profile, risk_percentage)
    VALUES
      (@tradeId, @pair, @direction, @entry, @stopLoss, @takeProfit, @outcome,
       @realizedPl, @mode, @openedAt, @closedAt, @journalJson, @score, @riskProfile, @riskPercentage)
    ON CONFLICT(trade_id) DO UPDATE SET
      outcome = excluded.outcome,
      realized_pl = excluded.realized_pl,
      closed_at = excluded.closed_at,
      journal_json = excluded.journal_json,
      score = excluded.score,
      risk_profile = excluded.risk_profile,
      risk_percentage = excluded.risk_percentage
  `).run({
    tradeId: trade.tradeId,
    pair: trade.pair,
    direction: trade.orderSide,
    entry: trade.entry,
    stopLoss: trade.sl,
    takeProfit: trade.tp,
    outcome: trade.outcome,
    realizedPl: trade.realizedPL === undefined ? null : Number(trade.realizedPL),
    mode: trade.mode ?? 'demo',
    openedAt,
    closedAt: trade.closedAt,
    journalJson: safeJson(trade.journalData),
    score: trade.score ?? null,
    riskProfile: trade.riskProfile ?? null,
    riskPercentage: trade.riskPercentage ?? null,
  });
};

export const setActiveTrade = (trade: ActiveTradeInput): void => {
  const now = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO active_trades
      (pair, trade_id, direction, entry, stop_loss, take_profit, mode, opened_at, updated_at, score, risk_profile, risk_percentage)
    VALUES
      (@pair, @tradeId, @direction, @entry, @stopLoss, @takeProfit, @mode, @now, @now, @score, @riskProfile, @riskPercentage)
    ON CONFLICT(pair) DO UPDATE SET
      trade_id = excluded.trade_id,
      direction = excluded.direction,
      entry = excluded.entry,
      stop_loss = excluded.stop_loss,
      take_profit = excluded.take_profit,
      mode = excluded.mode,
      score = excluded.score,
      risk_profile = excluded.risk_profile,
      risk_percentage = excluded.risk_percentage,
      updated_at = excluded.updated_at
  `).run({
    ...trade,
    stopLoss: trade.stopLoss ?? null,
    takeProfit: trade.takeProfit ?? null,
    now,
    score: trade.score ?? null,
    riskProfile: trade.riskProfile ?? null,
    riskPercentage: trade.riskPercentage ?? null,
  });
};

export const clearActiveTrade = (pair: string): void => {
  getDatabase().prepare('DELETE FROM active_trades WHERE pair = ?').run(pair);
};

export const clearAutomationEvents = (): void => {
  const db = getDatabase();
  db.prepare('DELETE FROM automation_events').run();
  db.pragma('wal_checkpoint(PASSIVE)');
};

export const getRiskProfile = (): RiskProfile => {
  const row = getDatabase().prepare(`SELECT value FROM automation_settings WHERE key = 'risk_profile'`).get() as { value?: string } | undefined;
  return isRiskProfile(row?.value) ? row.value : 'default';
};

export const setRiskProfile = (profile: RiskProfile): RiskProfile => {
  getDatabase().prepare(`
    INSERT INTO automation_settings (key, value, updated_at) VALUES ('risk_profile', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(profile, new Date().toISOString());
  recordAutomationEvent({ source: 'risk-manager', step: 'risk_profile_changed', message: `Dynamic risk profile changed to ${RISK_PROFILES[profile].label}.`, data: RISK_PROFILES[profile] });
  return profile;
};

export const getAutomationDashboard = (eventLimit = 120) => {
  const db = getDatabase();
  runEventRetention(db);
  const events = (db.prepare(`
    SELECT id, created_at AS createdAt, level, pair, source, step, message, data_json AS dataJson
    FROM automation_events
    ORDER BY id DESC
    LIMIT ?
  `).all(eventLimit) as Array<Record<string, unknown>>).map((event) => ({
    ...event,
    message: fixMojibake(String(event.message)),
  }));
  const workers = db.prepare(`
    SELECT pair, state, step, message, mode, pid, updated_at AS updatedAt
    FROM worker_status
    ORDER BY pair
  `).all();
  const trades = db.prepare(`
    SELECT trade_id AS tradeId, pair, direction, entry, stop_loss AS stopLoss,
      take_profit AS takeProfit, outcome, realized_pl AS realizedPL, mode,
      opened_at AS openedAt, closed_at AS closedAt, score, risk_profile AS riskProfile,
      risk_percentage AS riskPercentage,
      CAST(json_extract(journal_json, '$.goldilocks.confirmationTime') AS INTEGER) AS confirmationTime
    FROM trades
    ORDER BY closed_at DESC
    LIMIT 250
  `).all();
  const activeTrades = db.prepare(`
    SELECT pair, trade_id AS tradeId, direction, entry, stop_loss AS stopLoss,
      take_profit AS takeProfit, mode, opened_at AS openedAt, updated_at AS updatedAt,
      score, risk_profile AS riskProfile, risk_percentage AS riskPercentage
    FROM active_trades
    ORDER BY pair
  `).all();
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END), 0) AS losses,
      COALESCE(SUM(realized_pl), 0) AS realizedPL,
      COALESCE(SUM(CASE WHEN realized_pl > 0 THEN realized_pl ELSE 0 END), 0) AS grossProfit,
      COALESCE(ABS(SUM(CASE WHEN realized_pl < 0 THEN realized_pl ELSE 0 END)), 0) AS grossLoss
    FROM trades
  `).get() as { total: number; wins: number; losses: number; realizedPL: number; grossProfit: number; grossLoss: number };

  const pairPerformance = db.prepare(`
    SELECT pair, COUNT(*) AS trades,
      SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END) AS losses,
      COALESCE(SUM(realized_pl), 0) AS realizedPL,
      COALESCE(SUM(CASE WHEN realized_pl > 0 THEN realized_pl ELSE 0 END), 0) AS grossProfit,
      COALESCE(ABS(SUM(CASE WHEN realized_pl < 0 THEN realized_pl ELSE 0 END)), 0) AS grossLoss,
      AVG(risk_percentage) AS averageRisk
    FROM trades GROUP BY pair ORDER BY realizedPL DESC
  `).all();

  const riskProfile = getRiskProfile();
  const riskConfig = { selected: riskProfile, profiles: RISK_PROFILES };

  return { events, workers, trades, activeTrades, summary, pairPerformance, riskConfig };
};
