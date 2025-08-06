import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import type { Cheerio as CheerioType } from 'cheerio';
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

const impactFromSpan = (span: cheerio.Cheerio<any>): 'High' | 'Medium' | 'Low' => {
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

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log('🕒 System date now:', now.toString());
  console.log('📅 Local date (forced 00:00):', localDate.toString());
  console.log('🌍 Timezone detected:', timeZone);

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

  console.log(`🔗 Building URL for calendar: ${url}`);
  console.log(`📌 Expected calendar date: ${expectedDate}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox'],
    defaultViewport: null,
  });

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const html = await page.content();
  await browser.close();

  const $ = cheerio.load(html);
  const events: ForexEvent[] = [];

  let dateTracker = expectedDate;

  $('.calendar__row').each((_, el) => {
    const row = $(el);
    const dateAttr = row.attr('data-calendar-date');

    if (dateAttr) {
      console.log(`📍 Found row for date: ${dateAttr}`);
      dateTracker = dateAttr;
    }

    if (dateTracker !== expectedDate) {
      console.log(`⏩ Skipping row for ${dateTracker} (wanted ${expectedDate})`);
      return;
    }

    const time = row.find('.calendar__time').text().trim();
    const currency = row.find('.calendar__currency').text().trim();
    const title = row.find('.calendar__event').text().trim();
    const impactSpan = row.find('.calendar__impact span');

    if (!currency || !title || impactSpan.length === 0) {
      console.log('⚠️ Skipping invalid event row:', { time, currency, title });
      return;
    }

    const impact = impactFromSpan(impactSpan);

    events.push({
      title,
      time: time || 'Tentative',
      currency,
      impact,
      date: dateTracker,
    });
  });

  console.log(`✅ Parsed ${events.length} events for ${expectedDate}:`);
  return events;
};
