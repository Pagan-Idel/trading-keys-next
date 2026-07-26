export const GOLDILOCKS_DEFAULT_MANAGEMENT = {
  policyId: "secure-50-at-1r-rest-2r-v1",
  partialAtR: 1,
  partialCloseFraction: 0.5,
  breakEvenAtR: 1,
  finalTargetR: 2,
} as const;

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
