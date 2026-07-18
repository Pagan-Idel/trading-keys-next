import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { gunzipSync } from 'zlib';
import type { Candle } from './swingLabeler.ts';
import { normalizePairKeyUnderscore, tfToSeconds } from './shared.ts';

export interface CandleArchiveKey {pair:string;timeframe:string;mode:'live'|'demo'}
export interface CandleCoverageRange {startTime:number;endTime:number}

const DATABASE_PATH=path.resolve(process.cwd(),'data','candle-history.sqlite');
const LEGACY_DIRECTORY=path.resolve(process.cwd(),'data','candle-history');
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
      source=excluded.source,fetched_at=excluded.fetched_at`);
  let written=0;
  const writeBatch=database().transaction((batch:Candle[])=>{
    for(const candle of batch){
      const time=toEpochSeconds(candle.time);
      if(!Number.isFinite(time)||![candle.open,candle.high,candle.low,candle.close].every(Number.isFinite))continue;
      insert.run({...identity,time,timeText:candle.time,open:candle.open,high:candle.high,low:candle.low,close:candle.close,source,fetchedAt});
      written+=1;
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
