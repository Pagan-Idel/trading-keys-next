export const MAX_SPREAD_PIPS = 3;

export interface SpreadCheck {
  allowed: boolean;
  bid: number;
  ask: number;
  rawSpread: number;
  spreadPips: number;
  pipSize: number;
  maxSpread: number;
  buffer: number;
  reason: string;
}

export const getPipSize = (pair: string) => pair.toUpperCase().includes('JPY') ? 0.01 : 0.0001;

export const evaluateSpread = (pair: string, bid: number, ask: number): SpreadCheck => {
  const pipSize = getPipSize(pair);
  const maxSpread = MAX_SPREAD_PIPS * pipSize;
  const rawSpread = ask - bid;
  const validQuote = Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > bid;
  const allowed = validQuote && rawSpread <= maxSpread + Number.EPSILON;
  return {
    allowed,
    bid,
    ask,
    rawSpread,
    spreadPips: rawSpread / pipSize,
    pipSize,
    maxSpread,
    buffer: allowed ? rawSpread : 0,
    reason: !validQuote
      ? 'Rejected: bid/ask quote is missing or invalid.'
      : allowed
        ? `Spread accepted at ${(rawSpread / pipSize).toFixed(2)} pips (maximum ${MAX_SPREAD_PIPS}).`
        : `Rejected: spread is ${(rawSpread / pipSize).toFixed(2)} pips (maximum ${MAX_SPREAD_PIPS}).`,
  };
};

export const applySpreadBuffer = (
  direction: 'BUY' | 'SELL',
  stopLoss: number,
  takeProfit: number,
  buffer: number,
) => direction === 'BUY'
  ? { stopLoss: stopLoss - buffer, takeProfit: takeProfit + buffer }
  : { stopLoss: stopLoss + buffer, takeProfit: takeProfit - buffer };

export const calculateExactRiskRewardLevels = (
  direction: 'BUY' | 'SELL',
  executableEntry: number,
  zoneStop: number,
  rewardRisk: number,
) => {
  const risk = direction === 'BUY'
    ? executableEntry - zoneStop
    : zoneStop - executableEntry;
  if (!Number.isFinite(risk) || risk <= 0 || !Number.isFinite(rewardRisk) || rewardRisk <= 0) {
    return null;
  }
  return {
    entry: executableEntry,
    stopLoss: zoneStop,
    takeProfit: direction === 'BUY'
      ? executableEntry + risk * rewardRisk
      : executableEntry - risk * rewardRisk,
    risk,
    reward: risk * rewardRisk,
    ratio: rewardRisk,
  };
};
