import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fixMojibake } from './textEncoding';

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
}

export interface ActiveTradeInput {
  tradeId: string;
  pair: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  stopLoss?: number;
  takeProfit?: number;
  mode: 'live' | 'demo';
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
  `);
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
       realized_pl, mode, opened_at, closed_at, journal_json)
    VALUES
      (@tradeId, @pair, @direction, @entry, @stopLoss, @takeProfit, @outcome,
       @realizedPl, @mode, @openedAt, @closedAt, @journalJson)
    ON CONFLICT(trade_id) DO UPDATE SET
      outcome = excluded.outcome,
      realized_pl = excluded.realized_pl,
      closed_at = excluded.closed_at,
      journal_json = excluded.journal_json
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
  });
};

export const setActiveTrade = (trade: ActiveTradeInput): void => {
  const now = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO active_trades
      (pair, trade_id, direction, entry, stop_loss, take_profit, mode, opened_at, updated_at)
    VALUES
      (@pair, @tradeId, @direction, @entry, @stopLoss, @takeProfit, @mode, @now, @now)
    ON CONFLICT(pair) DO UPDATE SET
      trade_id = excluded.trade_id,
      direction = excluded.direction,
      entry = excluded.entry,
      stop_loss = excluded.stop_loss,
      take_profit = excluded.take_profit,
      mode = excluded.mode,
      updated_at = excluded.updated_at
  `).run({
    ...trade,
    stopLoss: trade.stopLoss ?? null,
    takeProfit: trade.takeProfit ?? null,
    now,
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
      opened_at AS openedAt, closed_at AS closedAt
    FROM trades
    ORDER BY closed_at DESC
    LIMIT 250
  `).all();
  const activeTrades = db.prepare(`
    SELECT pair, trade_id AS tradeId, direction, entry, stop_loss AS stopLoss,
      take_profit AS takeProfit, mode, opened_at AS openedAt, updated_at AS updatedAt
    FROM active_trades
    ORDER BY pair
  `).all();
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END) AS losses,
      COALESCE(SUM(realized_pl), 0) AS realizedPL
    FROM trades
  `).get() as { total: number; wins: number; losses: number; realizedPL: number };

  return { events, workers, trades, activeTrades, summary };
};
