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
export const GOLDILOCKS_UNTOUCHED_STOP_RUNNER_MANAGEMENT_ID =
  "bank-half-untouched-stop-runner-v1" as const;
export const GOLDILOCKS_ADAPTIVE_SCALE_OUT_MANAGEMENT_ID =
  "adaptive-attack-scale-out-runner-v1" as const;

export type GoldilocksBacktestManagerId =
  | typeof GOLDILOCKS_DEFAULT_MANAGEMENT.policyId
  | typeof GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID
  | typeof GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID
  | typeof GOLDILOCKS_UNTOUCHED_STOP_RUNNER_MANAGEMENT_ID
  | typeof GOLDILOCKS_ADAPTIVE_SCALE_OUT_MANAGEMENT_ID;

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
    label: "Set and forget · fixed RR",
    description:
      "Place the trade with its original stop and selected fixed-R target. Make no profit-management changes before either level is hit; the mandatory Friday close still applies.",
  },
  {
    id: GOLDILOCKS_UNTOUCHED_STOP_RUNNER_MANAGEMENT_ID,
    label: "Bank Half + Untouched-Stop Runner",
    description:
      "At +1R, bank 50% and remove the take-profit, but never move the original stop. The remaining 50% runs until that original stop or the mandatory Friday close.",
  },
  {
    id: GOLDILOCKS_ADAPTIVE_SCALE_OUT_MANAGEMENT_ID,
    label: "Adaptive Attack Scale-Out + Untouched Runner",
    description:
      "At +1R, +2R, and +3R, bank 25% of the original position when the preceding 0.5R attack completed within 30 minutes, otherwise bank up to 50%. Always retain a final 25% runner and never move the original stop.",
  },
];

export const normalizeGoldilocksBacktestManager = (
  value: unknown,
): GoldilocksBacktestManagerId =>
  value === GOLDILOCKS_LEGACY_SCORE_TIERED_MANAGEMENT_ID ||
  value === GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID ||
  value === GOLDILOCKS_UNTOUCHED_STOP_RUNNER_MANAGEMENT_ID ||
  value === GOLDILOCKS_ADAPTIVE_SCALE_OUT_MANAGEMENT_ID
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

export interface GoldilocksScaleOut {
  time: number;
  milestoneR: number;
  fraction: number;
  realizedR: number;
  attackSeconds: number | null;
  momentum: "fast" | "slow";
  kind: "milestone" | "risk_off";
}

export const resolveGoldilocksAdaptiveScaleOut = ({
  candles,
  startIndex,
  direction,
  stopLoss,
  oneR,
  weekendLiquidationTime,
}: {
  candles: ReadonlyArray<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
  startIndex: number;
  direction: "BUY" | "SELL";
  stopLoss: number;
  oneR: number;
  weekendLiquidationTime?: number;
}) => {
  const entry = (stopLoss + oneR) / 2;
  const risk = Math.abs(entry - stopLoss);
  const milestones = [1, 2, 3] as const;
  const halfReachedAt = new Map<number, number>();
  const scaleOuts: GoldilocksScaleOut[] = [];
  let remainingFraction = 1;
  let realizedR = 0;
  let nextMilestoneIndex = 0;
  let favorableExtremeR = 0;
  const rAt = (price: number) =>
    (direction === "BUY" ? price - entry : entry - price) / risk;
  for (let index = startIndex; index < candles.length; index += 1) {
    const candle = candles[index];
    if (
      weekendLiquidationTime !== undefined &&
      candle.time >= weekendLiquidationTime
    ) {
      const exitR = Math.max(-1, rAt(candle.open));
      return {
        outcome: (realizedR + remainingFraction * exitR > 0 ||
        scaleOuts.length
          ? "WIN"
          : "LOSS") as "WIN" | "LOSS",
        outcomeTime: candle.time,
        exitReason: "weekend_close" as const,
        realizedR: realizedR + remainingFraction * exitR,
        partialExits: scaleOuts,
      };
    }
    const stopped =
      direction === "BUY" ? candle.low <= stopLoss : candle.high >= stopLoss;
    if (stopped)
      return {
        outcome: (scaleOuts.length ? "WIN" : "LOSS") as "WIN" | "LOSS",
        outcomeTime: candle.time,
        exitReason: scaleOuts.length
          ? ("runner_stop" as const)
          : ("stop" as const),
        realizedR: realizedR - remainingFraction,
        partialExits: scaleOuts,
      };
    const favorableR = rAt(
      direction === "BUY" ? candle.high : candle.low,
    );
    const adverseR = rAt(direction === "BUY" ? candle.low : candle.high);
    if (
      scaleOuts.length &&
      scaleOuts.at(-1)?.kind === "milestone" &&
      scaleOuts.at(-1)?.momentum === "fast" &&
      remainingFraction > 0.25 &&
      adverseR <= favorableExtremeR - 0.5
    ) {
      const fraction = remainingFraction - 0.25;
      const exitR = favorableExtremeR - 0.5;
      const banked = fraction * exitR;
      realizedR += banked;
      remainingFraction = 0.25;
      scaleOuts.push({
        time: candle.time,
        milestoneR: exitR,
        fraction,
        realizedR: banked,
        attackSeconds: null,
        momentum: "slow",
        kind: "risk_off",
      });
    }
    for (const milestone of milestones)
      if (
        favorableR >= milestone - 0.5 &&
        !halfReachedAt.has(milestone)
      )
        halfReachedAt.set(milestone, candle.time);
    while (
      nextMilestoneIndex < milestones.length &&
      favorableR >= milestones[nextMilestoneIndex] &&
      remainingFraction > 0.25
    ) {
      const milestoneR = milestones[nextMilestoneIndex];
      const halfTime = halfReachedAt.get(milestoneR);
      const attackSeconds =
        halfTime === undefined ? null : Math.max(0, candle.time - halfTime);
      const momentum =
        attackSeconds !== null && attackSeconds <= 30 * 60 ? "fast" : "slow";
      const desiredFraction = momentum === "fast" ? 0.25 : 0.5;
      const fraction = Math.min(
        desiredFraction,
        remainingFraction - 0.25,
      );
      if (fraction > 0) {
        const banked = fraction * milestoneR;
        realizedR += banked;
        remainingFraction -= fraction;
        scaleOuts.push({
          time: candle.time,
          milestoneR,
          fraction,
          realizedR: banked,
          attackSeconds,
          momentum,
          kind: "milestone",
        });
      }
      nextMilestoneIndex += 1;
    }
    favorableExtremeR = Math.max(favorableExtremeR, favorableR);
  }
  if (!candles.length) return null;
  const last = candles[candles.length - 1];
  return {
    outcome: (scaleOuts.length ? "WIN" : "LOSS") as "WIN" | "LOSS",
    outcomeTime: last.time,
    exitReason: scaleOuts.length
      ? ("runner_open" as const)
      : ("stop" as const),
    realizedR: realizedR + remainingFraction * Math.max(-1, rAt(last.close)),
    partialExits: scaleOuts,
  };
};

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
