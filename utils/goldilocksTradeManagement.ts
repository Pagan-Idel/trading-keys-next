export const GOLDILOCKS_DEFAULT_MANAGEMENT = {
  policyId: "secure-50-at-1r-rest-2r-v1",
  partialAtR: 1,
  partialCloseFraction: 0.5,
  breakEvenAtR: 1,
  finalTargetR: 2,
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
    label: "Secure half at 1R (default)",
    description:
      "At +1R, bank 50% and move the remaining 50% stop to break-even; final target stays at 2R.",
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

export const goldilocksRealizedRAtTarget = () =>
  goldilocksSecuredRAtBreakEven() +
  GOLDILOCKS_DEFAULT_MANAGEMENT.finalTargetR *
    (1 - GOLDILOCKS_DEFAULT_MANAGEMENT.partialCloseFraction);
