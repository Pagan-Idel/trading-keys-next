// Map UI/logic intervals to OANDA granularity codes
export const INTERVAL_TO_GRANULARITY: Record<string, string> = {
  '1day': 'D',
  '1d': 'D',
  '1D': 'D',
  '4h': 'H4',
  '1h': 'H1',
  '15m': 'M15',
  '5m': 'M5',
  '30m': 'M30',
  '1m': 'M1',
  '2m': 'M2',
  '4m': 'M4',
  '10m': 'M10',
  '12h': 'H12',
  '6h': 'H6',
  '8h': 'H8',
  '1w': 'W',
  '1mo': 'M',
};
// OANDA valid candle granularities
export const OANDA_GRANULARITIES = [
  'S5',  // 5 second candlesticks, minute alignment
  'S10', // 10 second candlesticks, minute alignment
  'S15', // 15 second candlesticks, minute alignment
  'S30', // 30 second candlesticks, minute alignment
  'M1',  // 1 minute candlesticks, minute alignment
  'M2',  // 2 minute candlesticks, hour alignment
  'M4',  // 4 minute candlesticks, hour alignment
  'M5',  // 5 minute candlesticks, hour alignment
  'M10', // 10 minute candlesticks, hour alignment
  'M15', // 15 minute candlesticks, hour alignment
  'M30', // 30 minute candlesticks, hour alignment
  'H1',  // 1 hour candlesticks, hour alignment
  'H2',  // 2 hour candlesticks, day alignment
  'H3',  // 3 hour candlesticks, day alignment
  'H4',  // 4 hour candlesticks, day alignment
  'H6',  // 6 hour candlesticks, day alignment
  'H8',  // 8 hour candlesticks, day alignment
  'H12', // 12 hour candlesticks, day alignment
  'D',   // 1 day candlesticks, day alignment
  'W',   // 1 week candlesticks, aligned to start of week
  'M',   // 1 month candlesticks, aligned to first day of the month
];
export const contractSize = 100000;
export const commissionPerLot = 5;

export const forexPairs = [
  'EUR/USD', 'GBP/USD', 'AUD/USD', 'USD/CAD',
  'USD/CHF', 'NZD/USD', 'EUR/JPY', 'GBP/JPY', 'EUR/NZD'
];

export const intervals = ['1day', '4h', '1h', '15m', '5m'];
export const pipMap: Record<string, number> = {
  EUR_USD: 0.0001, GBP_USD: 0.0001, AUD_USD: 0.0001,
  USD_CAD: 0.0001, USD_CHF: 0.0001, NZD_USD: 0.0001,
  USD_JPY: 0.01, EUR_JPY: 0.01, GBP_JPY: 0.01, CHF_JPY: 0.01
};

export const instrumentPrecision: Record<string, number> = {
  EUR_USD: 5, GBP_USD: 5, AUD_USD: 5, NZD_USD: 5,
  USD_CAD: 5, USD_CHF: 5, EUR_JPY: 3, USD_JPY: 3,
  GBP_JPY: 3, CHF_JPY: 3
};


export const SESSION_HOURS_UTC = {
  sydney:    { start: 21, end: 6 },
  tokyo:     { start: 0, end: 9 },
  frankfurt: { start: 7,  end: 16 },
  london:    { start: 7,  end: 16 },
  new_york:  { start: 12, end: 21 }
};

export const SESSION_MAP: Record<string, string[]> = {
  EUR: ['london', 'frankfurt'],
  USD: ['new_york'],
  GBP: ['london'],
  AUD: ['sydney'],
  NZD: ['sydney'],
  JPY: ['tokyo'],
  CAD: ['new_york'],
  CHF: ['frankfurt']
};

export const HIGH_IMPACT_KEYWORDS = ['rate decision', 'gdp', 'cpi', 'nfp', 'interest', 'retail sales', 'unemployment'];

// Map each forex pair to its two currencies
export const PAIR_CURRENCY_MAP: Record<string, [string, string]> = {
  'EUR/USD': ['EUR', 'USD'],
  'GBP/USD': ['GBP', 'USD'],
  'AUD/USD': ['AUD', 'USD'],
  'USD/CAD': ['USD', 'CAD'],
  'USD/CHF': ['USD', 'CHF'],
  'NZD/USD': ['NZD', 'USD'],
  'EUR/JPY': ['EUR', 'JPY'],
  'GBP/JPY': ['GBP', 'JPY'],
};