import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { PAIR_CURRENCY_MAP } from './constants.ts';
import { fetchForexFactoryCalendarWeeks, FOREX_FACTORY_TIME_ZONE, type ForexEvent } from './forexFactoryScraper.ts';

const SOURCE = 'forex_factory';
const dbPath = path.resolve(process.cwd(), 'data', 'automation.sqlite');
let db: Database.Database | null = null;

export interface HistoricalNewsGateResult {
  allowed: boolean;
  covered: boolean;
  reason: string;
  event?: {
    currency: string;
    title: string;
    scheduledAt: number;
    windowStart: number;
    windowEnd: number;
    timeLabel: string;
  };
}

const database = () => {
  if (db) return db;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS historical_news_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_event_key TEXT NOT NULL,
      calendar_date TEXT NOT NULL,
      currency TEXT NOT NULL,
      title TEXT NOT NULL,
      impact TEXT NOT NULL,
      scheduled_at INTEGER NOT NULL,
      window_start INTEGER NOT NULL,
      window_end INTEGER NOT NULL,
      time_label TEXT NOT NULL,
      timing TEXT NOT NULL,
      source_timezone TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      raw_json TEXT,
      UNIQUE(source, source_event_key)
    );
    CREATE INDEX IF NOT EXISTS idx_historical_news_window
      ON historical_news_events(currency, window_start, window_end);
    CREATE INDEX IF NOT EXISTS idx_historical_news_date
      ON historical_news_events(source, calendar_date);
    CREATE TABLE IF NOT EXISTS historical_news_coverage (
      source TEXT NOT NULL,
      calendar_date TEXT NOT NULL,
      status TEXT NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT NOT NULL,
      error TEXT,
      PRIMARY KEY(source, calendar_date)
    );
  `);
  return db;
};

const zonedWallClockToEpoch = (date: string, time: string, timeZone = FOREX_FACTORY_TIME_ZONE) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second || 0);
  let guess = targetAsUtc;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const values = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(part => [part.type, part.value]));
    const representedAsUtc = Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day),
      Number(values.hour), Number(values.minute), Number(values.second),
    );
    guess += targetAsUtc - representedAsUtc;
  }
  return Math.floor(guess / 1000);
};

const dateKeyInSourceZone = (epochSeconds: number) => new Intl.DateTimeFormat('en-CA', {
  timeZone: FOREX_FACTORY_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(epochSeconds * 1000));

const datesBetween = (start: string, end: string) => {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

const sundayOf = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value.toISOString().slice(0, 10);
};

const clock24 = (value: string) => {
  const match = value.trim().toLowerCase().match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (!match) return null;
  let hour = Number(match[1]);
  if (match[3] === 'pm' && hour !== 12) hour += 12;
  if (match[3] === 'am' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${match[2]}:00`;
};

const normalizeEvent = (event: ForexEvent) => {
  const converted = clock24(event.time);
  const timing = converted ? 'timed' : /all day/i.test(event.time) ? 'all_day' : 'tentative';
  const dayStart = zonedWallClockToEpoch(event.date, '00:00:00');
  const nextDate = new Date(`${event.date}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const dayEnd = zonedWallClockToEpoch(nextDate.toISOString().slice(0, 10), '00:00:00') - 1;
  const scheduledAt = converted ? zonedWallClockToEpoch(event.date, converted) : dayStart + Math.floor((dayEnd - dayStart) / 2);
  const windowStart = converted ? scheduledAt - 60 * 60 : dayStart;
  const windowEnd = converted ? scheduledAt + 60 * 60 : dayEnd;
  const sourceEventKey = createHash('sha256')
    .update([event.date, event.currency, event.title, event.time].join('|'))
    .digest('hex');
  return { ...event, timing, scheduledAt, windowStart, windowEnd, sourceEventKey };
};

export const ensureHistoricalNewsCoverage = async (
  startEpochSeconds: number,
  endEpochSeconds: number,
  onProgress?: (completed: number, total: number, weekStart: string) => void,
) => {
  const startDate = dateKeyInSourceZone(startEpochSeconds - 24 * 60 * 60);
  const endDate = dateKeyInSourceZone(endEpochSeconds + 24 * 60 * 60);
  const requiredDates = datesBetween(startDate, endDate);
  const d = database();
  const covered = d.prepare(`SELECT calendar_date AS date FROM historical_news_coverage WHERE source=? AND status='complete'`).all(SOURCE) as Array<{date:string}>;
  const coveredDates = new Set(covered.map(row => row.date));
  const weeks = [...new Set(requiredDates.filter(date => !coveredDates.has(date)).map(sundayOf))].sort();
  if (!weeks.length) return { fetchedWeeks: 0, requiredDates: requiredDates.length };

  const events = await fetchForexFactoryCalendarWeeks(weeks, onProgress);
  const highImpact = events.filter(event => event.impact === 'High').map(normalizeEvent);
  const fetchedAt = new Date().toISOString();
  const insert = d.prepare(`
    INSERT INTO historical_news_events(
      source,source_event_key,calendar_date,currency,title,impact,scheduled_at,window_start,window_end,
      time_label,timing,source_timezone,fetched_at,raw_json
    ) VALUES(
      @source,@sourceEventKey,@date,@currency,@title,@impact,@scheduledAt,@windowStart,@windowEnd,
      @time,@timing,@sourceTimezone,@fetchedAt,@rawJson
    ) ON CONFLICT(source,source_event_key) DO UPDATE SET
      scheduled_at=excluded.scheduled_at,window_start=excluded.window_start,window_end=excluded.window_end,
      fetched_at=excluded.fetched_at,raw_json=excluded.raw_json
  `);
  const coverage = d.prepare(`
    INSERT INTO historical_news_coverage(source,calendar_date,status,event_count,fetched_at,error)
    VALUES(?,?,'complete',?,?,NULL)
    ON CONFLICT(source,calendar_date) DO UPDATE SET
      status='complete',event_count=excluded.event_count,fetched_at=excluded.fetched_at,error=NULL
  `);
  const refreshWeeks = d.transaction(() => {
    for (const week of weeks) {
      const weekEndValue = new Date(`${week}T00:00:00Z`);
      weekEndValue.setUTCDate(weekEndValue.getUTCDate() + 6);
      const weekDates = datesBetween(week, weekEndValue.toISOString().slice(0, 10));
      for (const date of weekDates) {
        d.prepare('DELETE FROM historical_news_events WHERE source=? AND calendar_date=?').run(SOURCE, date);
        const dayEvents = highImpact.filter(event => event.date === date);
        for (const event of dayEvents) insert.run({
          ...event, source: SOURCE, sourceTimezone: FOREX_FACTORY_TIME_ZONE,
          fetchedAt, rawJson: JSON.stringify(event),
        });
        coverage.run(SOURCE, date, dayEvents.length, fetchedAt);
      }
    }
  });
  refreshWeeks();
  return { fetchedWeeks: weeks.length, requiredDates: requiredDates.length, highImpactEvents: highImpact.length };
};

export const evaluateHistoricalNewsGate = (
  pair: string,
  epochSeconds: number,
  rows?: Array<{currency:string;title:string;scheduledAt:number;windowStart:number;windowEnd:number;timeLabel:string}>,
): HistoricalNewsGateResult => {
  const currencies = PAIR_CURRENCY_MAP[pair] ?? pair.toUpperCase().split('/') as [string, string];
  const relevant = rows?.find(row => currencies.includes(row.currency) && epochSeconds >= row.windowStart && epochSeconds <= row.windowEnd);
  if (relevant) return {
    allowed: false, covered: true,
    reason: `High-impact ${relevant.currency} news window: ${relevant.title}.`,
    event: relevant,
  };
  return { allowed: true, covered: true, reason: 'No relevant high-impact historical news window.' };
};

export const getHistoricalNewsGate = (pair: string, epochSeconds: number): HistoricalNewsGateResult => {
  const d = database();
  const date = dateKeyInSourceZone(epochSeconds);
  const coverage = d.prepare(`SELECT status FROM historical_news_coverage WHERE source=? AND calendar_date=?`).get(SOURCE, date) as {status:string}|undefined;
  if (coverage?.status !== 'complete') return {
    allowed: false, covered: false,
    reason: `Historical news coverage is unavailable for ${date}; refusing to assume there was no news.`,
  };
  const currencies = PAIR_CURRENCY_MAP[pair] ?? pair.toUpperCase().split('/');
  const placeholders = currencies.map(() => '?').join(',');
  const rows = d.prepare(`
    SELECT currency,title,scheduled_at AS scheduledAt,window_start AS windowStart,
      window_end AS windowEnd,time_label AS timeLabel
    FROM historical_news_events
    WHERE source=? AND currency IN (${placeholders}) AND window_start<=? AND window_end>=?
    ORDER BY scheduled_at
  `).all(SOURCE, ...currencies, epochSeconds, epochSeconds) as Array<{currency:string;title:string;scheduledAt:number;windowStart:number;windowEnd:number;timeLabel:string}>;
  return evaluateHistoricalNewsGate(pair, epochSeconds, rows);
};

export const getHistoricalNewsGateForRange = (pair:string,startEpochSeconds:number,endEpochSeconds:number):HistoricalNewsGateResult=>{
  const d=database();
  const start=Math.min(startEpochSeconds,endEpochSeconds),end=Math.max(startEpochSeconds,endEpochSeconds);
  const requiredDates=datesBetween(dateKeyInSourceZone(start),dateKeyInSourceZone(end));
  const covered=(d.prepare(`SELECT calendar_date AS date,status FROM historical_news_coverage
    WHERE source=? AND calendar_date BETWEEN ? AND ?`).all(SOURCE,requiredDates[0],requiredDates.at(-1)) as Array<{date:string;status:string}>);
  const complete=new Set(covered.filter(row=>row.status==='complete').map(row=>row.date));
  const missing=requiredDates.find(date=>!complete.has(date));
  if(missing)return {allowed:false,covered:false,reason:`Historical news coverage is unavailable for ${missing}; refusing to assume there was no news.`};
  const currencies=PAIR_CURRENCY_MAP[pair]??pair.toUpperCase().split('/');
  const placeholders=currencies.map(()=>'?').join(',');
  const row=d.prepare(`SELECT currency,title,scheduled_at AS scheduledAt,window_start AS windowStart,
    window_end AS windowEnd,time_label AS timeLabel FROM historical_news_events
    WHERE source=? AND currency IN (${placeholders}) AND window_start<=? AND window_end>=?
    ORDER BY scheduled_at LIMIT 1`).get(SOURCE,...currencies,end,start) as HistoricalNewsGateResult['event']|undefined;
  if(row)return {allowed:false,covered:true,reason:`High-impact ${row.currency} news window overlaps the confirmation candle: ${row.title}.`,event:row};
  return {allowed:true,covered:true,reason:'No relevant high-impact historical news window overlaps the confirmation candle.'};
};

export const getHistoricalNewsCoverageSummary = () => database().prepare(`
  SELECT MIN(calendar_date) AS fromDate,MAX(calendar_date) AS toDate,COUNT(*) AS coveredDays,
    SUM(event_count) AS highImpactEvents FROM historical_news_coverage
  WHERE source=? AND status='complete'
`).get(SOURCE) as {fromDate:string|null;toDate:string|null;coveredDays:number;highImpactEvents:number};
