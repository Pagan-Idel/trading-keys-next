import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export type BacktestStatus='queued'|'running'|'completed'|'failed'|'cancelled';
export interface BacktestRunConfig {pairs:string[];lookbackDays:number;minimumScore:number;label:string;}
export interface BacktestTradeInput {
  runId:string;pair:string;zoneId:string;zoneKind:string;direction:'BUY'|'SELL';confirmationTime:number;
  outcome:'WIN'|'LOSS';outcomeTime:number;exitReason:'one_r_protected'|'stop';entry:number;stopLoss:number;
  oneR:number;takeProfit:number;score:number;scoreJson:unknown;priorTouches:number;maxPenetration:number;
  availableRrr:number;confluenceCount:number;trend:string;
}

const dbPath=path.resolve(process.cwd(),'data','automation.sqlite');
let db:Database.Database|null=null;
const database=()=>{
  if(db)return db;
  fs.mkdirSync(path.dirname(dbPath),{recursive:true});
  db=new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS backtest_runs (
      id TEXT PRIMARY KEY,status TEXT NOT NULL,label TEXT NOT NULL,config_json TEXT NOT NULL,
      pairs_json TEXT NOT NULL,created_at TEXT NOT NULL,started_at TEXT,completed_at TEXT,
      progress_pair TEXT,progress_done INTEGER NOT NULL DEFAULT 0,progress_total INTEGER NOT NULL DEFAULT 0,
      total_trades INTEGER NOT NULL DEFAULT 0,wins INTEGER NOT NULL DEFAULT 0,losses INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS backtest_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,pair TEXT NOT NULL,zone_id TEXT NOT NULL,
      zone_kind TEXT NOT NULL,direction TEXT NOT NULL,confirmation_time INTEGER NOT NULL,
      outcome TEXT NOT NULL,outcome_time INTEGER NOT NULL,exit_reason TEXT NOT NULL,
      entry REAL NOT NULL,stop_loss REAL NOT NULL,one_r REAL NOT NULL,take_profit REAL NOT NULL,
      score INTEGER NOT NULL,score_json TEXT NOT NULL,prior_touches INTEGER NOT NULL,max_penetration REAL NOT NULL,
      available_rrr REAL,confluence_count INTEGER NOT NULL,trend TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES backtest_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_backtest_trades_run_pair ON backtest_trades(run_id,pair,confirmation_time);
    CREATE TABLE IF NOT EXISTS backtest_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,created_at TEXT NOT NULL,pair TEXT,
      step TEXT NOT NULL,message TEXT NOT NULL,data_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_backtest_events_run ON backtest_events(run_id,id DESC);
  `);
  const columns=new Set((db.prepare('PRAGMA table_info(backtest_runs)').all() as Array<{name:string}>).map(column=>column.name));
  if(!columns.has('worker_pid'))db.exec('ALTER TABLE backtest_runs ADD COLUMN worker_pid INTEGER');
  if(!columns.has('heartbeat_at'))db.exec('ALTER TABLE backtest_runs ADD COLUMN heartbeat_at TEXT');
  if(!columns.has('progress_stage'))db.exec('ALTER TABLE backtest_runs ADD COLUMN progress_stage TEXT');
  if(!columns.has('progress_percent'))db.exec('ALTER TABLE backtest_runs ADD COLUMN progress_percent REAL NOT NULL DEFAULT 0');
  return db;
};
const json=(value:unknown)=>JSON.stringify(value,(_key,item)=>Number.isFinite(item)?item:item===Infinity?'unlimited':item);

export const createBacktestRun=(id:string,config:BacktestRunConfig)=>database().prepare(`
  INSERT INTO backtest_runs(id,status,label,config_json,pairs_json,created_at,progress_total)
  VALUES(?, 'queued', ?, ?, ?, ?, ?)
`).run(id,config.label,json(config),json(config.pairs),new Date().toISOString(),config.pairs.length);
export const getActiveBacktestRun=()=>database().prepare(`SELECT id FROM backtest_runs WHERE status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`).get() as {id:string}|undefined;
export const getBacktestRuntime=(id:string)=>database().prepare(`SELECT id,status,worker_pid AS workerPid FROM backtest_runs WHERE id=?`).get(id) as {id:string;status:BacktestStatus;workerPid:number|null}|undefined;
export const updateBacktestRun=(id:string,fields:Record<string,unknown>)=>{
  const allowed:Record<string,string>={status:'status',label:'label',startedAt:'started_at',completedAt:'completed_at',progressPair:'progress_pair',progressDone:'progress_done',progressStage:'progress_stage',progressPercent:'progress_percent',workerPid:'worker_pid',heartbeatAt:'heartbeat_at',totalTrades:'total_trades',wins:'wins',losses:'losses',error:'error'};
  const entries=Object.entries(fields).filter(([key])=>allowed[key]);
  if(!entries.length)return;
  database().prepare(`UPDATE backtest_runs SET ${entries.map(([key])=>`${allowed[key]}=@${key}`).join(',')} WHERE id=@id`).run({id,...Object.fromEntries(entries)});
};
export const addBacktestEvent=(runId:string,step:string,message:string,pair?:string,data?:unknown)=>database().prepare(`
  INSERT INTO backtest_events(run_id,created_at,pair,step,message,data_json) VALUES(?,?,?,?,?,?)
`).run(runId,new Date().toISOString(),pair??null,step,message,data===undefined?null:json(data));
export const replaceBacktestTrades=(runId:string,trades:BacktestTradeInput[])=>{
  const d=database();
  const insert=d.prepare(`INSERT INTO backtest_trades(
    run_id,pair,zone_id,zone_kind,direction,confirmation_time,outcome,outcome_time,exit_reason,
    entry,stop_loss,one_r,take_profit,score,score_json,prior_touches,max_penetration,available_rrr,confluence_count,trend
  ) VALUES(@runId,@pair,@zoneId,@zoneKind,@direction,@confirmationTime,@outcome,@outcomeTime,@exitReason,
    @entry,@stopLoss,@oneR,@takeProfit,@score,@scoreJson,@priorTouches,@maxPenetration,@availableRrr,@confluenceCount,@trend)`);
  d.transaction(()=>{d.prepare('DELETE FROM backtest_trades WHERE run_id=?').run(runId);for(const trade of trades)insert.run({...trade,scoreJson:json(trade.scoreJson),availableRrr:Number.isFinite(trade.availableRrr)?trade.availableRrr:null});})();
};
export const getBacktestDashboard=(runId?:string)=>{
  const d=database();
  const runs=d.prepare(`SELECT id,status,label,config_json AS configJson,created_at AS createdAt,started_at AS startedAt,
    completed_at AS completedAt,progress_pair AS progressPair,progress_done AS progressDone,progress_total AS progressTotal,
    progress_stage AS progressStage,progress_percent AS progressPercent,heartbeat_at AS heartbeatAt,
    total_trades AS totalTrades,wins,losses,error FROM backtest_runs ORDER BY created_at DESC LIMIT 30`).all() as Array<Record<string,unknown>>;
  const selected=runId??String(runs[0]?.id??'');
  const trades=selected?d.prepare(`SELECT id,pair,zone_id AS zoneId,zone_kind AS zoneKind,direction,confirmation_time AS confirmationTime,
    outcome,outcome_time AS outcomeTime,exit_reason AS exitReason,entry,stop_loss AS stopLoss,one_r AS oneR,take_profit AS takeProfit,
    score,prior_touches AS priorTouches,max_penetration AS maxPenetration,available_rrr AS availableRrr,
    confluence_count AS confluenceCount,trend FROM backtest_trades WHERE run_id=? ORDER BY confirmation_time DESC LIMIT 1000`).all(selected):[];
  const pairs=selected?d.prepare(`SELECT pair,COUNT(*) AS trades,SUM(outcome='WIN') AS wins,SUM(outcome='LOSS') AS losses,
    ROUND(100.0*SUM(outcome='WIN')/COUNT(*),1) AS winRate,ROUND(AVG(score),1) AS averageScore,
    SUM(exit_reason='one_r_protected') AS protectedWins FROM backtest_trades WHERE run_id=? GROUP BY pair ORDER BY pair`).all(selected):[];
  const events=selected?d.prepare(`SELECT id,created_at AS createdAt,pair,step,message FROM backtest_events WHERE run_id=? ORDER BY id DESC LIMIT 200`).all(selected):[];
  return {runs:selected?runs.map(run=>({...run,config:JSON.parse(String(run.configJson)),configJson:undefined})):runs,selectedRunId:selected,trades,pairs,events};
};
