import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { BacktestRunConfig } from './backtestStore.ts';
import {rankAutoResearchResults} from './autoResearchRanking.ts';

export type AutoResearchStatus='queued'|'preparing'|'running'|'waiting'|'paused'|'completed'|'cancelled'|'failed';
export type AutoResearchTrialStatus='queued'|'running'|'completed'|'failed';

export interface AutoResearchCampaignConfig {
  label:string;
  continuous:boolean;
  configurations:BacktestRunConfig[];
  datasetEndTime?:number;
}

const databasePath=path.resolve(process.cwd(),'data','goldilocks-research.sqlite');
let connection:Database.Database|null=null;
const database=()=>{
  if(connection)return connection;
  fs.mkdirSync(path.dirname(databasePath),{recursive:true});
  connection=new Database(databasePath);
  connection.pragma('journal_mode = WAL');
  connection.pragma('synchronous = NORMAL');
  connection.pragma('busy_timeout = 10000');
  connection.exec(`
    CREATE TABLE IF NOT EXISTS research_campaigns (
      id TEXT PRIMARY KEY,status TEXT NOT NULL,label TEXT NOT NULL,config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,started_at TEXT,updated_at TEXT NOT NULL,completed_at TEXT,
      worker_pid INTEGER,current_trial_id TEXT,error TEXT
    );
    CREATE TABLE IF NOT EXISTS research_trials (
      id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,dataset_key TEXT NOT NULL,config_hash TEXT NOT NULL,
      config_json TEXT NOT NULL,status TEXT NOT NULL,backtest_run_id TEXT,metrics_json TEXT,error TEXT,
      created_at TEXT NOT NULL,started_at TEXT,completed_at TEXT,
      UNIQUE(campaign_id,dataset_key,config_hash),
      FOREIGN KEY(campaign_id) REFERENCES research_campaigns(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_research_trials_campaign_status ON research_trials(campaign_id,status,created_at);
    CREATE TABLE IF NOT EXISTS research_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,campaign_id TEXT NOT NULL,trial_id TEXT,created_at TEXT NOT NULL,
      step TEXT NOT NULL,message TEXT NOT NULL,data_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_research_events_campaign ON research_events(campaign_id,id DESC);
  `);
  const campaignColumns=new Set((connection.prepare('PRAGMA table_info(research_campaigns)').all() as Array<{name:string}>).map(column=>column.name));
  if(!campaignColumns.has('preparation_stage'))connection.exec('ALTER TABLE research_campaigns ADD COLUMN preparation_stage TEXT');
  if(!campaignColumns.has('preparation_done'))connection.exec('ALTER TABLE research_campaigns ADD COLUMN preparation_done INTEGER NOT NULL DEFAULT 0');
  if(!campaignColumns.has('preparation_total'))connection.exec('ALTER TABLE research_campaigns ADD COLUMN preparation_total INTEGER NOT NULL DEFAULT 0');
  if(!campaignColumns.has('dataset_key'))connection.exec('ALTER TABLE research_campaigns ADD COLUMN dataset_key TEXT');
  const trialColumns=new Set((connection.prepare('PRAGMA table_info(research_trials)').all() as Array<{name:string}>).map(column=>column.name));
  if(!trialColumns.has('queue_position'))connection.exec('ALTER TABLE research_trials ADD COLUMN queue_position INTEGER NOT NULL DEFAULT 0');
  connection.exec(`UPDATE research_trials SET queue_position=rowid WHERE queue_position=0`);
  return connection;
};

const now=()=>new Date().toISOString();
const json=(value:unknown)=>JSON.stringify(value,(_key,item)=>Number.isFinite(item)?item:item===Infinity?'unlimited':item);
const canonical=(value:unknown):string=>{
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value as Record<string,unknown>).sort(([left],[right])=>left.localeCompare(right)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};
export const researchConfigHash=(config:BacktestRunConfig)=>createHash('sha256').update(canonical(config)).digest('hex');

export const addAutoResearchEvent=(campaignId:string,step:string,message:string,trialId?:string,data?:unknown)=>database().prepare(`
  INSERT INTO research_events(campaign_id,trial_id,created_at,step,message,data_json) VALUES(?,?,?,?,?,?)
`).run(campaignId,trialId??null,now(),step,message,data===undefined?null:json(data));

export const getActiveAutoResearchCampaign=()=>database().prepare(`SELECT id,status FROM research_campaigns
  WHERE status IN ('queued','preparing','running','waiting','paused') ORDER BY created_at DESC LIMIT 1`).get() as {id:string;status:AutoResearchStatus}|undefined;

export const enqueueAutoResearchCycle=(campaignId:string,datasetKey:string,configurations:BacktestRunConfig[])=>{
  const db=database(),createdAt=Date.now();
  const insert=db.prepare(`INSERT OR IGNORE INTO research_trials(id,campaign_id,dataset_key,config_hash,config_json,status,created_at,queue_position)
    VALUES(?,?,?,?,?,'queued',?,?)`);
  const nextPosition=Number((db.prepare('SELECT COALESCE(MAX(queue_position),0)+1 AS value FROM research_trials WHERE campaign_id=?').get(campaignId) as {value:number}).value);
  let added=0;
  db.transaction(()=>{
    for(const [index,config] of configurations.entries()){
      const result=insert.run(randomUUID(),campaignId,datasetKey,researchConfigHash(config),json(config),new Date(createdAt+index).toISOString(),nextPosition+index);
      added+=result.changes;
    }
  })();
  return added;
};

export const replaceQueuedAutoResearchCycle=(campaignId:string,datasetKey:string,configurations:BacktestRunConfig[])=>{
  const db=database();
  const campaign=db.prepare('SELECT config_json AS configJson FROM research_campaigns WHERE id=?').get(campaignId) as {configJson:string}|undefined;
  if(!campaign)throw new Error('Auto research campaign not found.');
  const campaignConfig=JSON.parse(campaign.configJson) as AutoResearchCampaignConfig;
  campaignConfig.configurations=configurations;
  db.transaction(()=>{
    db.prepare(`DELETE FROM research_trials WHERE campaign_id=? AND status='queued'`).run(campaignId);
    db.prepare('UPDATE research_campaigns SET config_json=?,updated_at=? WHERE id=?').run(json(campaignConfig),now(),campaignId);
  })();
  const queued=enqueueAutoResearchCycle(campaignId,datasetKey,configurations);
  addAutoResearchEvent(campaignId,'queue_rebased',`QUEUE REBASED · ${queued} trials anchored to the current eligible leader.`,undefined,{datasetKey,queued});
  return queued;
};

export const createAutoResearchCampaign=(config:AutoResearchCampaignConfig,datasetKey:string,enqueue=true)=>{
  const active=getActiveAutoResearchCampaign();
  if(active)throw new Error(`Auto research campaign ${active.id} is already ${active.status}.`);
  const id=randomUUID(),createdAt=now();
  database().prepare(`INSERT INTO research_campaigns(id,status,label,config_json,created_at,updated_at)
    VALUES(?,'queued',?,?,?,?)`).run(id,config.label,json(config),createdAt,createdAt);
  const trials=enqueue?enqueueAutoResearchCycle(id,datasetKey,config.configurations):0;
  addAutoResearchEvent(id,'campaign_created',enqueue
    ?`AUTO RESEARCH CREATED · ${trials} unique configuration(s) queued for ${datasetKey}.`
    :'AUTO RESEARCH CREATED · preparing one sealed local candle dataset before trials are queued.',undefined,{datasetKey,trials,continuous:config.continuous});
  return {id,status:'queued' as const,trials};
};

export const updateAutoResearchCampaign=(id:string,fields:Record<string,unknown>)=>{
  const allowed:Record<string,string>={status:'status',startedAt:'started_at',updatedAt:'updated_at',completedAt:'completed_at',workerPid:'worker_pid',currentTrialId:'current_trial_id',error:'error',preparationStage:'preparation_stage',preparationDone:'preparation_done',preparationTotal:'preparation_total',datasetKey:'dataset_key'};
  const entries=Object.entries(fields).filter(([key])=>allowed[key]);
  if(!entries.length)return;
  const values={id,...Object.fromEntries(entries),updatedAt:fields.updatedAt??now()};
  if(!entries.some(([key])=>key==='updatedAt'))entries.push(['updatedAt',values.updatedAt]);
  database().prepare(`UPDATE research_campaigns SET ${entries.map(([key])=>`${allowed[key]}=@${key}`).join(',')} WHERE id=@id`).run(values);
};

export const getAutoResearchCampaignRuntime=(id:string)=>database().prepare(`SELECT id,status,worker_pid AS workerPid,current_trial_id AS currentTrialId,config_json AS configJson
  FROM research_campaigns WHERE id=?`).get(id) as {id:string;status:AutoResearchStatus;workerPid:number|null;currentTrialId:string|null;configJson:string}|undefined;

export const claimNextAutoResearchTrial=(campaignId:string)=>{
  const db=database(),startedAt=now();
  return db.transaction(()=>{
    const row=db.prepare(`SELECT id,config_json AS configJson,dataset_key AS datasetKey FROM research_trials
      WHERE campaign_id=? AND status='queued' ORDER BY queue_position,created_at,id LIMIT 1`).get(campaignId) as {id:string;configJson:string;datasetKey:string}|undefined;
    if(!row)return undefined;
    db.prepare(`UPDATE research_trials SET status='running',started_at=? WHERE id=?`).run(startedAt,row.id);
    updateAutoResearchCampaign(campaignId,{currentTrialId:row.id,status:'running'});
    return {...row,config:JSON.parse(row.configJson) as BacktestRunConfig};
  })();
};

export const completeAutoResearchTrial=(id:string,backtestRunId:string,metrics:unknown)=>database().prepare(`UPDATE research_trials
  SET status='completed',backtest_run_id=?,metrics_json=?,completed_at=? WHERE id=?`).run(backtestRunId,json(metrics),now(),id);

export const linkAutoResearchTrialBacktest=(id:string,backtestRunId:string)=>{
  const result=database().prepare(`UPDATE research_trials SET backtest_run_id=? WHERE id=? AND status='running'`).run(backtestRunId,id);
  if(!result.changes)throw new Error('Only a running research campaign trial can be linked to a backtest campaign run.');
  return {id,backtestRunId};
};

export const failAutoResearchTrial=(id:string,error:string,backtestRunId?:string)=>database().prepare(`UPDATE research_trials
  SET status='failed',backtest_run_id=?,error=?,completed_at=? WHERE id=?`).run(backtestRunId??null,error,now(),id);

export const resetInterruptedAutoResearchTrials=(campaignId:string)=>database().prepare(`UPDATE research_trials
  SET status='queued',started_at=NULL,error='Recovered after interrupted worker.' WHERE campaign_id=? AND status='running'`).run(campaignId).changes;

export const getAutoResearchDashboard=(campaignId?:string)=>{
  const db=database();
  const campaigns=(db.prepare(`SELECT id,status,label,created_at AS createdAt,started_at AS startedAt,updated_at AS updatedAt,
    completed_at AS completedAt,worker_pid AS workerPid,current_trial_id AS currentTrialId,error,
    preparation_stage AS preparationStage,preparation_done AS preparationDone,preparation_total AS preparationTotal,dataset_key AS datasetKey
    FROM research_campaigns ORDER BY created_at DESC LIMIT 20`).all() as Array<Record<string,unknown>>);
  const selected=campaignId??String(campaigns[0]?.id??'');
  const trials=selected?(db.prepare(`SELECT id,dataset_key AS datasetKey,status,backtest_run_id AS backtestRunId,config_json AS configJson,
    metrics_json AS metricsJson,error,created_at AS createdAt,started_at AS startedAt,completed_at AS completedAt,queue_position AS queuePosition
    FROM research_trials WHERE campaign_id=? ORDER BY queue_position,created_at,id`).all(selected) as Array<Record<string,unknown>>).map(row=>{
      const summaryConfig=JSON.parse(String(row.configJson)) as BacktestRunConfig;
      delete summaryConfig.researchManifest;
      return {...row,config:summaryConfig,metrics:row.metricsJson?JSON.parse(String(row.metricsJson)):null,configJson:undefined,metricsJson:undefined};
    }):[];
  const counts=selected?db.prepare(`SELECT status,COUNT(*) AS count FROM research_trials WHERE campaign_id=? GROUP BY status`).all(selected):[];
  const events=selected?db.prepare(`SELECT id,trial_id AS trialId,created_at AS createdAt,step,message,data_json AS dataJson
    FROM research_events WHERE campaign_id=? ORDER BY id DESC LIMIT 200`).all(selected).map((row:any)=>({...row,data:row.dataJson?JSON.parse(row.dataJson):undefined,dataJson:undefined})):[];
  return {campaigns,selectedCampaignId:selected,trials,counts,events};
};

export const getTopAutoResearchResults=(limit=3)=>{
  const rows=database().prepare(`SELECT config_json AS configJson,metrics_json AS metricsJson,
    id,backtest_run_id AS backtestRunId,completed_at AS completedAt,dataset_key AS datasetKey,config_hash AS configHash
    FROM research_trials WHERE status='completed' AND metrics_json IS NOT NULL`).all() as Array<{id:string;backtestRunId:string;completedAt:string;datasetKey:string;configHash:string;configJson:string;metricsJson:string}>;
  return rankAutoResearchResults(rows.map(row=>({
    id:row.id,backtestRunId:row.backtestRunId,completedAt:row.completedAt,datasetKey:row.datasetKey,configHash:row.configHash,
    config:JSON.parse(row.configJson) as BacktestRunConfig,
    metrics:JSON.parse(row.metricsJson) as {official?:{sampleTrades?:number;expectancyR?:number|null;netR?:number;maxDrawdownR?:number}},
  })).filter(row=>Number(row.metrics.official?.sampleTrades??0)>=100))
    .slice(0,Math.max(0,limit));
};

export const getBestAutoResearchResult=()=>getTopAutoResearchResults(1)[0];

export const getBestAutoResearchConfiguration=()=>getBestAutoResearchResult()?.config;

export const updateQueuedResearchTrial=(campaignId:string,trialId:string,config:BacktestRunConfig)=>{
  const result=database().prepare(`UPDATE research_trials SET config_json=?,config_hash=?
    WHERE id=? AND campaign_id=? AND status='queued'`).run(json(config),researchConfigHash(config),trialId,campaignId);
  if(!result.changes)throw new Error('Only queued research configurations can be edited.');
  addAutoResearchEvent(campaignId,'trial_config_updated',`QUEUE UPDATED · ${config.label}.`,trialId,{config});
  return {id:trialId,status:'queued' as const};
};

export const removeQueuedResearchTrial=(campaignId:string,trialId:string)=>{
  const result=database().prepare(`DELETE FROM research_trials WHERE id=? AND campaign_id=? AND status='queued'`).run(trialId,campaignId);
  if(!result.changes)throw new Error('Only queued research configurations can be removed.');
  addAutoResearchEvent(campaignId,'trial_removed','QUEUE UPDATED · queued configuration removed.',trialId);
  return {id:trialId,removed:true};
};

export const moveQueuedResearchTrial=(campaignId:string,trialId:string,direction:'up'|'down')=>{
  const db=database();
  db.transaction(()=>{
    const current=db.prepare(`SELECT id,queue_position AS position FROM research_trials WHERE id=? AND campaign_id=? AND status='queued'`).get(trialId,campaignId) as {id:string;position:number}|undefined;
    if(!current)throw new Error('Only queued research configurations can be moved.');
    const operator=direction==='up'?'<':'>';
    const order=direction==='up'?'DESC':'ASC';
    const neighbor=db.prepare(`SELECT id,queue_position AS position FROM research_trials WHERE campaign_id=? AND status='queued' AND queue_position ${operator} ? ORDER BY queue_position ${order} LIMIT 1`).get(campaignId,current.position) as {id:string;position:number}|undefined;
    if(!neighbor)return;
    db.prepare('UPDATE research_trials SET queue_position=? WHERE id=?').run(neighbor.position,current.id);
    db.prepare('UPDATE research_trials SET queue_position=? WHERE id=?').run(current.position,neighbor.id);
  })();
  addAutoResearchEvent(campaignId,'trial_moved',`QUEUE UPDATED · configuration moved ${direction}.`,trialId);
  return {id:trialId,direction};
};

export type AutoResearchTrialDetail={
  id:string;campaignId:string;campaignLabel:string;datasetKey:string;status:string;
  backtestRunId?:string|null;config:any;metrics:any;error?:string|null;
  createdAt:string;startedAt?:string|null;completedAt?:string|null;
};

export type AutoResearchCampaignSearch={
  kind:'research-campaign'|'research-trial'|'research-run';
  id:string;label:string;status:string;matchedTrialId?:string;
  runs:Array<{trialId:string;status:string;backtestRunId:string|null;label:string}>;
};

export const findAutoResearchCampaignSearch=(identifier:string,resolvedBacktestRunId?:string):AutoResearchCampaignSearch|undefined=>{
  const db=database(),query=identifier.trim();
  if(!query)return undefined;
  const directCampaign=db.prepare(`SELECT id,label,status FROM research_campaigns WHERE LOWER(id)=LOWER(?) LIMIT 1`).get(query) as {id:string;label:string;status:string}|undefined;
  const matchedTrial=directCampaign?undefined:db.prepare(`SELECT id,campaign_id AS campaignId FROM research_trials
    WHERE LOWER(id)=LOWER(?) OR backtest_run_id=? OR backtest_run_id=? LIMIT 1`).get(query,query,resolvedBacktestRunId??'') as {id:string;campaignId:string}|undefined;
  const campaign=directCampaign??(matchedTrial?db.prepare(`SELECT id,label,status FROM research_campaigns WHERE id=?`).get(matchedTrial.campaignId) as {id:string;label:string;status:string}|undefined:undefined);
  if(!campaign)return undefined;
  const rows=db.prepare(`SELECT id,status,backtest_run_id AS backtestRunId,config_json AS configJson FROM research_trials
    WHERE campaign_id=? ORDER BY queue_position,created_at,id`).all(campaign.id) as Array<{id:string;status:string;backtestRunId:string|null;configJson:string}>;
  const kind=directCampaign?'research-campaign':matchedTrial?.id.toLowerCase()===query.toLowerCase()?'research-trial':'research-run';
  return {
    kind,id:campaign.id,label:campaign.label,status:campaign.status,matchedTrialId:matchedTrial?.id,
    runs:rows.map(row=>({trialId:row.id,status:row.status,backtestRunId:row.backtestRunId,label:String((JSON.parse(row.configJson) as BacktestRunConfig).label??'Research campaign run')})),
  };
};

export const getAutoResearchTrial=(trialId:string):AutoResearchTrialDetail|undefined=>{
  const row=database().prepare(`SELECT t.id,t.campaign_id AS campaignId,t.dataset_key AS datasetKey,t.status,
    t.backtest_run_id AS backtestRunId,t.config_json AS configJson,t.metrics_json AS metricsJson,t.error,
    t.created_at AS createdAt,t.started_at AS startedAt,t.completed_at AS completedAt,c.label AS campaignLabel
    FROM research_trials t JOIN research_campaigns c ON c.id=t.campaign_id WHERE t.id=?`).get(trialId) as Record<string,unknown>|undefined;
  if(!row)return undefined;
  const {configJson,metricsJson,...fields}=row;
  return {...fields,config:JSON.parse(String(configJson)),metrics:metricsJson?JSON.parse(String(metricsJson)):null} as AutoResearchTrialDetail;
};

export const cancelAutoResearchCampaign=(id:string)=>{
  const runtime=getAutoResearchCampaignRuntime(id);
  if(!runtime)throw new Error('Auto research campaign not found.');
  updateAutoResearchCampaign(id,{status:'cancelled',completedAt:now(),workerPid:null,currentTrialId:null,error:'Cancelled by user.'});
  addAutoResearchEvent(id,'campaign_cancelled','AUTO RESEARCH CANCELLED · no live strategy settings were changed.');
  return {id,status:'cancelled' as const,workerPid:runtime.workerPid};
};
