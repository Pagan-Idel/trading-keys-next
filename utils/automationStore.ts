import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fixMojibake } from './textEncoding';
import { isRiskProfile, RISK_PROFILES, type RiskProfile } from './dynamicRisk';
import type { BacktestRunConfig } from './backtestStore';
import { GOLDILOCKS_STRATEGY_VERSION } from './goldilocksConfig';
import { GOLDILOCKS_DEFAULT_MANAGEMENT } from './goldilocksTradeManagement';
import { shouldPersistWorkerStatus,type WorkerStatusSnapshot } from './workerRuntime';
import type { ZoneLifecycleRecord } from './zoneLifecycle.ts';

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

export interface AppliedAutomationStrategy {
  id:string;
  sourceRunUid:string;
  appliedAt:string;
  previousId:string|null;
  config:BacktestRunConfig;
}

export interface AutomationZoneSnapshot {
  pair:string;mode:'live'|'demo';scannedAt:string;trend:'bullish'|'bearish'|'unknown';
  zoneTimeframe:string;confirmationTimeframe:string;
  zones:unknown[];candles:Record<string,unknown[]>;confirmationCount:number;
}

const DATA_DIRECTORY = path.resolve(process.env.TRADING_KEYS_DATA_DIRECTORY??path.join(process.cwd(), 'data'));
const DATABASE_PATH = path.join(DATA_DIRECTORY, 'automation.sqlite');

let database: Database.Database | null = null;
let lastRetentionRun = 0;
const configuredEventRetentionDays = Number(process.env.AUTOMATION_EVENT_RETENTION_DAYS ?? 3);
export const AUTOMATION_EVENT_RETENTION_DAYS = Number.isFinite(configuredEventRetentionDays)
  ? Math.min(30, Math.max(1, Math.floor(configuredEventRetentionDays)))
  : 3;
const EVENT_RETENTION_MS = AUTOMATION_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const WORKER_STATUS_HEARTBEAT_MS = 5 * 60 * 1000;

const runEventRetention = (db: Database.Database, force = false): void => {
  const now = Date.now();
  if (!force && now - lastRetentionRun < 60 * 60 * 1000) return;
  const cutoff = new Date(now - EVENT_RETENTION_MS).toISOString();
  db.prepare('DELETE FROM automation_events WHERE created_at < ?').run(cutoff);
  db.prepare(`DELETE FROM zone_lifecycle WHERE state IN ('EXECUTED','INVALIDATED','EXPIRED') AND updated_at < ?`)
    .run(now-740*24*60*60*1000);
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
    CREATE TABLE IF NOT EXISTS zone_lifecycle (
      zone_id TEXT NOT NULL,pair TEXT NOT NULL,state TEXT NOT NULL,reason TEXT,touch_key TEXT,updated_at INTEGER NOT NULL,
      PRIMARY KEY(pair,zone_id)
    );
    CREATE INDEX IF NOT EXISTS idx_zone_lifecycle_pair_state ON zone_lifecycle(pair,state,updated_at);
    CREATE TABLE IF NOT EXISTS automation_strategy_versions (
      id TEXT PRIMARY KEY,source_run_uid TEXT NOT NULL,config_json TEXT NOT NULL,
      applied_at TEXT NOT NULL,previous_id TEXT,active INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_automation_strategy_active
      ON automation_strategy_versions(active,applied_at DESC);
    CREATE TABLE IF NOT EXISTS automation_zone_snapshots (
      pair TEXT PRIMARY KEY,mode TEXT NOT NULL,scanned_at TEXT NOT NULL,payload_json TEXT NOT NULL
    );
  `);
  const zonePrimaryKey=(database.prepare('PRAGMA table_info(zone_lifecycle)').all() as Array<{name:string;pk:number}>)
    .filter(column=>column.pk>0).sort((a,b)=>a.pk-b.pk).map(column=>column.name).join(',');
  if(zonePrimaryKey!=='pair,zone_id')database.exec(`
    DROP INDEX IF EXISTS idx_zone_lifecycle_pair_state;
    ALTER TABLE zone_lifecycle RENAME TO zone_lifecycle_legacy;
    CREATE TABLE zone_lifecycle(zone_id TEXT NOT NULL,pair TEXT NOT NULL,state TEXT NOT NULL,reason TEXT,touch_key TEXT,updated_at INTEGER NOT NULL,PRIMARY KEY(pair,zone_id));
    INSERT OR IGNORE INTO zone_lifecycle SELECT zone_id,pair,state,reason,touch_key,updated_at FROM zone_lifecycle_legacy;
    DROP TABLE zone_lifecycle_legacy;
    CREATE INDEX idx_zone_lifecycle_pair_state ON zone_lifecycle(pair,state,updated_at);
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
  return database;
};

export const saveAutomationZoneSnapshot=(snapshot:AutomationZoneSnapshot)=>{
  getDatabase().prepare(`INSERT INTO automation_zone_snapshots(pair,mode,scanned_at,payload_json)
    VALUES(?,?,?,?) ON CONFLICT(pair) DO UPDATE SET mode=excluded.mode,scanned_at=excluded.scanned_at,payload_json=excluded.payload_json`)
    .run(snapshot.pair,snapshot.mode,snapshot.scannedAt,JSON.stringify(snapshot));
};

export const getAutomationZoneSnapshot=(pair:string):AutomationZoneSnapshot|undefined=>{
  const row=getDatabase().prepare('SELECT payload_json AS payloadJson FROM automation_zone_snapshots WHERE pair=?').get(pair) as {payloadJson:string}|undefined;
  return row?JSON.parse(row.payloadJson) as AutomationZoneSnapshot:undefined;
};

export const validateAutomationDatabaseForRecovery=():{
  activeStrategies:number;activeTrades:number;incompatibleActiveTrades:number;strategy:AppliedAutomationStrategy|null
}=>{
  let db:Database.Database;
  try{db=new Database(DATABASE_PATH,{readonly:true,fileMustExist:true})}
  catch{throw new Error('Automation database is unavailable for read-only recovery preflight.')}
  try{
    const activeStrategies=(db.prepare('SELECT COUNT(*) AS count FROM automation_strategy_versions WHERE active=1').get() as {count:number}).count;
    const activeTrades=(db.prepare('SELECT COUNT(*) AS count FROM active_trades').get() as {count:number}).count;
    const incompatibleActiveTrades=(db.prepare(`SELECT COUNT(*) AS count FROM active_trades
      WHERE mode!='demo' OR trade_id IS NULL OR pair IS NULL OR opened_at IS NULL`).get() as {count:number}).count;
    const row=db.prepare(`SELECT id,source_run_uid AS sourceRunUid,config_json AS configJson,
      applied_at AS appliedAt,previous_id AS previousId FROM automation_strategy_versions
      WHERE active=1 ORDER BY applied_at DESC LIMIT 1`).get() as
      {id:string;sourceRunUid:string;configJson:string;appliedAt:string;previousId:string|null}|undefined;
    let strategy:AppliedAutomationStrategy|null=null;
    if(row){
      try{strategy={...row,config:JSON.parse(row.configJson) as BacktestRunConfig}}catch{
        throw new Error('The active automation strategy configuration is malformed.');
      }
    }
    return {activeStrategies,activeTrades,incompatibleActiveTrades,strategy};
  }finally{db.close()}
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
  const previous = db.prepare('SELECT state, step, message, mode, pid, updated_at AS updatedAt FROM worker_status WHERE pair = ?')
    .get(pair) as WorkerStatusSnapshot|undefined;
  if(!shouldPersistWorkerStatus(previous,{state,step,message,mode,pid},Date.now(),WORKER_STATUS_HEARTBEAT_MS))return;
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
      score = COALESCE(excluded.score, active_trades.score),
      risk_profile = COALESCE(excluded.risk_profile, active_trades.risk_profile),
      risk_percentage = COALESCE(excluded.risk_percentage, active_trades.risk_percentage),
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

export const persistZoneLifecycle=(record:ZoneLifecycleRecord):void=>{
  getDatabase().prepare(`INSERT INTO zone_lifecycle(zone_id,pair,state,reason,touch_key,updated_at)
    VALUES(@zoneId,@pair,@state,@reason,@touchKey,@updatedAt)
    ON CONFLICT(pair,zone_id) DO UPDATE SET state=excluded.state,reason=excluded.reason,
      touch_key=excluded.touch_key,updated_at=excluded.updated_at`).run({...record,reason:record.reason??null,touchKey:record.touchKey??null});
};
export const getZoneLifecycle=(pair:string,zoneId:string):ZoneLifecycleRecord|undefined=>getDatabase().prepare(`SELECT zone_id AS zoneId,pair,state,reason,
  touch_key AS touchKey,updated_at AS updatedAt FROM zone_lifecycle WHERE pair=? AND zone_id=?`).get(pair,zoneId) as ZoneLifecycleRecord|undefined;

export const getActiveTrade = (pair: string): ActiveTradeInput | undefined =>
  getDatabase().prepare(`
    SELECT trade_id AS tradeId, pair, direction, entry, stop_loss AS stopLoss,
      take_profit AS takeProfit, mode, score, risk_profile AS riskProfile,
      risk_percentage AS riskPercentage
    FROM active_trades WHERE pair = ?
  `).get(pair) as ActiveTradeInput | undefined;

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

const defaultAutomationConfig=():BacktestRunConfig=>({
  pairs:['EUR/USD','GBP/USD','AUD/USD','USD/CAD','USD/CHF','NZD/USD','EUR/JPY','GBP/JPY','EUR/NZD'],
  lookbackDays:730,minimumScore:14,label:'Built-in automation strategy',
  strategyVersion:GOLDILOCKS_STRATEGY_VERSION,timeframeProfile:'intraday',
  riskProfile:'default',tradeManager:GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,
  confirmationMode:'close-through',closeTradesBeforeWeekend:true,
});

export const getAppliedAutomationStrategy=():AppliedAutomationStrategy=>{
  const db=getDatabase();
  let row=db.prepare(`SELECT id,source_run_uid AS sourceRunUid,config_json AS configJson,
    applied_at AS appliedAt,previous_id AS previousId FROM automation_strategy_versions
    WHERE active=1 ORDER BY applied_at DESC LIMIT 1`).get() as
    {id:string;sourceRunUid:string;configJson:string;appliedAt:string;previousId:string|null}|undefined;
  if(!row){
    const id=randomUUID(),appliedAt=new Date().toISOString();
    db.prepare(`INSERT INTO automation_strategy_versions(id,source_run_uid,config_json,applied_at,active)
      VALUES(?,?,?,?,1)`).run(id,'built-in',JSON.stringify(defaultAutomationConfig()),appliedAt);
    row={id,sourceRunUid:'built-in',configJson:JSON.stringify(defaultAutomationConfig()),appliedAt,previousId:null};
  }
  return {...row,config:JSON.parse(row.configJson) as BacktestRunConfig};
};

export const applyAutomationStrategy=(sourceRunUid:string,config:BacktestRunConfig)=>{
  const db=getDatabase(),current=getAppliedAutomationStrategy(),id=randomUUID(),appliedAt=new Date().toISOString();
  db.transaction(()=>{
    db.prepare('UPDATE automation_strategy_versions SET active=0 WHERE active=1').run();
    db.prepare(`INSERT INTO automation_strategy_versions(id,source_run_uid,config_json,applied_at,previous_id,active)
      VALUES(?,?,?,?,?,1)`).run(id,sourceRunUid,JSON.stringify(config),appliedAt,current.id);
  })();
  recordAutomationEvent({source:'strategy-config',step:'strategy_promoted',
    message:`Automation strategy moved to validated research run ${sourceRunUid}.`,
    data:{previousId:current.id,minimumScore:config.minimumScore,timeframeProfile:config.timeframeProfile}});
  return getAppliedAutomationStrategy();
};

export const rollbackAutomationStrategy=()=>{
  const db=getDatabase(),current=getAppliedAutomationStrategy();
  if(!current.previousId)throw new Error('No previous automation strategy is available.');
  db.transaction(()=>{
    db.prepare('UPDATE automation_strategy_versions SET active=0 WHERE active=1').run();
    db.prepare('UPDATE automation_strategy_versions SET active=1 WHERE id=?').run(current.previousId);
  })();
  recordAutomationEvent({source:'strategy-config',step:'strategy_rollback',
    message:`Automation strategy rolled back from ${current.sourceRunUid}.`});
  return getAppliedAutomationStrategy();
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

  return { events, workers, trades, activeTrades, summary, pairPerformance, riskConfig,
    retention:{eventDays:AUTOMATION_EVENT_RETENTION_DAYS},
    appliedStrategy:getAppliedAutomationStrategy() };
};
