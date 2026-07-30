import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  GOLDILOCKS_BACKTEST_GATE_DEFAULTS,GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS,
  GOLDILOCKS_SCORE_WEIGHTS,GOLDILOCKS_STRATEGY_VERSION,
} from '../utils/goldilocksConfig.ts';
import { GOLDILOCKS_DEFAULT_MANAGEMENT } from '../utils/goldilocksTradeManagement.ts';

test('recovery database preflight is read-only and accepts compatible demo trade recovery',async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'automation-readonly-preflight-'));
  process.env.TRADING_KEYS_DATA_DIRECTORY=data;
  const databasePath=path.join(data,'automation.sqlite');
  const database=new Database(databasePath);
  database.exec(`
    CREATE TABLE automation_strategy_versions(
      id TEXT PRIMARY KEY,source_run_uid TEXT NOT NULL,config_json TEXT NOT NULL,
      applied_at TEXT NOT NULL,previous_id TEXT,active INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE active_trades(
      pair TEXT PRIMARY KEY,trade_id TEXT NOT NULL,mode TEXT NOT NULL,opened_at TEXT NOT NULL);
  `);
  database.prepare(`INSERT INTO automation_strategy_versions
    (id,source_run_uid,config_json,applied_at,active)VALUES(?,?,?,?,1)`)
    .run('approved','GLR-APPROVED',JSON.stringify({
      timeframeProfile:'intraday',strategyVersion:GOLDILOCKS_STRATEGY_VERSION,
      confirmationMode:'close-through',tradeManager:GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,
      closeTradesBeforeWeekend:true,strategyTweaks:GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS,
      gateSettings:GOLDILOCKS_BACKTEST_GATE_DEFAULTS,scoreWeights:GOLDILOCKS_SCORE_WEIGHTS,
    }),new Date().toISOString());
  database.prepare(`INSERT INTO active_trades(pair,trade_id,mode,opened_at)VALUES(?,?,?,?)`)
    .run('EUR/USD','demo-trade','demo',new Date().toISOString());
  const schemaBefore=database.prepare(`SELECT name,sql FROM sqlite_master ORDER BY name`).all();
  database.close();
  const {validateAutomationDatabaseForRecovery}=await import('../utils/automationStore.ts');
  const result=validateAutomationDatabaseForRecovery();
  assert.equal(result.activeStrategies,1);
  assert.equal(result.activeTrades,1);
  assert.equal(result.incompatibleActiveTrades,0);
  const verify=new Database(databasePath,{readonly:true});
  assert.deepEqual(verify.prepare(`SELECT name,sql FROM sqlite_master ORDER BY name`).all(),schemaBefore);
  verify.close();
  assert.equal(fs.existsSync(`${databasePath}-wal`),false);
  assert.equal(fs.existsSync(`${databasePath}-shm`),false);
});
