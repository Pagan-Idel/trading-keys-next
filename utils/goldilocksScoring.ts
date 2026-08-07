import type { GoldilocksTrend } from './goldilocksScanner.ts';
import type { GoldilocksZone } from './goldilocksStrategy.ts';
import { GOLDILOCKS_DEMO_TIMEFRAMES, normalizeGoldilocksScoreWeights, type GoldilocksBacktestTweaks, type GoldilocksScoreWeights, type GoldilocksTimeframeContract } from './goldilocksConfig.ts';

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
  timeframes?:GoldilocksTimeframeContract;
  strategyTweaks?:GoldilocksBacktestTweaks;
  scoreWeights?:GoldilocksScoreWeights;
  adverseWarningCount?:number;
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
  const weights=normalizeGoldilocksScoreWeights(context.scoreWeights);
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
  const aligned = (context.tradeDirection === 'BUY' && context.trend === 'bullish')
    || (context.tradeDirection === 'SELL' && context.trend === 'bearish');
  const baseCandleCount=context.zone.baseCandleCount??1;
  const departureInsideCandleCount=context.zone.departureInsideCandleCount??0;
  const formationCandleCount=baseCandleCount+departureInsideCandleCount;
  const formationCompactnessPoints=formationCandleCount===1
    ?weights.departureSingleCandleBase
    :formationCandleCount===2
      ?weights.departureTwoCandleBase
      :formationCandleCount===3
        ?weights.departureThreeCandleBase
        :0;
  const purityPoints=purityTouches===0
    ?weights.purityFresh
    :purityTouches===1
      ?weights.puritySingleRetouch
      :0;
  const departureStrengthTier=context.zone.departureMultiple<2
    ?0
    :context.zone.departureMultiple<4?1:2;
  const departurePoints=(departureStrengthTier/2)*weights.departureStrength;
  const adverseWarningCount=Math.max(0,Math.min(2,Math.floor(context.adverseWarningCount??0)));
  const approachWarningFraction=[1,0.6,0][adverseWarningCount]??0;
  const approachWarningPoints=approachWarningFraction*weights.approachNoWarnings;
  const departureQualityPoints=formationCompactnessPoints+departurePoints;
  const zoneInsideZonePoints=confluenceCount>=3
    ?weights.zoneInsideZoneThreeTimeframes
    :confluenceCount>=2
      ?weights.zoneInsideZoneTwoTimeframes
      :0;
  const components = [
    {name:`${timeframes.trend} trend`,points:aligned?weights.trendAlignment:0,detail:`${context.trend} ${timeframes.trend} trend versus ${context.tradeDirection}; neutral scoring is disabled.`},
    {name:`${timeframes.zone} departure quality`,points:departureQualityPoints,detail:`${formationCandleCount} ${timeframes.zone} formation candle(s) from base through the candle before first qualifying departure (${formationCompactnessPoints}/3); ${context.zone.departureMultiple.toFixed(2)}x sustained close displacement, tier ${departureStrengthTier}/2 (${departurePoints}/${weights.departureStrength}).`},
    {name:`${timeframes.confirmation} approach warnings`,points:approachWarningPoints,detail:`${adverseWarningCount}/2 adverse approach warning categories. Zero warnings earns 5 points; one earns 3; both earn none. The categories are a confirmed liquidity-pool sweep and a fast momentum approach into the zone. Compression is measured but not penalized.`},
    {name:`${timeframes.confirmation} purity`,points:purityPoints,detail:`${purityTouches} prior qualifying confirmation-timeframe touch candle(s). Any candle that intersects the zone counts as one touch, regardless of depth.`},
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
