import type { GoldilocksTrend } from './goldilocksScanner.ts';
import type { GoldilocksZone } from './goldilocksStrategy.ts';
import { GOLDILOCKS_DEMO_TIMEFRAMES, GOLDILOCKS_SCORE_WEIGHTS, type GoldilocksTimeframeContract } from './goldilocksConfig.ts';

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
  timeframes?:GoldilocksTimeframeContract;
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
  const timeframes=context.timeframes??GOLDILOCKS_DEMO_TIMEFRAMES;
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
  const departureInsideCandleCount=context.zone.departureInsideCandleCount??0;
  const rangePoints=context.rangeAssessment?.aligned===true?GOLDILOCKS_SCORE_WEIGHTS.rangeAlignment:0;
  const baseCompactnessPoints=baseCandleCount===1
    ?GOLDILOCKS_SCORE_WEIGHTS.departureSingleCandleBase
    :baseCandleCount===2
      ?GOLDILOCKS_SCORE_WEIGHTS.departureTwoCandleBase
      :baseCandleCount===3
        ?GOLDILOCKS_SCORE_WEIGHTS.departureThreeCandleBase
        :0;
  const departureImmediacyPoints=departureInsideCandleCount===0
    ?GOLDILOCKS_SCORE_WEIGHTS.departureImmediate
    :departureInsideCandleCount===1
      ?GOLDILOCKS_SCORE_WEIGHTS.departureOneLingeringCandle
      :0;
  const purityPoints=purityTouches===0
    ?GOLDILOCKS_SCORE_WEIGHTS.purityFresh
    :purityTouches===1&&purityMaxPenetration<0.5
      ?GOLDILOCKS_SCORE_WEIGHTS.puritySingleShallowRetouch
      :0;
  const departurePoints=context.zone.departureMultiple>2?GOLDILOCKS_SCORE_WEIGHTS.departureStrength:0;
  const reversalPoints=context.zone.brokeOppositeLegIn?GOLDILOCKS_SCORE_WEIGHTS.structuralReversal:0;
  const departureQualityPoints=baseCompactnessPoints+departureImmediacyPoints+departurePoints+reversalPoints;
  const rrrPoints=availableRewardRisk>5
    ?GOLDILOCKS_SCORE_WEIGHTS.availableRrrExcellent
    :availableRewardRisk>=3
      ?GOLDILOCKS_SCORE_WEIGHTS.availableRrrGood
      :0;
  const zoneInsideZonePoints=confluenceCount>=3
    ?GOLDILOCKS_SCORE_WEIGHTS.zoneInsideZoneThreeTimeframes
    :confluenceCount>=2
      ?GOLDILOCKS_SCORE_WEIGHTS.zoneInsideZoneTwoTimeframes
      :0;
  const components = [
    {name:`${timeframes.trend} range`,points:rangePoints,detail:`${context.rangeAssessment?.detail??`${timeframes.trend} range unavailable.`} Diagnostic only; no score points.`},
    {name:`${timeframes.trend} trend`,points:aligned?GOLDILOCKS_SCORE_WEIGHTS.trendAlignment:0,detail:`${context.trend} ${timeframes.trend} trend versus ${context.tradeDirection}; neutral scoring is disabled.`},
    {name:`${GOLDILOCKS_DEMO_TIMEFRAMES.zone} departure quality`,points:departureQualityPoints,detail:`${baseCandleCount}-candle base (${baseCompactnessPoints}/3); ${departureInsideCandleCount} lingering in-zone candle(s) before first outside (${departureImmediacyPoints}/2); ${context.zone.departureMultiple.toFixed(2)}x sustained close displacement (${departurePoints}/1); ${context.zone.brokeOppositeLegIn?'structural LL↔HH trend break':'no structural trend break'} (${reversalPoints}/2).`},
    {name:`${timeframes.zone} purity`,points:purityPoints,detail:`${purityTouches} prior qualifying retouch(es); deepest prior penetration ${(purityMaxPenetration*100).toFixed(1)}%.`},
    {name:'Available RRR',points:rrrPoints,detail:`${Number.isFinite(availableRewardRisk)?availableRewardRisk.toFixed(2):'unlimited'}R available before the stored opposing zone.`},
    {name:'Zone inside zone',points:zoneInsideZonePoints,detail:`ZIZ ${Math.min(3,Math.max(1,confluenceCount))}/3: same-side zones overlap across ${Math.min(3,Math.max(1,confluenceCount))} of ${timeframes.confluence.join(', ')}.`},
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
