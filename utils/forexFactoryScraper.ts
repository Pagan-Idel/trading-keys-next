import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';


export interface ForexEvent {
  title: string;
  time: string;
  currency: string;
  impact: 'High' | 'Medium' | 'Low';
  date: string; // yyyy-mm-dd
}

const puppeteer = puppeteerExtra as any;
puppeteer.use(StealthPlugin());

const BASE_URL = 'https://www.forexfactory.com/calendar?day=';
export const FOREX_FACTORY_TIME_ZONE = 'America/Chicago';

const dayUrl = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  const monthName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'short',
  }).format(new Date(Date.UTC(year, month - 1, day))).toLowerCase();
  return `${BASE_URL}${monthName}${day}.${year}`;
};

const impactFromSpan = (span: any): 'High' | 'Medium' | 'Low' => {
  const title = span.attr('title')?.toLowerCase() || '';
  const className = span.attr('class')?.toLowerCase() || '';
  if (title.includes('high') || className.includes('impact-red')) return 'High';
  if (title.includes('medium') || className.includes('impact-orange')) return 'Medium';
  return 'Low';
};

export const fetchForexFactoryEvents = async (inputDate?: string): Promise<ForexEvent[]> => {
  const now = inputDate ? new Date(`${inputDate}T00:00:00`) : new Date();
  if (isNaN(now.getTime())) {
    throw new Error(`Invalid date string: ${inputDate}`);
  }

  // Force local midnight to avoid UTC drift
  const localDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const timeZone = FOREX_FACTORY_TIME_ZONE;
  // console.log('🕒 System date now:', now.toString());
  // console.log('📅 Local date (forced 00:00):', localDate.toString());
  // console.log('🌍 Timezone detected:', timeZone);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const parts = formatter.formatToParts(localDate);
  const month = parts.find(p => p.type === 'month')!.value.toLowerCase();
  const day = parts.find(p => p.type === 'day')!.value;
  const year = parts.find(p => p.type === 'year')!.value;

  const urlDateParam = `${month}${day}.${year}`;
  const expectedDate = localDate.toLocaleDateString('en-CA'); // 'YYYY-MM-DD'
  const url = `${BASE_URL}${urlDateParam}`;

  // Removed noisy logs for calendar URL and expected date

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: null,
  });

  const page = await browser.newPage();
  await page.emulateTimezone(FOREX_FACTORY_TIME_ZONE);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const html = await page.content();
  await browser.close();

  const $ = cheerio.load(html);
  const events: ForexEvent[] = [];

  let dateTracker = expectedDate;
  let timeTracker = '';

  $('.calendar__row').each((_, el) => {
    const row = $(el);
    const dateAttr = row.attr('data-calendar-date');

    if (dateAttr) {
      console.log(`📍 Found row for date: ${dateAttr}`);
      dateTracker = dateAttr;
      timeTracker = '';
    }

    if (dateTracker !== expectedDate) {
      console.log(`⏩ Skipping row for ${dateTracker} (wanted ${expectedDate})`);
      return;
    }

    const displayedTime = row.find('.calendar__time').text().trim();
    if (displayedTime) timeTracker = displayedTime;
    const currency = row.find('.calendar__currency').text().trim();
    const title = row.find('.calendar__event').text().trim();
    const impactSpan = row.find('.calendar__impact span');

    if (!currency || !title || impactSpan.length === 0) {
      // Removed noisy log for skipping invalid event row
      return;
    }

    const impact = impactFromSpan(impactSpan);

    events.push({
      title,
      time: timeTracker || 'Tentative',
      currency,
      impact,
      date: dateTracker,
    });
  });

  // Removed noisy log for parsed events
  return events;
};

/**
 * Fetch complete Forex Factory calendar weeks with one browser process. Historical
 * backfills use this instead of launching Chromium once for every calendar day.
 */
export const fetchForexFactoryCalendarWeeks = async (
  weekStarts: string[],
  onWeek?: (completed: number, total: number, weekStart: string) => void,
): Promise<ForexEvent[]> => {
  if (!weekStarts.length) return [];
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: null,
  });
  const page = await browser.newPage();
  await page.emulateTimezone(FOREX_FACTORY_TIME_ZONE);
  const events: ForexEvent[] = [];
  try {
    for (let index = 0; index < weekStarts.length; index += 1) {
      const weekStart = weekStarts[index];
      const cursor = new Date(`${weekStart}T00:00:00Z`);
      for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
        const date = cursor.toISOString().slice(0, 10);
        await page.goto(dayUrl(date), { waitUntil: 'domcontentloaded', timeout: 60_000 });
        if ((await page.title()).toLowerCase().includes('just a moment')) {
          throw new Error(`Forex Factory challenge page prevented historical date ${date} from loading.`);
        }
        const $ = cheerio.load(await page.content());
        if (!$('.calendar__row').length) throw new Error(`Forex Factory returned no calendar rows for ${date}.`);
        let dateTracker = date;
        let timeTracker = '';
        $('.calendar__row').each((_, element) => {
          const row = $(element);
          const dateAttr = row.attr('data-calendar-date');
          if (dateAttr) {
            dateTracker = dateAttr;
            timeTracker = '';
          }
          if (dateTracker !== date) return;
          const displayedTime = row.find('.calendar__time').text().trim();
          if (displayedTime) timeTracker = displayedTime;
          const currency = row.find('.calendar__currency').text().trim();
          const title = row.find('.calendar__event').text().trim();
          const impactSpan = row.find('.calendar__impact span');
          if (!currency || !title || impactSpan.length === 0) return;
          events.push({
            title,
            time: timeTracker || 'Tentative',
            currency,
            impact: impactFromSpan(impactSpan),
            date,
          });
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      onWeek?.(index + 1, weekStarts.length, weekStart);
    }
  } finally {
    await browser.close();
  }
  return events;
};
