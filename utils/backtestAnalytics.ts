export interface BacktestPerformanceTrade {
  realizedR: number | null | undefined;
  confirmationTime?: number;
}

export interface BacktestPerformanceMetrics {
  sampleTrades: number;
  omittedTrades: number;
  profitableTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  profitableRate: number;
  averageWinR: number | null;
  averageLossR: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  payoffRatio: number | null;
  breakEvenWinRate: number | null;
  netR: number;
  maxDrawdownR: number;
  longestLosingStreak: number;
}

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export const calculateBacktestPerformance = (
  source: BacktestPerformanceTrade[],
): BacktestPerformanceMetrics => {
  const ordered = source
    .map((trade, index) => ({
      index,
      time: Number(trade.confirmationTime ?? index),
      realizedR: trade.realizedR == null ? null : Number(trade.realizedR),
    }))
    .sort((left, right) => left.time - right.time || left.index - right.index);
  const results = ordered.filter(
    (trade): trade is typeof trade & { realizedR: number } =>
      trade.realizedR != null && Number.isFinite(trade.realizedR),
  );
  const wins = results.filter((trade) => trade.realizedR > 0).map((trade) => trade.realizedR);
  const losses = results.filter((trade) => trade.realizedR < 0).map((trade) => trade.realizedR);
  const breakEvens = results.filter((trade) => trade.realizedR === 0).length;
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const averageWinR = average(wins);
  const averageLossR = average(losses.map(Math.abs));
  const netR = grossProfit - grossLoss;

  let peakR = 0;
  let cumulativeR = 0;
  let maxDrawdownR = 0;
  let losingStreak = 0;
  let longestLosingStreak = 0;
  for (const trade of results) {
    cumulativeR += trade.realizedR;
    peakR = Math.max(peakR, cumulativeR);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - cumulativeR);
    if (trade.realizedR < 0) {
      losingStreak += 1;
      longestLosingStreak = Math.max(longestLosingStreak, losingStreak);
    } else {
      losingStreak = 0;
    }
  }

  return {
    sampleTrades: results.length,
    omittedTrades: source.length - results.length,
    profitableTrades: wins.length,
    losingTrades: losses.length,
    breakEvenTrades: breakEvens,
    profitableRate: results.length ? (wins.length / results.length) * 100 : 0,
    averageWinR,
    averageLossR,
    expectancyR: results.length ? netR / results.length : null,
    profitFactor:
      grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null,
    payoffRatio:
      averageWinR != null && averageLossR != null && averageLossR > 0
        ? averageWinR / averageLossR
        : null,
    breakEvenWinRate:
      averageWinR != null && averageLossR != null && averageWinR + averageLossR > 0
        ? (averageLossR / (averageWinR + averageLossR)) * 100
        : null,
    netR,
    maxDrawdownR,
    longestLosingStreak,
  };
};
