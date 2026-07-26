export interface PortfolioMarginPolicy {
  maximumPortfolioRiskFraction: number;
  maximumProjectedCloseoutPercent: number;
  minimumAvailableMarginNavFraction: number;
  unknownOpenTradeRiskFraction: number;
  reservationTtlMs: number;
}

export const DEFAULT_PORTFOLIO_MARGIN_POLICY: PortfolioMarginPolicy = {
  maximumPortfolioRiskFraction: 0.02,
  maximumProjectedCloseoutPercent: 0.25,
  minimumAvailableMarginNavFraction: 0.5,
  unknownOpenTradeRiskFraction: 0.01,
  reservationTtlMs: 120_000,
};

// OANDA v20 defines Margin Closeout % as 50% of margin used divided by
// midpoint NAV. Regular marginUsed/marginAvailable still use the full amount.
export const OANDA_MARGIN_CLOSEOUT_FACTOR = 0.5;

const OANDA_US_MAJOR_PAIRS = new Set([
  "EUR/USD",
  "GBP/USD",
  "AUD/USD",
  "NZD/USD",
  "USD/CAD",
  "USD/CHF",
  "USD/JPY",
]);

const finiteNonNegative = (value: number) =>
  Number.isFinite(value) && value >= 0;

export const minimumOandaMarginRate = (pair: string) =>
  OANDA_US_MAJOR_PAIRS.has(pair.replace("_", "/").toUpperCase()) ? 0.02 : 0.05;

export const effectiveOandaMarginRate = (
  pair: string,
  accountMarginRate: number,
) =>
  Math.max(
    minimumOandaMarginRate(pair),
    finiteNonNegative(accountMarginRate) ? accountMarginRate : 0,
  );

export const estimateMarginFromStopRisk = (input: {
  pair: string;
  entry: number;
  stopLoss: number;
  riskAmount: number;
  accountMarginRate: number;
}) => {
  const entry = Math.abs(input.entry);
  const stopFraction =
    entry > 0 ? Math.abs(input.entry - input.stopLoss) / entry : 0;
  const notionalValue =
    stopFraction > 0 && finiteNonNegative(input.riskAmount)
      ? input.riskAmount / stopFraction
      : Number.POSITIVE_INFINITY;
  const marginRate = effectiveOandaMarginRate(
    input.pair,
    input.accountMarginRate,
  );
  return {
    stopFraction,
    notionalValue,
    marginRate,
    requiredMargin: notionalValue * marginRate,
  };
};

export interface PortfolioMarginAdmissionInput {
  nav: number;
  marginAvailable: number;
  marginUsed: number;
  marginCloseoutNav: number;
  marginCloseoutPercent: number;
  reservedMargin: number;
  openRiskAmount: number;
  reservedRiskAmount: number;
  proposedMargin: number;
  proposedRiskAmount: number;
}

export interface PortfolioMarginAdmission {
  allowed: boolean;
  reason: string;
  projectedAvailableMargin: number;
  projectedAvailableMarginNavFraction: number;
  projectedCloseoutPercent: number;
  projectedPortfolioRiskAmount: number;
  projectedPortfolioRiskFraction: number;
}

export const assessPortfolioMarginAdmission = (
  input: PortfolioMarginAdmissionInput,
  policy: PortfolioMarginPolicy = DEFAULT_PORTFOLIO_MARGIN_POLICY,
): PortfolioMarginAdmission => {
  const required = [
    input.nav,
    input.marginAvailable,
    input.marginUsed,
    input.marginCloseoutNav,
    input.marginCloseoutPercent,
    input.reservedMargin,
    input.openRiskAmount,
    input.reservedRiskAmount,
    input.proposedMargin,
    input.proposedRiskAmount,
  ];
  if (
    required.some((value) => !finiteNonNegative(value)) ||
    input.nav <= 0 ||
    input.marginCloseoutNav <= 0
  ) {
    return {
      allowed: false,
      reason:
        "Portfolio margin rejected because the broker account snapshot or proposed exposure is incomplete.",
      projectedAvailableMargin: 0,
      projectedAvailableMarginNavFraction: 0,
      projectedCloseoutPercent: Number.POSITIVE_INFINITY,
      projectedPortfolioRiskAmount: Number.POSITIVE_INFINITY,
      projectedPortfolioRiskFraction: Number.POSITIVE_INFINITY,
    };
  }

  const projectedAvailableMargin =
    input.marginAvailable - input.reservedMargin - input.proposedMargin;
  const projectedAvailableMarginNavFraction =
    projectedAvailableMargin / input.nav;
  const projectedCloseoutPercent =
    input.marginCloseoutPercent +
    ((input.reservedMargin + input.proposedMargin) *
      OANDA_MARGIN_CLOSEOUT_FACTOR) /
      input.marginCloseoutNav;
  const projectedPortfolioRiskAmount =
    input.openRiskAmount +
    input.reservedRiskAmount +
    input.proposedRiskAmount;
  const projectedPortfolioRiskFraction =
    projectedPortfolioRiskAmount / input.nav;

  const summary = {
    projectedAvailableMargin,
    projectedAvailableMarginNavFraction,
    projectedCloseoutPercent,
    projectedPortfolioRiskAmount,
    projectedPortfolioRiskFraction,
  };
  if (projectedAvailableMargin < 0)
    return {
      allowed: false,
      reason:
        "Portfolio margin rejected because the proposed trade exceeds broker-reported available margin after active reservations.",
      ...summary,
    };
  if (
    projectedAvailableMarginNavFraction <
    policy.minimumAvailableMarginNavFraction
  )
    return {
      allowed: false,
      reason: `Portfolio margin rejected because available-margin headroom would fall below ${(policy.minimumAvailableMarginNavFraction * 100).toFixed(0)}% of NAV.`,
      ...summary,
    };
  if (
    projectedCloseoutPercent > policy.maximumProjectedCloseoutPercent
  )
    return {
      allowed: false,
      reason: `Portfolio margin rejected because projected closeout utilization would exceed ${(policy.maximumProjectedCloseoutPercent * 100).toFixed(0)}%.`,
      ...summary,
    };
  if (
    projectedPortfolioRiskFraction > policy.maximumPortfolioRiskFraction
  )
    return {
      allowed: false,
      reason: `Portfolio risk rejected because combined open stop-risk would exceed ${(policy.maximumPortfolioRiskFraction * 100).toFixed(0)}% of NAV.`,
      ...summary,
    };
  return {
    allowed: true,
    reason: `Portfolio admission passed with ${(projectedAvailableMarginNavFraction * 100).toFixed(1)}% NAV available-margin headroom, ${(projectedCloseoutPercent * 100).toFixed(1)}% projected closeout utilization, and ${(projectedPortfolioRiskFraction * 100).toFixed(2)}% combined stop-risk.`,
    ...summary,
  };
};
