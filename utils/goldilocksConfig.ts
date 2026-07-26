export const GOLDILOCKS_STRATEGY_VERSION = "0.42";

export const GOLDILOCKS_RESEARCH_VERSION = "goldilocks-auto-research-v1";

export const isGoldilocksIntradayStrategyVersion = (
  strategyVersion?: string,
) =>
  typeof strategyVersion === "string" &&
  (/^0\.\d+$/.test(strategyVersion) ||
    /^h1-m15-m5-v\d+$/.test(strategyVersion));

export const isGoldilocksReplayStrategyCompatible = (
  storedStrategyVersion?: string,
  selectedStrategyVersion?: string,
) =>
  Boolean(
    storedStrategyVersion &&
      selectedStrategyVersion &&
      (storedStrategyVersion === selectedStrategyVersion ||
        (isGoldilocksIntradayStrategyVersion(storedStrategyVersion) &&
          isGoldilocksIntradayStrategyVersion(selectedStrategyVersion))),
  );

export const GOLDILOCKS_TIMEFRAME_PROFILES = {
  lowerTimeframe: {
    id: "lowerTimeframe",
    label: "M15 / M5 / M1",
    strategyVersion: "m15-m5-m1-research-v3",
    trend: "M15",
    zone: "M5",
    confirmation: "M1",
    execution: "M1",
    confluence: ["M1", "M5", "M15"] as const,
    defaultLookbackDays: 365,
    maximumLookbackDays: 365,
  },
  intraday: {
    id: "intraday",
    label: "H1 / M15 / M5",
    strategyVersion: GOLDILOCKS_STRATEGY_VERSION,
    trend: "H1",
    zone: "M15",
    confirmation: "M5",
    execution: "M1",
    confluence: ["M5", "M15", "H1"] as const,
    defaultLookbackDays: 730,
    maximumLookbackDays: 730,
  },
  higherTimeframe: {
    id: "higherTimeframe",
    label: "D1 / H4 / H1",
    strategyVersion: "d1-h4-h1-research-v3",
    trend: "D",
    zone: "H4",
    confirmation: "H1",
    execution: "M5",
    confluence: ["H1", "H4", "D"] as const,
    defaultLookbackDays: 3650,
    maximumLookbackDays: 3650,
  },
} as const;

// Strategy Lab display contracts. These do not change the live/demo worker;
// they select which stored/reconstructed strategy trades the chart indicator shows.
export const GOLDILOCKS_CHART_STACKS = {
  lowerTimeframe: {
    id: "lowerTimeframe",
    label: "M1 / M5 / M15",
    strategyVersion: "m15-m5-m1-research-v3",
    confirmation: "M1",
    zone: "M5",
    trend: "M15",
    execution: "M1",
    drilldown: "M1",
    confluence: ["M1", "M5", "M15"] as const,
  },
  intraday: {
    id: "intraday",
    label: "M5 / M15 / H1",
    strategyVersion: GOLDILOCKS_STRATEGY_VERSION,
    confirmation: "M5",
    zone: "M15",
    trend: "H1",
    execution: "M1",
    drilldown: "M1",
    confluence: ["M5", "M15", "H1"] as const,
  },
  swing: {
    id: "swing",
    label: "M15 / H1 / H4",
    confirmation: "M15",
    zone: "H1",
    trend: "H4",
    execution: "M5",
    drilldown: "M5",
    confluence: ["M15", "H1", "H4"] as const,
  },
  multiDay: {
    id: "multiDay",
    label: "H1 / H4 / D1",
    strategyVersion: "d1-h4-h1-research-v3",
    confirmation: "H1",
    zone: "H4",
    trend: "D",
    execution: "M15",
    drilldown: "M15",
    confluence: ["H1", "H4", "D"] as const,
  },
} as const;

export type GoldilocksChartStackId = keyof typeof GOLDILOCKS_CHART_STACKS;
export const isGoldilocksChartStackId = (
  value: unknown,
): value is GoldilocksChartStackId =>
  typeof value === "string" && value in GOLDILOCKS_CHART_STACKS;
export const getGoldilocksChartStack = (value: unknown) =>
  GOLDILOCKS_CHART_STACKS[isGoldilocksChartStackId(value) ? value : "intraday"];

export type GoldilocksTimeframeProfileId =
  keyof typeof GOLDILOCKS_TIMEFRAME_PROFILES;
export type GoldilocksTimeframeContract = {
  trend: string;
  zone: string;
  confirmation: string;
  execution: string;
  confluence: readonly string[];
};

export const isGoldilocksTimeframeProfileId = (
  value: unknown,
): value is GoldilocksTimeframeProfileId =>
  typeof value === "string" && value in GOLDILOCKS_TIMEFRAME_PROFILES;

export const getGoldilocksTimeframeProfile = (value: unknown) =>
  GOLDILOCKS_TIMEFRAME_PROFILES[
    isGoldilocksTimeframeProfileId(value) ? value : "intraday"
  ];

export const GOLDILOCKS_DEPARTURE_QUALITY = {
  shockRangeAtrMultiple: 3,
  rejectionWickFraction: 0.5,
  minimumShockCloseDepartureZoneMultiple: 1,
} as const;

// Research-only adaptive imbalance -> balance -> imbalance detector. Every
// threshold is volatility-normalized; balance duration deliberately has no maximum.
export const GOLDILOCKS_BALANCE_DETECTION = {
  minimumBalanceCandles: 1,
  maximumSingleBalanceBodyWidthAtr: 0.5,
  maximumSingleBalanceWickWidthAtr: 0.8,
  minimumImbalanceRangeAtr: 1.2,
  minimumImbalanceBodyFraction: 0.6,
  minimumDirectionalCloseLocation: 0.75,
  minimumDepartureArrivalRangeRatio: 0.75,
  maximumDepartureArrivalRangeRatio: 1.25,
  maximumDepartureBodyFractionDeficit: 0.15,
  maximumDepartureCloseStrengthDeficit: 0.15,
  maximumBalanceBodyWidthAtr: 1,
  maximumBalanceWickWidthAtr: 1.5,
  maximumBalanceDriftAtr: 0.75,
  minimumBodyOverlapFraction: 0.2,
  closeAcceptanceToleranceAtr: 0.15,
  minimumDepartureCloseBeyondBodyAtr: 0.25,
} as const;

export const GOLDILOCKS_ENTRY_PROXIMITY = {
  maxTouchRangeZoneFraction: 0.5,
  maxEntryDistanceZoneFraction: 0.5,
  adverseApproachCandles: 3,
  minimumFastApproachAtr: 1.5,
  minimumFastTouchRangeAtr: 1.5,
} as const;

export const GOLDILOCKS_DEMO_TIMEFRAMES = {
  trend: "H1",
  zone: "M15",
  confirmation: "M5",
  execution: "M1",
  confluence: ["M5", "M15", "H1"] as const,
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
  H4: 5_000,
  D: 5_000,
};

export const GOLDILOCKS_SCORE_WEIGHTS = {
  zoneInsideZoneTwoTimeframes: 2,
  zoneInsideZoneThreeTimeframes: 4,
  trendAlignment: 3,
  departureSingleCandleBase: 3,
  departureTwoCandleBase: 2,
  departureThreeCandleBase: 1,
  departureImmediate: 0,
  departureOneLingeringCandle: 0,
  purityFresh: 4,
  puritySingleRetouch: 2,
  departureStrength: 1,
  structuralReversal: 0,
  approachNoWarnings: 5,
} as const;

export type GoldilocksScoreWeights = {
  [K in keyof typeof GOLDILOCKS_SCORE_WEIGHTS]: number;
};

export const normalizeGoldilocksScoreWeights = (
  value: unknown,
): GoldilocksScoreWeights => {
  const source =
    value && typeof value === "object"
      ? (value as Partial<GoldilocksScoreWeights>)
      : {};
  return Object.fromEntries(
    Object.entries(GOLDILOCKS_SCORE_WEIGHTS).map(([key, fallback]) => {
      const candidate = Number(source[key as keyof GoldilocksScoreWeights]);
      return [key, Number.isFinite(candidate) ? Math.max(0, candidate) : fallback];
    }),
  ) as GoldilocksScoreWeights;
};

export type GoldilocksScoreCategory =
  | "trend"
  | "departure"
  | "purity"
  | "approachWarnings"
  | "zoneInsideZone";

export type GoldilocksScoreCategoryWeights = Record<
  GoldilocksScoreCategory,
  number
>;

export const getGoldilocksScoreCategoryWeights = (
  value?: Partial<GoldilocksScoreWeights>,
): GoldilocksScoreCategoryWeights => {
  const weights = normalizeGoldilocksScoreWeights(value);
  const categories: GoldilocksScoreCategoryWeights = {
    trend: weights.trendAlignment,
    departure:
      weights.departureSingleCandleBase +
      weights.departureStrength,
    purity: weights.purityFresh,
    approachWarnings: weights.approachNoWarnings,
    zoneInsideZone: weights.zoneInsideZoneThreeTimeframes,
  };
  const total = Object.values(categories).reduce(
    (sum, category) => sum + category,
    0,
  );
  if (total <= 0)
    return {
      trend: 0,
      departure: 20,
      approachWarnings: 0,
      purity: 0,
      zoneInsideZone: 0,
    };
  return Object.fromEntries(
    Object.entries(categories).map(([key, category]) => [
      key,
      (category / total) * 20,
    ]),
  ) as GoldilocksScoreCategoryWeights;
};

export const rebalanceGoldilocksScoreCategories = (
  current: GoldilocksScoreCategoryWeights,
  changed: GoldilocksScoreCategory,
  requestedValue: number,
): GoldilocksScoreCategoryWeights => {
  const keys = Object.keys(current) as GoldilocksScoreCategory[];
  const nextValue = Math.min(20, Math.max(0, Number(requestedValue) || 0));
  const otherKeys = keys.filter((key) => key !== changed);
  const remaining = 20 - nextValue;
  const priorOtherTotal = otherKeys.reduce(
    (sum, key) => sum + Math.max(0, current[key]),
    0,
  );
  const next = { ...current, [changed]: nextValue };
  otherKeys.forEach((key) => {
    next[key] =
      priorOtherTotal > 0
        ? (Math.max(0, current[key]) / priorOtherTotal) * remaining
        : remaining / otherKeys.length;
  });
  const total = keys.reduce((sum, key) => sum + next[key], 0);
  next[otherKeys.at(-1)!] += 20 - total;
  return next;
};

export const expandGoldilocksScoreCategoryWeights = (
  categories: GoldilocksScoreCategoryWeights,
): GoldilocksScoreWeights => ({
  trendAlignment: categories.trend,
  departureSingleCandleBase: (categories.departure * 3) / 4,
  departureTwoCandleBase: categories.departure / 2,
  departureThreeCandleBase: categories.departure / 4,
  departureImmediate: 0,
  departureOneLingeringCandle: 0,
  departureStrength: categories.departure / 4,
  structuralReversal: 0,
  approachNoWarnings: categories.approachWarnings,
  purityFresh: categories.purity,
  puritySingleRetouch: categories.purity / 2,
  zoneInsideZoneTwoTimeframes: categories.zoneInsideZone / 2,
  zoneInsideZoneThreeTimeframes: categories.zoneInsideZone,
});

export const GOLDILOCKS_BACKTEST_GATE_DEFAULTS = {
  weeklyMarketHours: true,
  holiday: true,
  pairSession: true,
  departureQuality: false,
  zoneFormationNews: true,
  entryProximity: true,
  adverseApproach: false,
  entryNews: true,
  twoToOneRunway: true,
} as const;

export type GoldilocksBacktestGates = {
  [K in keyof typeof GOLDILOCKS_BACKTEST_GATE_DEFAULTS]: boolean;
};

export const normalizeGoldilocksBacktestGates = (
  value: unknown,
): GoldilocksBacktestGates => {
  const source =
    value && typeof value === "object"
      ? (value as Partial<GoldilocksBacktestGates>)
      : {};
  const normalized = Object.fromEntries(
    Object.entries(GOLDILOCKS_BACKTEST_GATE_DEFAULTS).map(([key, fallback]) => [
      key,
      typeof source[key as keyof GoldilocksBacktestGates] === "boolean"
        ? source[key as keyof GoldilocksBacktestGates]
        : fallback,
    ]),
  ) as GoldilocksBacktestGates;
  // Retained in the saved-config type only so older runs remain readable.
  // Departure shock is diagnostic and approach evidence belongs to the score.
  return {
    ...normalized,
    departureQuality: false,
    adverseApproach: false,
  };
};

export const GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS = {
  maximumPriorTouches: 3,
  maxTouchRangeZoneFraction: 0.5,
  maxEntryDistanceZoneFraction: 0.5,
  adverseApproachCandles: 3,
  minimumFastApproachAtr: 1.5,
  minimumFastTouchRangeAtr: 1.5,
  shockRangeAtrMultiple: 3,
  rejectionWickFraction: 0.5,
  minimumShockCloseDepartureZoneMultiple: 1,
  departureStrengthZoneMultiple: 2,
} as const;

export type GoldilocksBacktestTweaks = {
  [K in keyof typeof GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS]: number;
};

export const normalizeGoldilocksBacktestTweaks = (
  value: unknown,
): GoldilocksBacktestTweaks => {
  const source =
    value && typeof value === "object"
      ? (value as Partial<GoldilocksBacktestTweaks>)
      : {};
  return Object.fromEntries(
    Object.entries(GOLDILOCKS_BACKTEST_TWEAK_DEFAULTS).map(
      ([key, fallback]) => {
        const candidate = Number(
          source[key as keyof GoldilocksBacktestTweaks],
        );
        return [
          key,
          Number.isFinite(candidate) && candidate >= 0
            ? candidate
            : fallback,
        ];
      },
    ),
  ) as GoldilocksBacktestTweaks;
};

export const getGoldilocksBacktestRunLabel = (
  profileId: GoldilocksTimeframeProfileId = "intraday",
  ranAt = new Date(),
) =>
  `${getGoldilocksTimeframeProfile(profileId).strategyVersion} · ${ranAt
    .toISOString()
    .slice(0, 10)}`;

export const getGoldilocksMinimumScore = () => {
  const configured = Number(process.env.GOLDILOCKS_MIN_SCORE ?? 14);
  return Number.isFinite(configured)
    ? Math.min(20, Math.max(0, Math.floor(configured)))
    : 14;
};
