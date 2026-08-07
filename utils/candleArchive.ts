import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { gunzipSync } from 'zlib';
import type { Candle } from './swingLabeler.ts';
import { normalizePairKeyUnderscore, tfToSeconds } from './shared.ts';

export interface CandleArchiveKey {pair:string;timeframe:string;mode:'live'|'demo'}
export interface CandleCoverageRange {startTime:number;endTime:number}

const RUNTIME_DATA_DIRECTORY=path.resolve(process.env.TRADING_KEYS_DATA_DIRECTORY??path.join(process.cwd(),'data'));
const DATABASE_PATH=path.join(RUNTIME_DATA_DIRECTORY,'candle-history.sqlite');
const LEGACY_DIRECTORY=path.join(RUNTIME_DATA_DIRECTORY,'candle-history');
export const CANDLE_ARCHIVE_MAX_BYTES=Math.max(256*1024*1024,Number(process.env.CANDLE_ARCHIVE_MAX_BYTES)||5*1024*1024*1024);
export const CANDLE_ARCHIVE_HIGH_WATER_BYTES=Math.floor(CANDLE_ARCHIVE_MAX_BYTES*0.95);
let archiveDatabase:Database.Database|null=null;

const fileSize=(filePath:string)=>{try{return fs.statSync(filePath).size}catch{return 0}};
const directorySize=(directory:string):number=>{
  try{return fs.readdirSync(directory,{withFileTypes:true}).reduce((sum,entry)=>sum+(entry.isDirectory()?directorySize(path.join(directory,entry.name)):fileSize(path.join(directory,entry.name))),0)}catch{return 0}
};

export const getCandleArchiveStorageUsage=()=>{
  const sqliteBytes=fileSize(DATABASE_PATH);
  const walBytes=fileSize(`${DATABASE_PATH}-wal`);
  const shmBytes=fileSize(`${DATABASE_PATH}-shm`);
  const legacyBytes=directorySize(LEGACY_DIRECTORY);
  const usedBytes=sqliteBytes+walBytes+shmBytes+legacyBytes;
  return {usedBytes,maxBytes:CANDLE_ARCHIVE_MAX_BYTES,highWaterBytes:CANDLE_ARCHIVE_HIGH_WATER_BYTES,remainingBytes:Math.max(0,CANDLE_ARCHIVE_MAX_BYTES-usedBytes),percent:CANDLE_ARCHIVE_MAX_BYTES?usedBytes/CANDLE_ARCHIVE_MAX_BYTES*100:100,sqliteBytes,walBytes,shmBytes,legacyBytes};
};

export const checkpointCandleArchive=()=>{
  if(!archiveDatabase)return getCandleArchiveStorageUsage();
  archiveDatabase.pragma('wal_checkpoint(TRUNCATE)');
  return getCandleArchiveStorageUsage();
};

const database=()=>{
  if(archiveDatabase)return archiveDatabase;
  fs.mkdirSync(path.dirname(DATABASE_PATH),{recursive:true});
  archiveDatabase=new Database(DATABASE_PATH);
  archiveDatabase.pragma('journal_mode = WAL');
  archiveDatabase.pragma('synchronous = NORMAL');
  archiveDatabase.pragma('busy_timeout = 10000');
  archiveDatabase.exec(`
    CREATE TABLE IF NOT EXISTS historical_candles (
      mode TEXT NOT NULL,pair TEXT NOT NULL,timeframe TEXT NOT NULL,time INTEGER NOT NULL,time_text TEXT NOT NULL,
      open REAL NOT NULL,high REAL NOT NULL,low REAL NOT NULL,close REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'OANDA_MID',fetched_at TEXT NOT NULL,
      PRIMARY KEY(mode,pair,timeframe,time)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS candle_archive_coverage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,mode TEXT NOT NULL,pair TEXT NOT NULL,timeframe TEXT NOT NULL,
      start_time INTEGER NOT NULL,end_time INTEGER NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_candle_archive_coverage_lookup ON candle_archive_coverage(mode,pair,timeframe,start_time,end_time);
    CREATE TABLE IF NOT EXISTS candle_archive_imports (
      source_path TEXT PRIMARY KEY,size_bytes INTEGER NOT NULL,modified_ms INTEGER NOT NULL,
      candle_count INTEGER NOT NULL,imported_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS candle_sync_gaps (
      mode TEXT NOT NULL,pair TEXT NOT NULL,timeframe TEXT NOT NULL,start_time INTEGER NOT NULL,end_time INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 1,last_error TEXT,updated_at TEXT NOT NULL,
      PRIMARY KEY(mode,pair,timeframe,start_time)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS candle_no_print_intervals (
      mode TEXT NOT NULL,pair TEXT NOT NULL,timeframe TEXT NOT NULL,start_time INTEGER NOT NULL,end_time INTEGER NOT NULL,
      source TEXT NOT NULL,confirmed_at TEXT NOT NULL,
      PRIMARY KEY(mode,pair,timeframe,start_time)
    ) WITHOUT ROWID;
  `);
  // The WITHOUT ROWID primary key already covers mode/pair/timeframe/time lookups.
  // Remove the older duplicate index to keep large M1 archives smaller and writes faster.
  archiveDatabase.exec('DROP INDEX IF EXISTS idx_historical_candles_lookup');
  return archiveDatabase;
};

const normalized=(key:CandleArchiveKey)=>({
  mode:key.mode,pair:normalizePairKeyUnderscore(key.pair),timeframe:key.timeframe.toUpperCase(),
});
const toEpochSeconds=(time:string)=>Math.floor(Date.parse(time)/1000);

export const mergeCandleCoverageRanges=(ranges:CandleCoverageRange[],adjacencySeconds=0):CandleCoverageRange[]=>{
  const sorted=ranges
    .filter(range=>Number.isFinite(range.startTime)&&Number.isFinite(range.endTime)&&range.endTime>=range.startTime)
    .sort((left,right)=>left.startTime-right.startTime||left.endTime-right.endTime);
  const merged:CandleCoverageRange[]=[];
  for(const range of sorted){
    const previous=merged.at(-1);
    if(previous&&range.startTime<=previous.endTime+Math.max(0,adjacencySeconds))previous.endTime=Math.max(previous.endTime,range.endTime);
    else merged.push({...range});
  }
  return merged;
};

export const readArchivedCandles=(key:CandleArchiveKey,startTime:number,endTime:number):Candle[]=>{
  const identity=normalized(key);
  return (database().prepare(`SELECT time_text AS time,open,high,low,close FROM historical_candles
    WHERE mode=@mode AND pair=@pair AND timeframe=@timeframe AND time>=@startTime AND time<@endTime ORDER BY time`).all({
      ...identity,startTime:Math.floor(startTime),endTime:Math.floor(endTime),
    }) as Candle[]).map((candle,candleIndex)=>({...candle,candleIndex}));
};

export const getArchivedCandleBounds=(key:CandleArchiveKey)=>{
  const row=database().prepare(`SELECT MIN(time) AS startTime,MAX(time) AS endTime,COUNT(*) AS candleCount
    FROM historical_candles WHERE mode=@mode AND pair=@pair AND timeframe=@timeframe`).get(normalized(key)) as {startTime:number|null;endTime:number|null;candleCount:number};
  return {startTime:row.startTime,endTime:row.endTime,candleCount:Number(row.candleCount)};
};

export const readArchivedCandlePage=(
  key:CandleArchiveKey,
  options:{before?:number;after?:number;limit?:number}={},
):Candle[]=>{
  const identity=normalized(key);
  const limit=Math.max(1,Math.min(2_000,Math.floor(options.limit??1_000)));
  const before=Number(options.before),after=Number(options.after);
  const rows=Number.isFinite(before)
    ? database().prepare(`SELECT time_text AS time,open,high,low,close FROM historical_candles
        WHERE mode=@mode AND pair=@pair AND timeframe=@timeframe AND time<@before
        ORDER BY time DESC LIMIT @limit`).all({...identity,before:Math.floor(before),limit})
    : Number.isFinite(after)
      ? database().prepare(`SELECT time_text AS time,open,high,low,close FROM historical_candles
          WHERE mode=@mode AND pair=@pair AND timeframe=@timeframe AND time>@after
          ORDER BY time ASC LIMIT @limit`).all({...identity,after:Math.floor(after),limit})
      : [];
  const candles=(rows as Omit<Candle,'candleIndex'>[]);
  if(Number.isFinite(before))candles.reverse();
  return candles.map((candle,candleIndex)=>({...candle,candleIndex}));
};

export const upsertArchivedCandles=(key:CandleArchiveKey,candles:Candle[],source='OANDA_MID')=>{
  if(!candles.length)return 0;
  const storage=getCandleArchiveStorageUsage();
  const estimatedWriteBytes=candles.length*192;
  if(storage.usedBytes>=CANDLE_ARCHIVE_HIGH_WATER_BYTES||storage.usedBytes+estimatedWriteBytes>CANDLE_ARCHIVE_MAX_BYTES){
    throw new Error(`Candle archive storage limit reached: ${(storage.usedBytes/1024/1024/1024).toFixed(2)} GiB used of ${(CANDLE_ARCHIVE_MAX_BYTES/1024/1024/1024).toFixed(2)} GiB. Historical acquisition paused without deleting data.`);
  }
  const identity=normalized(key),fetchedAt=new Date().toISOString();
  const insert=database().prepare(`INSERT INTO historical_candles(mode,pair,timeframe,time,time_text,open,high,low,close,source,fetched_at)
    VALUES(@mode,@pair,@timeframe,@time,@timeText,@open,@high,@low,@close,@source,@fetchedAt)
    ON CONFLICT(mode,pair,timeframe,time) DO UPDATE SET
      time_text=excluded.time_text,open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,
      source=excluded.source,fetched_at=excluded.fetched_at
    WHERE historical_candles.time_text<>excluded.time_text
       OR historical_candles.open<>excluded.open
       OR historical_candles.high<>excluded.high
       OR historical_candles.low<>excluded.low
       OR historical_candles.close<>excluded.close
       OR historical_candles.source<>excluded.source`);
  let written=0;
  const writeBatch=database().transaction((batch:Candle[])=>{
    for(const candle of batch){
      const time=toEpochSeconds(candle.time);
      if(!Number.isFinite(time)||![candle.open,candle.high,candle.low,candle.close].every(Number.isFinite))continue;
      written+=insert.run({...identity,time,timeText:candle.time,open:candle.open,high:candle.high,low:candle.low,close:candle.close,source,fetchedAt}).changes;
    }
  });
  for(let index=0;index<candles.length;index+=5_000)writeBatch(candles.slice(index,index+5_000));
  return written;
};

export const recordArchivedCoverage=(key:CandleArchiveKey,startTime:number,endTime:number,adjacencySeconds=0)=>{
  if(!Number.isFinite(startTime)||!Number.isFinite(endTime)||endTime<startTime)return;
  const identity=normalized(key),db=database(),updatedAt=new Date().toISOString();
  const mergeCoverage=db.transaction(()=>{
    const existing=(db.prepare(`SELECT start_time AS startTime,end_time AS endTime FROM candle_archive_coverage
      WHERE mode=@mode AND pair=@pair AND timeframe=@timeframe ORDER BY start_time`).all(identity) as CandleCoverageRange[]);
    const merged=mergeCandleCoverageRanges([...existing,{startTime:Math.floor(startTime),endTime:Math.floor(endTime)}],adjacencySeconds);
    db.prepare(`DELETE FROM candle_archive_coverage WHERE mode=@mode AND pair=@pair AND timeframe=@timeframe`).run(identity);
    const insert=db.prepare(`INSERT INTO candle_archive_coverage(mode,pair,timeframe,start_time,end_time,updated_at)
      VALUES(@mode,@pair,@timeframe,@startTime,@endTime,@updatedAt)`);
    for(const range of merged)insert.run({...identity,...range,updatedAt});
  });
  mergeCoverage.immediate();
};

export const isArchivedRangeCovered=(key:CandleArchiveKey,startTime:number,endTime:number)=>Boolean(database().prepare(`
  SELECT 1 FROM candle_archive_coverage WHERE mode=@mode AND pair=@pair AND timeframe=@timeframe
    AND start_time<=@startTime AND end_time>=@endTime LIMIT 1
`).get({...normalized(key),startTime:Math.floor(startTime),endTime:Math.floor(endTime)}));

export const legacyCandleCacheNeedsImport=(filePath:string)=>{
  try{
    const stat=fs.statSync(filePath);
    const row=database().prepare('SELECT size_bytes AS sizeBytes,modified_ms AS modifiedMs FROM candle_archive_imports WHERE source_path=?').get(path.resolve(filePath)) as {sizeBytes:number;modifiedMs:number}|undefined;
    return !row||row.sizeBytes!==stat.size||row.modifiedMs!==Math.floor(stat.mtimeMs);
  }catch{return false}
};

export const markLegacyCandleCacheImported=(filePath:string,candleCount:number)=>{
  const stat=fs.statSync(filePath),sourcePath=path.resolve(filePath),importedAt=new Date().toISOString();
  database().prepare(`INSERT INTO candle_archive_imports(source_path,size_bytes,modified_ms,candle_count,imported_at)
    VALUES(?,?,?,?,?) ON CONFLICT(source_path) DO UPDATE SET size_bytes=excluded.size_bytes,modified_ms=excluded.modified_ms,
    candle_count=excluded.candle_count,imported_at=excluded.imported_at`).run(sourcePath,stat.size,Math.floor(stat.mtimeMs),candleCount,importedAt);
};

export const getCandleArchiveSummary=()=>database().prepare(`SELECT mode,pair,timeframe,COUNT(*) AS candleCount,
  MIN(time) AS startTime,MAX(time) AS endTime FROM historical_candles GROUP BY mode,pair,timeframe ORDER BY pair,timeframe`).all();
export const getCandleArchiveRangeSummary=(startTime:number,endTime:number)=>database().prepare(`SELECT mode,pair,timeframe,COUNT(*) AS candleCount,
  MIN(time) AS startTime,MAX(time) AS endTime FROM historical_candles WHERE time>=? AND time<?
  GROUP BY mode,pair,timeframe ORDER BY pair,timeframe`).all(Math.floor(startTime),Math.floor(endTime));
export const getArchivedCandleRangeSummary=(key:CandleArchiveKey,startTime:number,endTime:number)=>{
  const row=database().prepare(`SELECT COUNT(*) AS candleCount,MIN(time) AS startTime,MAX(time) AS endTime
    FROM historical_candles WHERE mode=@mode AND pair=@pair AND timeframe=@timeframe AND time>=@startTime AND time<@endTime`).get({
      ...normalized(key),startTime:Math.floor(startTime),endTime:Math.floor(endTime),
    }) as {candleCount:number;startTime:number|null;endTime:number|null};
  return {...normalized(key),candleCount:Number(row.candleCount),startTime:row.startTime,endTime:row.endTime};
};
export const recordCandleSyncGap=(key:CandleArchiveKey,startTime:number,endTime:number,error='missing_completed_interval')=>database().prepare(`
  INSERT INTO candle_sync_gaps(mode,pair,timeframe,start_time,end_time,attempts,last_error,updated_at)
  VALUES(@mode,@pair,@timeframe,@startTime,@endTime,1,@error,@updatedAt)
  ON CONFLICT(mode,pair,timeframe,start_time) DO UPDATE SET end_time=excluded.end_time,attempts=candle_sync_gaps.attempts+1,
    last_error=excluded.last_error,updated_at=excluded.updated_at`).run({...normalized(key),startTime,endTime,error,updatedAt:new Date().toISOString()});
export const clearCandleSyncGapsThrough=(key:CandleArchiveKey,endTime:number)=>database().prepare(`DELETE FROM candle_sync_gaps
  WHERE mode=@mode AND pair=@pair AND timeframe=@timeframe AND end_time<=@endTime`).run({...normalized(key),endTime}).changes;
export const getCandleSyncGaps=(key:CandleArchiveKey)=>database().prepare(`SELECT start_time AS startTime,end_time AS endTime,attempts,last_error AS lastError,
  updated_at AS updatedAt FROM candle_sync_gaps WHERE mode=@mode AND pair=@pair AND timeframe=@timeframe ORDER BY start_time`).all(normalized(key));
export type CandleNoPrintInterval={startTime:number;endTime:number;source:string;confirmedAt:string};
export const getCandleNoPrintIntervals=(key:CandleArchiveKey)=>database().prepare(`SELECT start_time AS startTime,end_time AS endTime,source,
  confirmed_at AS confirmedAt FROM candle_no_print_intervals WHERE mode=@mode AND pair=@pair AND timeframe=@timeframe ORDER BY start_time`)
  .all(normalized(key)) as CandleNoPrintInterval[];
export const recordCandleNoPrintInterval=(key:CandleArchiveKey,startTime:number,endTime:number,source='OANDA_NO_PRINT')=>database().prepare(`
  INSERT INTO candle_no_print_intervals(mode,pair,timeframe,start_time,end_time,source,confirmed_at)
  VALUES(@mode,@pair,@timeframe,@startTime,@endTime,@source,@confirmedAt)
  ON CONFLICT(mode,pair,timeframe,start_time) DO UPDATE SET end_time=excluded.end_time,source=excluded.source,confirmed_at=excluded.confirmed_at`)
  .run({...normalized(key),startTime,endTime,source,confirmedAt:new Date().toISOString()});

// Floors cover each bounded live working set across weekends plus warm-up,
// gap-recovery, and operational margin. H4/D remain research-conservative.
export const CANDLE_RETENTION_DEFAULT_DAYS:Record<string,number>={M1:30,M5:45,M15:100,H1:330,H4:740,D:740};
export const minimumSafeRetentionDays=(timeframe:string)=>CANDLE_RETENTION_DEFAULT_DAYS[timeframe.toUpperCase()]??740;
export type CandleRetentionResult={mode:string;pair:string;timeframe:string;cutoff:number;rowsRemoved:number;durationMs:number;beforeBytes:number;afterBytes:number};
export const pruneArchivedCandles=(key:CandleArchiveKey,options:{now?:number;retentionDays?:number;preserveFrom?:number;batchSize?:number}={}):CandleRetentionResult=>{
  const started=Date.now(),beforeBytes=getCandleArchiveStorageUsage().sqliteBytes,identity=normalized(key);
  const configured=Number(process.env[`CANDLE_RETENTION_DAYS_${identity.timeframe}`]);
  const retentionDays=Math.max(minimumSafeRetentionDays(identity.timeframe),options.retentionDays??(Number.isFinite(configured)?configured:0));
  const ageCutoff=Math.floor((options.now??Date.now())/1000-retentionDays*86400);
  const cutoff=options.preserveFrom===undefined?ageCutoff:Math.min(ageCutoff,Math.floor(options.preserveFrom));
  const batchSize=Math.max(1,Math.min(10_000,Math.floor(options.batchSize??2_000)));
  const result=database().prepare(`DELETE FROM historical_candles WHERE (mode,pair,timeframe,time) IN (
    SELECT mode,pair,timeframe,time FROM historical_candles WHERE mode=@mode AND pair=@pair AND timeframe=@timeframe AND time<@cutoff ORDER BY time LIMIT @batchSize
  )`).run({...identity,cutoff,batchSize});
  return {mode:identity.mode,pair:identity.pair,timeframe:identity.timeframe,cutoff,rowsRemoved:result.changes,
    durationMs:Date.now()-started,beforeBytes,afterBytes:getCandleArchiveStorageUsage().sqliteBytes};
};

export const importLegacyCandleHistoryDirectory=(directory=path.resolve(process.cwd(),'data','candle-history'))=>{
  if(!fs.existsSync(directory))return {files:0,candles:0};
  let files=0,candles=0;
  for(const name of fs.readdirSync(directory)){
    const match=name.match(/^(demo|live)-(.+)-(M1|M5|M15|M30|H1|H4)\.json\.gz$/i);
    if(!match)continue;
    const filePath=path.join(directory,name);
    if(!legacyCandleCacheNeedsImport(filePath))continue;
    try{
      const parsed=JSON.parse(gunzipSync(fs.readFileSync(filePath)).toString('utf8')) as {candles?:Candle[]};
      const history=parsed.candles??[];
      const key={mode:match[1].toLowerCase() as 'demo'|'live',pair:match[2],timeframe:match[3].toUpperCase()};
      upsertArchivedCandles(key,history,'LEGACY_GZIP_OANDA_MID');
      if(history.length){
        recordArchivedCoverage(key,toEpochSeconds(history[0].time),toEpochSeconds(history[history.length-1].time)+tfToSeconds(key.timeframe),tfToSeconds(key.timeframe));
      }
      markLegacyCandleCacheImported(filePath,history.length);
      files+=1;candles+=history.length;
    }catch{/* Keep the source file untouched; a later valid cache can be retried. */}
  }
  return {files,candles};
};
