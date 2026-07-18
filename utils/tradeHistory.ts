import { getLoginMode } from './loginState';
import { saveTradeToDatabase } from './automationStore';
import type { RiskProfile } from './dynamicRisk';
import type { GoldilocksApproachPressure } from './approachPressure';
import type { ZoneCorridorMeasurement } from './zoneCorridor';
import type { TradePathSummary } from './tradeManagementResearch';

export type JournalData = {
  swingA?: unknown;
  swingB?: unknown;
  direction: 'BUY' | 'SELL';
  range?: number;
  rrZone?: { low: number; high: number };
  spread: {
    bid: string;
    ask: string;
    raw: number;
    buffer: number;
    pipSize: number;
  };
  tf: string;
  timestamp: string;
  goldilocks?: {
    zoneId?: string;
    kind?: string;
    side?: string;
    touches?: number;
    candleTime?: number;
    confirmationTime?: number;
    zoneAgeSeconds?: number;
    score?: { total?: number };
    riskProfile?: RiskProfile;
    riskPercentage?: number;
    approachPressure?: GoldilocksApproachPressure;
    zoneCorridors?: ZoneCorridorMeasurement[];
  };
  tradeManagement?: {
    breakEvenAtOneR: boolean;
    breakEvenActivated: boolean;
    breakEvenActivatedAt?: string;
    breakEvenPrice?: number;
    weekendLiquidation?: boolean;
    weekendLiquidatedAt?: string;
    policyId?: string;
    path?: TradePathSummary;
  };
};

export const classifyTradeOutcome = (realizedPL: string | undefined, breakEvenActivated = false): 'WIN' | 'LOSS' => {
  if (breakEvenActivated) return 'WIN';
  const numericPL = Number(realizedPL ?? 0);
  return Number.isFinite(numericPL) && numericPL > 0 ? 'WIN' : 'LOSS';
};

export async function saveTradeRecord(
  tradeId: string,
  pair: string,
  entry: number,
  sl: number,
  tp: number,
  orderSide: 'BUY' | 'SELL',
  journalData: JournalData,
  outcome: 'WIN' | 'LOSS',
  realizedPL?: string,
  mode: 'live' | 'demo' = getLoginMode(),
  breakEvenActivated = false,
) {
  outcome = classifyTradeOutcome(realizedPL, breakEvenActivated);

  saveTradeToDatabase({
    tradeId,
    pair,
    entry,
    sl,
    tp,
    orderSide,
    journalData,
    outcome,
    closedAt: new Date().toISOString(),
    realizedPL,
    mode,
    score: journalData.goldilocks?.score?.total,
    riskProfile: journalData.goldilocks?.riskProfile,
    riskPercentage: journalData.goldilocks?.riskPercentage,
  });
}
