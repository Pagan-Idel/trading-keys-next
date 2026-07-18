export const GOLDILOCKS_STRATEGY_VERSION = 'h1-m15-m5-v13';

export const GOLDILOCKS_RESEARCH_VERSION = 'goldilocks-auto-research-v1';

export const GOLDILOCKS_TIMEFRAME_PROFILES = {
  intraday: {
    id: 'intraday',
    label: 'H1 / M15 / M5',
    strategyVersion: GOLDILOCKS_STRATEGY_VERSION,
    trend: 'H1',
    zone: 'M15',
    confirmation: 'M5',
    execution: 'M1',
    confluence: ['M5', 'M15', 'H1'] as const,
    defaultLookbackDays: 730,
    maximumLookbackDays: 730,
  },
  higherTimeframe: {
    id: 'higherTimeframe',
    label: 'D1 / H4 / H1',
    strategyVersion: 'd1-h4-h1-research-v1',
    trend: 'D',
    zone: 'H4',
    confirmation: 'H1',
    execution: 'M5',
    confluence: ['H1', 'H4', 'D'] as const,
    defaultLookbackDays: 3650,
    maximumLookbackDays: 3650,
  },
} as const;

export type GoldilocksTimeframeProfileId = keyof typeof GOLDILOCKS_TIMEFRAME_PROFILES;
export type GoldilocksTimeframeContract = {
  trend:string;
  zone:string;
  confirmation:string;
  execution:string;
  confluence:readonly string[];
};

export const isGoldilocksTimeframeProfileId = (value:unknown):value is GoldilocksTimeframeProfileId =>
  typeof value === 'string' && value in GOLDILOCKS_TIMEFRAME_PROFILES;

export const getGoldilocksTimeframeProfile = (value:unknown) =>
  GOLDILOCKS_TIMEFRAME_PROFILES[isGoldilocksTimeframeProfileId(value) ? value : 'intraday'];

export const GOLDILOCKS_DEPARTURE_QUALITY = {
  shockRangeAtrMultiple: 3,
  rejectionWickFraction: 0.5,
  minimumShockCloseDepartureZoneMultiple: 1,
} as const;

export const GOLDILOCKS_ENTRY_PROXIMITY = {
  maxTouchRangeZoneFraction: 0.5,
  maxEntryDistanceZoneFraction: 0.5,
} as const;

export const GOLDILOCKS_DEMO_TIMEFRAMES = {
  trend: 'H1',
  zone: 'M15',
  confirmation: 'M5',
  execution: 'M1',
  confluence: ['M5', 'M15', 'H1'] as const,
} as const;

export const GOLDILOCKS_TIMEFRAME_SECONDS: Record<string, number> = {
  M1: 60,
  M5: 5 * 60,
  M15: 15 * 60,
  H1: 60 * 60,
  H4: 4 * 60 * 60,
  D: 24 * 60 * 60,
};

// Pi-friendly live/demo working sets. The disk archive is retained separately
// and can be consumed in full by an explicit backtest job.
export const GOLDILOCKS_LIVE_CANDLE_LIMITS: Record<string, number> = {
  M1: 10_000,
  M5: 5_000,
  M15: 5_000,
  H1: 5_000,
};

export const GOLDILOCKS_SCORE_WEIGHTS = {
  rangeAlignment: 0,
  zoneInsideZoneTwoTimeframes: 1,
  zoneInsideZoneThreeTimeframes: 3,
  trendAlignment: 4,
  departureSingleCandleBase: 3,
  departureTwoCandleBase: 2,
  departureThreeCandleBase: 1,
  departureImmediate: 2,
  departureOneLingeringCandle: 1,
  purityFresh: 4,
  puritySingleShallowRetouch: 2,
  departureStrength: 1,
  structuralReversal: 2,
  availableRrrExcellent: 1,
  availableRrrGood: 1,
} as const;

// Keep the Backtesting dashboard and non-UI callers on the same readable label.
// Future version/weight changes automatically flow into new-run labels while
// previously stored runs retain the label captured in their config snapshot.
export const GOLDILOCKS_DEFAULT_BACKTEST_LABEL = [
  GOLDILOCKS_STRATEGY_VERSION,
  `ZIZ 3/3=${GOLDILOCKS_SCORE_WEIGHTS.zoneInsideZoneThreeTimeframes}pt`,
  `H1 range=${GOLDILOCKS_SCORE_WEIGHTS.rangeAlignment}pt`,
  'age+approach logged',
].join(' | ');

export const getGoldilocksMinimumScore = () => {
  const configured = Number(process.env.GOLDILOCKS_MIN_SCORE ?? 14);
  return Number.isFinite(configured)
    ? Math.min(20, Math.max(0, Math.floor(configured)))
    : 14;
};
