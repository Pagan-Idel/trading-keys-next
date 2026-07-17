export const GOLDILOCKS_DEMO_TIMEFRAMES = {
  trend: 'M15',
  zone: 'M5',
  confirmation: 'M1',
  confluence: ['M1', 'M5', 'M15'] as const,
} as const;

export const GOLDILOCKS_TIMEFRAME_SECONDS: Record<string, number> = {
  M1: 60,
  M5: 5 * 60,
  M15: 15 * 60,
};

// Pi-friendly live/demo working sets. The disk archive is retained separately
// and can be consumed in full by an explicit backtest job.
export const GOLDILOCKS_LIVE_CANDLE_LIMITS: Record<string, number> = {
  M1: 10_000,
  M5: 5_000,
  M15: 5_000,
};

export const GOLDILOCKS_SCORE_WEIGHTS = {
  rangeAlignment: 2,
  zoneInsideZonePerAdditionalTimeframe: 1,
  trendAlignment: 2,
  baseTimeFast: 2,
  baseTimeMedium: 1,
  purityFresh: 4,
  puritySingleShallowRetouch: 2,
  departureStrength: 2,
  structuralReversal: 2,
  availableRrrExcellent: 4,
  availableRrrGood: 2,
} as const;

export const getGoldilocksMinimumScore = () => {
  const configured = Number(process.env.GOLDILOCKS_MIN_SCORE ?? 14);
  return Number.isFinite(configured)
    ? Math.min(20, Math.max(0, Math.floor(configured)))
    : 14;
};
