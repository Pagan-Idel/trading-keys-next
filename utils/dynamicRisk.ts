export type RiskProfile = 'easy' | 'default' | 'aggressive';

export const RISK_PROFILES: Record<RiskProfile, { label: string; minimumRisk: number; maximumRisk: number }> = {
  easy: { label: 'Easy', minimumRisk: 0.10, maximumRisk: 0.25 },
  default: { label: 'Default', minimumRisk: 0.25, maximumRisk: 0.50 },
  aggressive: { label: 'Aggressive', minimumRisk: 0.50, maximumRisk: 1.00 },
};

export const isRiskProfile = (value: unknown): value is RiskProfile =>
  typeof value === 'string' && value in RISK_PROFILES;

export const calculateScoreRisk = (score: number, minimumScore: number, profile: RiskProfile) => {
  const curve = RISK_PROFILES[profile];
  const eligibleFloor = Math.min(20, Math.max(0, minimumScore));
  const boundedScore = Math.min(20, Math.max(eligibleFloor, score));
  const progress = eligibleFloor >= 20 ? 1 : (boundedScore - eligibleFloor) / (20 - eligibleFloor);
  const riskPercentage = curve.minimumRisk + (curve.maximumRisk - curve.minimumRisk) * progress;
  return {
    profile,
    score: boundedScore,
    minimumScore: eligibleFloor,
    progress,
    riskPercentage: Number(riskPercentage.toFixed(3)),
    minimumRisk: curve.minimumRisk,
    maximumRisk: curve.maximumRisk,
  };
};
