import { HIGH_IMPACT_KEYWORDS, PAIR_CURRENCY_MAP } from './constants.ts';
import { fetchForexFactoryEvents } from './forexFactoryScraper.ts';
import { FOREX_FACTORY_TIME_ZONE } from './forexFactoryScraper.ts';
import { logMessage } from './automationLogger.ts';
import util from "util";
import fs from 'fs';
import path from 'path';

type NewsWindow = {
  start: number;
  end: number;
  title: string;
  impact: string;
  currency: string;
  time: string;
};

let cachedPauseWindows: Record<string, NewsWindow[]> = {};
let lastNewsFetchDayKey = '';
let lastNewsError: string | null = null;
export { cachedPauseWindows }; // ðŸ‘ˆ Add this

const NEWS_CACHE_PATH = path.resolve(process.cwd(), 'data', 'news-windows.json');

const readSharedNewsCache = (key: string) => {
  try {
    const cached = JSON.parse(fs.readFileSync(NEWS_CACHE_PATH, 'utf8')) as {
      key?: string;
      windows?: Record<string, NewsWindow[]>;
    };
    if (cached.key !== key || !cached.windows) return false;
    cachedPauseWindows = cached.windows;
    lastNewsFetchDayKey = key;
    lastNewsError = null;
    return true;
  } catch {
    return false;
  }
};

const writeSharedNewsCache = (key: string) => {
  fs.mkdirSync(path.dirname(NEWS_CACHE_PATH), { recursive: true });
  const temporary = `${NEWS_CACHE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ key, windows: cachedPauseWindows }));
  fs.renameSync(temporary, NEWS_CACHE_PATH);
};


const dateKeyInZone = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: FOREX_FACTORY_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

const normalizeDateKey = (date: string) => date === 'today' ? dateKeyInZone() : date;

// Convert "1:00am" to "01:00:00" safely
function convertTo24Hour(timeStr: string): string | null {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (!match) return null;

  let [_, hourStr, minStr, meridian] = match;
  let hour = parseInt(hourStr);
  const minutes = minStr;

  if (meridian.toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (meridian.toLowerCase() === 'am' && hour === 12) hour = 0;

  return `${hour.toString().padStart(2, '0')}:${minutes}:00`;
}

export const zonedWallClockToEpoch = (date: string, time: string, timeZone = FOREX_FACTORY_TIME_ZONE) => {
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
  return guess;
};


export const loadDailyNews = async (overrideDate?: string) => {
  const input = overrideDate || dateKeyInZone();
  const key = normalizeDateKey(input);

  if (lastNewsFetchDayKey === key) return;
  if (readSharedNewsCache(key)) return;

  logMessage(`ðŸ“… Fetching high-impact news for ${input} from ForexFactory...`);
  let events;
  try {
    events = await fetchForexFactoryEvents(input);
    lastNewsError = null;
  } catch (error) {
    lastNewsError = (error as Error).message;
    throw error;
  }

  logMessage(`ðŸ“ ALL EVENTS on ${key}: ${util.inspect(events, { depth: null })}`);

  for (const pair in PAIR_CURRENCY_MAP) {
    const [cur1, cur2] = PAIR_CURRENCY_MAP[pair];

    const relevantEvents = events.filter(
      (e) =>
        e.impact === 'High' &&
        (e.currency === cur1 || e.currency === cur2)
    );

    if (relevantEvents.length > 0) {
      logMessage(`âš ï¸ High-impact events for ${pair}:`);
      // console.dir(relevantEvents, { depth: null });
    }

    cachedPauseWindows[pair] = relevantEvents.map((event) => {
      const time24 = convertTo24Hour(event.time);
      const localTimeStr = `${event.date}T${time24 ?? 'TENTATIVE'}`;
      const dayStart = zonedWallClockToEpoch(event.date, '00:00:00');
      const timestamp = time24 ? zonedWallClockToEpoch(event.date, time24) : dayStart + 12 * 60 * 60 * 1000;

      return {
        start: time24 ? timestamp - 60 * 60 * 1000 : dayStart,
        end: time24 ? timestamp + 60 * 60 * 1000 : dayStart + 24 * 60 * 60 * 1000,
        title: event.title,
        impact: event.impact,
        currency: event.currency,
        time: localTimeStr,
      };
    });
  }

  lastNewsFetchDayKey = key;
  writeSharedNewsCache(key);
};

export const isInHighImpactNewsWindow = async (pair: string): Promise<boolean> => {
  const now = Date.now();
  try {
    await loadDailyNews();
  } catch (error) {
    logMessage(`News safety check unavailable for ${pair}; trading is paused.`, { error: (error as Error).message }, { level: 'error', fileName: 'newsGuard', pair });
    return true;
  }
  const windows = cachedPauseWindows[pair] || [];
  return windows.some(({ start, end }) => now >= start && now <= end);
};

export const getNewsGuardError = () => lastNewsError;

export const getActiveNewsEvent = (pair: string): NewsWindow | null => {
  const now = Date.now();
  const windows = cachedPauseWindows[pair] || [];
  return windows.find(({ start, end }) => now >= start && now <= end) || null;
};
