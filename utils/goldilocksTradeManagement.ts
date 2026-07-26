export const GOLDILOCKS_DEFAULT_MANAGEMENT = {
  policyId: "secure-half-atr-runner-v3",
  partialAtR: 1,
  partialCloseFraction: 0.5,
  breakEvenAtR: 1,
  trailingAtrPeriod: 14,
  trailingAtrMultiplier: 2,
} as const;

export const GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID =
  "legacy-score-tiered-2r-4r-v1" as const;
export const GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID =
  "set-and-forget-2r-v1" as const;

export type GoldilocksBacktestManagerId =
  | typeof GOLDILOCKS_DEFAULT_MANAGEMENT.policyId
  | typeof GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID
  | typeof GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID;

export const GOLDILOCKS_BACKTEST_MANAGERS: ReadonlyArray<{
  id: GoldilocksBacktestManagerId;
  label: string;
  description: string;
}> = [
  {
    id: GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,
    label: "Secure Half + ATR Runner (default)",
    description:
      "At +1R, bank 50%, cancel the take-profit, and trail the remaining 50% with a 2× ATR(14) stop that never moves behind break-even.",
  },
  {
    id: GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID,
    label: "Break-even strategy (previous)",
    description:
      "Move to break-even at +1R. Scores below 16 exit fully at 2R; scores 16–17 keep a 25% runner and scores 18+ keep a 50% runner toward 4R with a +1R runner stop.",
  },
  {
    id: GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID,
    label: "Set and forget · full 2R",
    description:
      "Place the trade with its original stop and full 2R target. Make no profit-management changes before either level is hit; the mandatory Friday close still applies.",
  },
];

export const normalizeGoldilocksBacktestManager = (
  value: unknown,
): GoldilocksBacktestManagerId =>
  value === GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID ||
  value === GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID
    ? value
    : GOLDILOCKS_DEFAULT_MANAGEMENT.policyId;

export const getGoldilocksBacktestManager = (value: unknown) => {
  const id = normalizeGoldilocksBacktestManager(value);
  return GOLDILOCKS_BACKTEST_MANAGERS.find((manager) => manager.id === id)!;
};

export const getGoldilocksBacktestManagerForRun = (
  value: unknown,
  strategyVersion?: string,
) => {
  if (typeof value === "string") return getGoldilocksBacktestManager(value);
  const numericVersion = Number(strategyVersion);
  return getGoldilocksBacktestManager(
    Number.isFinite(numericVersion) && numericVersion <= 0.4
      ? GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID
      : GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,
  );
};

export interface GoldilocksPartialClosePlan {
  supported: boolean;
  initialUnits: number;
  currentUnits: number;
  targetRemainingUnits: number;
  unitsToClose: number;
  completed: boolean;
}

export const getGoldilocksPartialClosePlan = (
  initialUnitsValue: string | number | undefined,
  currentUnitsValue: string | number | undefined,
): GoldilocksPartialClosePlan => {
  const initialUnits = Math.floor(
    Math.abs(Number(initialUnitsValue ?? currentUnitsValue ?? 0)),
  );
  const currentUnits = Math.floor(
    Math.abs(Number(currentUnitsValue ?? initialUnitsValue ?? 0)),
  );
  const targetCloseUnits = Math.floor(
    initialUnits * GOLDILOCKS_DEFAULT_MANAGEMENT.partialCloseFraction,
  );
  const targetRemainingUnits = initialUnits - targetCloseUnits;
  const supported =
    initialUnits >= 2 && targetCloseUnits >= 1 && targetRemainingUnits >= 1;
  const completed =
    supported && currentUnits > 0 && currentUnits <= targetRemainingUnits;
  return {
    supported,
    initialUnits,
    currentUnits,
    targetRemainingUnits,
    unitsToClose:
      supported && !completed
        ? Math.max(0, currentUnits - targetRemainingUnits)
        : 0,
    completed,
  };
};

export const goldilocksSecuredRAtBreakEven = () =>
  GOLDILOCKS_DEFAULT_MANAGEMENT.partialAtR *
  GOLDILOCKS_DEFAULT_MANAGEMENT.partialCloseFraction;

export const calculateAtr = (
  candles: ReadonlyArray<{ high: number; low: number; close: number }>,
  period = GOLDILOCKS_DEFAULT_MANAGEMENT.trailingAtrPeriod,
) => {
  if (candles.length < period + 1) return null;
  const ranges = candles.slice(-period).map((candle, index, selected) => {
    const sourceIndex = candles.length - selected.length + index;
    const previousClose = candles[sourceIndex - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  const atr = ranges.reduce((sum, value) => sum + value, 0) / period;
  return Number.isFinite(atr) && atr > 0 ? atr : null;
};

export const getGoldilocksAtrTrailingStop = ({
  direction,
  entry,
  currentStop,
  favorableExtreme,
  atr,
}: {
  direction: "BUY" | "SELL";
  entry: number;
  currentStop: number;
  favorableExtreme: number;
  atr: number;
}) => {
  const distance =
    atr * GOLDILOCKS_DEFAULT_MANAGEMENT.trailingAtrMultiplier;
  return direction === "BUY"
    ? Math.max(currentStop, entry, favorableExtreme - distance)
    : Math.min(currentStop, entry, favorableExtreme + distance);
};
