// Mock all OANDA API modules so importing shared.ts doesn't require network/credentials
jest.mock('../../utils/oanda/api/order', () => ({
  ACTION: {
    SELL: 'SELL', BUY: 'BUY', SLatEntry: 'SLatEntry', MoveSL: 'MoveSL',
    MoveTP: 'MoveTP', PartialClose50: 'PartialClose50', PartialClose25: 'PartialClose25',
    PartialClose: 'PartialClose', CLOSE: 'Close', UP: 'Up', DOWN: 'Down',
  },
  TYPE: {
    MARKET: 'MARKET', LIMIT: 'LIMIT', STOP: 'STOP',
    MARKET_IF_TOUCHED: 'MARKET_IF_TOUCHED', TAKE_PROFIT: 'TAKE_PROFIT',
    STOP_LOSS: 'STOP_LOSS', GUARANTEED_STOP_LOSS: 'GUARANTEED_STOP_LOSS',
    TRAILING_STOP_LOSS: 'TRAILING_STOP_LOSS', FIXED_PRICE: 'FIXED_PRICE',
  },
}));
jest.mock('../../utils/oanda/api/login', () => ({ handleOandaLogin: jest.fn() }));
jest.mock('../../utils/oanda/api/priceStreamManager', () => ({ fetchPriceOnce: jest.fn() }));
jest.mock('../../utils/oanda/api/openNow', () => ({ openNow: jest.fn() }));

import {
  normalizePairKey,
  normalizePairKeyUnderscore,
  getPipIncrement,
  getPrecision,
  normalizeOandaSymbol,
  tfToSeconds,
  tfToMs,
  getQuoteRateSymbol,
  getUSDHolidayDates,
  isForexMarketOpen,
} from '../../utils/shared';

// ---------------------------------------------------------------------------
// normalizePairKey
// ---------------------------------------------------------------------------
describe('normalizePairKey', () => {
  it('strips underscores and uppercases', () => {
    expect(normalizePairKey('eur_usd')).toBe('EURUSD');
    expect(normalizePairKey('EUR_USD')).toBe('EURUSD');
  });

  it('strips slashes and uppercases', () => {
    expect(normalizePairKey('USD/JPY')).toBe('USDJPY');
    expect(normalizePairKey('eur/usd')).toBe('EURUSD');
  });

  it('leaves a clean 6-letter pair unchanged (just uppercased)', () => {
    expect(normalizePairKey('EURUSD')).toBe('EURUSD');
    expect(normalizePairKey('gbpusd')).toBe('GBPUSD');
  });
});

// ---------------------------------------------------------------------------
// normalizePairKeyUnderscore
// ---------------------------------------------------------------------------
describe('normalizePairKeyUnderscore', () => {
  it('replaces slash with underscore and uppercases', () => {
    expect(normalizePairKeyUnderscore('USD/JPY')).toBe('USD_JPY');
    expect(normalizePairKeyUnderscore('eur/usd')).toBe('EUR_USD');
  });

  it('replaces hyphens with underscore', () => {
    expect(normalizePairKeyUnderscore('USD-CAD')).toBe('USD_CAD');
  });

  it('leaves an already-formatted pair unchanged', () => {
    expect(normalizePairKeyUnderscore('EUR_USD')).toBe('EUR_USD');
  });
});

// ---------------------------------------------------------------------------
// getPipIncrement
// ---------------------------------------------------------------------------
describe('getPipIncrement', () => {
  it('returns 0.0001 for standard USD-quoted pairs', () => {
    expect(getPipIncrement('EUR_USD')).toBe(0.0001);
    expect(getPipIncrement('GBP_USD')).toBe(0.0001);
    expect(getPipIncrement('AUD_USD')).toBe(0.0001);
    expect(getPipIncrement('NZD_USD')).toBe(0.0001);
  });

  it('returns 0.0001 for USD-base pairs (USD_CAD, USD_CHF)', () => {
    expect(getPipIncrement('USD_CAD')).toBe(0.0001);
    expect(getPipIncrement('USD_CHF')).toBe(0.0001);
  });

  it('returns 0.01 for JPY pairs', () => {
    expect(getPipIncrement('USD_JPY')).toBe(0.01);
    expect(getPipIncrement('EUR_JPY')).toBe(0.01);
    expect(getPipIncrement('GBP_JPY')).toBe(0.01);
  });

  it('returns default 0.0001 for unknown pairs', () => {
    expect(getPipIncrement('XYZ_ABC')).toBe(0.0001);
  });

  it('normalises the input before lookup', () => {
    // slash-separated should still resolve
    expect(getPipIncrement('USD/JPY')).toBe(0.01);
    expect(getPipIncrement('EUR/USD')).toBe(0.0001);
  });
});

// ---------------------------------------------------------------------------
// getPrecision
// ---------------------------------------------------------------------------
describe('getPrecision', () => {
  it('returns 5 for non-JPY pairs', () => {
    expect(getPrecision('EUR_USD')).toBe(5);
    expect(getPrecision('GBP_USD')).toBe(5);
    expect(getPrecision('USD_CAD')).toBe(5);
  });

  it('returns 3 for JPY pairs', () => {
    expect(getPrecision('USD_JPY')).toBe(3);
    expect(getPrecision('EUR_JPY')).toBe(3);
    expect(getPrecision('GBP_JPY')).toBe(3);
  });

  it('returns default 5 for unknown pairs', () => {
    expect(getPrecision('XYZ_ABC')).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// normalizeOandaSymbol
// ---------------------------------------------------------------------------
describe('normalizeOandaSymbol', () => {
  it('inserts underscore into a 6-character symbol', () => {
    expect(normalizeOandaSymbol('EURUSD')).toBe('EUR_USD');
    expect(normalizeOandaSymbol('USDJPY')).toBe('USD_JPY');
    expect(normalizeOandaSymbol('GBPUSD')).toBe('GBP_USD');
  });

  it('returns symbols that are not exactly 6 characters unchanged', () => {
    expect(normalizeOandaSymbol('EUR_USD')).toBe('EUR_USD');
    expect(normalizeOandaSymbol('EURUSD1')).toBe('EURUSD1');
    expect(normalizeOandaSymbol('EUR')).toBe('EUR');
  });
});

// ---------------------------------------------------------------------------
// tfToSeconds
// ---------------------------------------------------------------------------
describe('tfToSeconds', () => {
  const cases: [string, number][] = [
    ['S5',  5],
    ['S10', 10],
    ['S30', 30],
    ['M1',  60],
    ['M5',  300],
    ['M15', 900],
    ['M30', 1_800],
    ['H1',  3_600],
    ['H4',  14_400],
    ['D',   86_400],
    ['W',   604_800],
    ['M',   2_592_000],
  ];

  it.each(cases)('tfToSeconds("%s") === %d', (tf, expected) => {
    expect(tfToSeconds(tf)).toBe(expected);
  });

  it('throws for unsupported timeframe', () => {
    expect(() => tfToSeconds('H2')).toThrow('Unsupported TF: H2');
  });
});

// ---------------------------------------------------------------------------
// tfToMs
// ---------------------------------------------------------------------------
describe('tfToMs', () => {
  it('returns tfToSeconds * 1000', () => {
    expect(tfToMs('M1')).toBe(60_000);
    expect(tfToMs('H1')).toBe(3_600_000);
    expect(tfToMs('D')).toBe(86_400_000);
  });
});

// ---------------------------------------------------------------------------
// getQuoteRateSymbol
// ---------------------------------------------------------------------------
describe('getQuoteRateSymbol', () => {
  it('returns USD_{quote} for CAD, CHF, JPY', () => {
    expect(getQuoteRateSymbol('CAD')).toBe('USD_CAD');
    expect(getQuoteRateSymbol('CHF')).toBe('USD_CHF');
    expect(getQuoteRateSymbol('JPY')).toBe('USD_JPY');
  });

  it('returns {quote}_USD for AUD, NZD, GBP', () => {
    expect(getQuoteRateSymbol('AUD')).toBe('AUD_USD');
    expect(getQuoteRateSymbol('NZD')).toBe('NZD_USD');
    expect(getQuoteRateSymbol('GBP')).toBe('GBP_USD');
  });

  it('returns empty string for USD', () => {
    expect(getQuoteRateSymbol('USD')).toBe('');
  });

  it('throws for unsupported currency', () => {
    expect(() => getQuoteRateSymbol('EUR')).toThrow('Unsupported quote currency: EUR');
  });
});

// ---------------------------------------------------------------------------
// getUSDHolidayDates
// ---------------------------------------------------------------------------
describe('getUSDHolidayDates', () => {
  it('includes New Year\'s Day as a full holiday', () => {
    const { fullHolidays } = getUSDHolidayDates(2024);
    expect(fullHolidays.has('2024-01-01')).toBe(true);
  });

  it('includes MLK Day (3rd Monday of January) as a full holiday', () => {
    // 3rd Monday of Jan 2024 = Jan 15
    const { fullHolidays } = getUSDHolidayDates(2024);
    expect(fullHolidays.has('2024-01-15')).toBe(true);
  });

  it('includes Presidents\' Day (3rd Monday of February) as a full holiday', () => {
    // 3rd Monday of Feb 2024 = Feb 19
    const { fullHolidays } = getUSDHolidayDates(2024);
    expect(fullHolidays.has('2024-02-19')).toBe(true);
  });

  it('includes Independence Day as a full holiday', () => {
    const { fullHolidays } = getUSDHolidayDates(2024);
    expect(fullHolidays.has('2024-07-04')).toBe(true);
  });

  it('includes Juneteenth as a full holiday', () => {
    const { fullHolidays } = getUSDHolidayDates(2024);
    expect(fullHolidays.has('2024-06-19')).toBe(true);
  });

  it('includes Thanksgiving (4th Thursday of November) as a full holiday', () => {
    // 4th Thursday of Nov 2024 = Nov 28
    const { fullHolidays } = getUSDHolidayDates(2024);
    expect(fullHolidays.has('2024-11-28')).toBe(true);
  });

  it('includes Christmas Day as a full holiday', () => {
    const { fullHolidays } = getUSDHolidayDates(2024);
    expect(fullHolidays.has('2024-12-25')).toBe(true);
  });

  it('includes Black Friday as a partial holiday', () => {
    // Black Friday 2024 = Nov 29 (day after Thanksgiving Nov 28)
    const { partialHolidays } = getUSDHolidayDates(2024);
    expect(partialHolidays.has('2024-11-29')).toBe(true);
  });

  it('includes Christmas Eve as a partial holiday', () => {
    const { partialHolidays } = getUSDHolidayDates(2024);
    expect(partialHolidays.has('2024-12-24')).toBe(true);
  });

  it('includes July 3 as a partial holiday', () => {
    const { partialHolidays } = getUSDHolidayDates(2024);
    expect(partialHolidays.has('2024-07-03')).toBe(true);
  });

  it('contains 11 full holidays for 2024', () => {
    const { fullHolidays } = getUSDHolidayDates(2024);
    expect(fullHolidays.size).toBe(11);
  });

  it('contains 3 partial holidays for 2024', () => {
    const { partialHolidays } = getUSDHolidayDates(2024);
    expect(partialHolidays.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// isForexMarketOpen
// ---------------------------------------------------------------------------
describe('isForexMarketOpen', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns true on a regular trading weekday (Monday noon UTC)', () => {
    // Jan 8 2024 is a regular Monday (no holiday)
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-08T12:00:00Z'));
    expect(isForexMarketOpen()).toBe(true);
  });

  it('returns false on Saturday', () => {
    // Jan 13 2024 is a Saturday
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-13T12:00:00Z'));
    expect(isForexMarketOpen()).toBe(false);
  });

  it('returns false on Sunday before market open (before 21:00 UTC)', () => {
    // Jan 14 2024 is a Sunday at 20:00 UTC — market not yet open
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-14T20:00:00Z'));
    expect(isForexMarketOpen()).toBe(false);
  });

  it('returns true on Sunday after market open (after 21:00 UTC)', () => {
    // Jan 14 2024 is a Sunday at 22:00 UTC — market is open
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-14T22:00:00Z'));
    expect(isForexMarketOpen()).toBe(true);
  });

  it('returns false on Friday after market close (after 21:00 UTC)', () => {
    // Jan 12 2024 is a Friday at 22:00 UTC — market closed
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-12T22:00:00Z'));
    expect(isForexMarketOpen()).toBe(false);
  });

  it('returns false on a full holiday (MLK Day, Jan 15 2024)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    expect(isForexMarketOpen()).toBe(false);
  });

  it('returns false on a partial holiday (Christmas Eve 2024)', () => {
    // Dec 24 2024 is a Tuesday — would normally be open, but it's a partial holiday
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-12-24T12:00:00Z'));
    expect(isForexMarketOpen()).toBe(false);
  });
});
