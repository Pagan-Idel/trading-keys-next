import type { GoldilocksTrend } from './goldilocksScanner.ts';
import type { GoldilocksZone } from './goldilocksStrategy.ts';
import { GOLDILOCKS_SCORE_WEIGHTS } from './goldilocksConfig.ts';

export interface GoldilocksGateResult {
  name: string;
  passed: boolean;
  reason: string;
}

export interface GoldilocksScoreContext {
  zone: GoldilocksZone;
  tradeDirection: 'BUY' | 'SELL';
  trend: GoldilocksTrend;
  gates: GoldilocksGateResult[];
  minimumScore: number;
  purityTouches?: number;
  purityMaxPenetration?: number;
  availableRewardRisk?: number;
  rangeAssessment?: {aligned:boolean|null;detail:string};
}

export interface GoldilocksScoreResult {
  scored: boolean;
  eligible: boolean;
  total: number;
  minimumScore: number;
  components: Array<{ name: string; points: number; detail: string }>;
  gates: GoldilocksGateResult[];
  reason: string;
}

export const scoreGoldilocksSetup = (context: GoldilocksScoreContext): GoldilocksScoreResult => {
  const failedGate = context.gates.find(gate => !gate.passed);
  if (failedGate) {
    return {
      scored: false,
      eligible: false,
      total: 0,
      minimumScore: context.minimumScore,
      components: [],
      gates: context.gates,
      reason: `Not scored because gate failed: ${failedGate.name} — ${failedGate.reason}`,
    };
  }
  const confluenceCount = context.zone.timeframeConfluence?.timeframeCount ?? 1;
  const purityTouches=context.purityTouches??context.zone.touches;
  const purityMaxPenetration=context.purityMaxPenetration??context.zone.maxPenetration;
  const availableRewardRisk=context.availableRewardRisk??0;
  const aligned = (context.tradeDirection === 'BUY' && context.trend === 'bullish')
    || (context.tradeDirection === 'SELL' && context.trend === 'bearish');
  const baseCandleCount=context.zone.baseCandleCount??1;
  const rangePoints=context.rangeAssessment?.aligned===true?GOLDILOCKS_SCORE_WEIGHTS.rangeAlignment:0;
  const timePoints=baseCandleCount<=3?GOLDILOCKS_SCORE_WEIGHTS.baseTimeFast:baseCandleCount<=6?GOLDILOCKS_SCORE_WEIGHTS.baseTimeMedium:0;
  const purityPoints=purityTouches===0
    ?GOLDILOCKS_SCORE_WEIGHTS.purityFresh
    :purityTouches===1&&purityMaxPenetration<0.5
      ?GOLDILOCKS_SCORE_WEIGHTS.puritySingleShallowRetouch
      :0;
  const departurePoints=context.zone.departureMultiple>2?GOLDILOCKS_SCORE_WEIGHTS.departureStrength:0;
  const reversalPoints=context.zone.brokeOppositeLegIn?GOLDILOCKS_SCORE_WEIGHTS.structuralReversal:0;
  const rrrPoints=availableRewardRisk>5
    ?GOLDILOCKS_SCORE_WEIGHTS.availableRrrExcellent
    :availableRewardRisk>=3
      ?GOLDILOCKS_SCORE_WEIGHTS.availableRrrGood
      :0;
  const components = [
    {name:'M15 range',points:rangePoints,detail:context.rangeAssessment?.detail??'M15 range unavailable.'},
    {name:'M15 trend',points:aligned?GOLDILOCKS_SCORE_WEIGHTS.trendAlignment:0,detail:`${context.trend} M15 trend versus ${context.tradeDirection}; neutral scoring is disabled.`},
    {name:'M5 base time',points:timePoints,detail:`${baseCandleCount} candle(s) in the overlapping base cluster.`},
    {name:'M5 purity',points:purityPoints,detail:`${purityTouches} prior qualifying retouch(es); deepest prior penetration ${(purityMaxPenetration*100).toFixed(1)}%.`},
    {name:'M5 strength',points:departurePoints+reversalPoints,detail:`${context.zone.departureMultiple.toFixed(2)}x departure (${departurePoints}/2); ${context.zone.brokeOppositeLegIn?'structural LL↔HH reversal':'continuation leg'} (${reversalPoints}/2).`},
    {name:'Available RRR',points:rrrPoints,detail:`${Number.isFinite(availableRewardRisk)?availableRewardRisk.toFixed(2):'unlimited'}R available before the stored opposing zone.`},
    {name:'MTF confluence',points:Math.min(2,Math.max(0,confluenceCount-1)*GOLDILOCKS_SCORE_WEIGHTS.zoneInsideZonePerAdditionalTimeframe),detail:`${confluenceCount}/3 timeframes overlap.`},
  ];
  const total = components.reduce((sum, component) => sum + component.points, 0);
  return {
    scored: true,
    eligible: total >= context.minimumScore,
    total,
    minimumScore: context.minimumScore,
    components,
    gates: context.gates,
    reason: total >= context.minimumScore
      ? `Score ${total} meets the configured minimum ${context.minimumScore}.`
      : `Score ${total} is below the configured minimum ${context.minimumScore}.`,
  };
};
