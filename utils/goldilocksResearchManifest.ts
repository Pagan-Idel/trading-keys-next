import {RISK_PROFILES} from './dynamicRisk.ts';
import {
  GOLDILOCKS_DEPARTURE_QUALITY,GOLDILOCKS_ENTRY_PROXIMITY,GOLDILOCKS_RESEARCH_VERSION,
  GOLDILOCKS_SCORE_WEIGHTS,getGoldilocksTimeframeProfile,type GoldilocksTimeframeProfileId,
} from './goldilocksConfig.ts';
import {GOLDILOCKS_MANAGEMENT_POLICIES,GOLDILOCKS_RESEARCH_SCHEMA_VERSION} from './tradeManagementResearch.ts';
import {MAX_SPREAD_PIPS} from './spreadGuard.ts';
import {
  FOREX_MARKET_TIME_ZONE,FOREX_REOPEN_BUFFER_END_HOUR,FOREX_WEEKEND_LIQUIDATION_HOUR,
  FOREX_WEEKLY_CLOSE_HOUR,FOREX_WEEKLY_OPEN_HOUR,
} from './forexMarketHours.ts';

export const GOLDILOCKS_RESEARCH_MANIFEST_VERSION='goldilocks-configuration-manifest-v1';

export interface GoldilocksResearchManifest {
  manifestVersion:string;
  capturedAt:string;
  versions:Record<string,string>;
  timeframeContract:Record<string,unknown>;
  hardGates:Array<{id:string;name:string;rule:string;value?:unknown}>;
  score:{minimum:number;maximum:number;weights:Record<string,number>;components:Array<Record<string,unknown>>};
  zoneRules:Array<{name:string;rule:string;value?:unknown}>;
  confirmationAndExecution:Array<{name:string;rule:string;value?:unknown}>;
  researchDiagnostics:Array<{name:string;scored:boolean;rule:string;thresholds?:Record<string,number>}>;
  riskProfiles:typeof RISK_PROFILES;
  managementPolicies:typeof GOLDILOCKS_MANAGEMENT_POLICIES;
  knownSimulatorOmissions:string[];
}

export const buildGoldilocksResearchManifest=(timeframeProfile:GoldilocksTimeframeProfileId,minimumScore:number):GoldilocksResearchManifest=>{
  const profile=getGoldilocksTimeframeProfile(timeframeProfile);
  return {
    manifestVersion:GOLDILOCKS_RESEARCH_MANIFEST_VERSION,
    capturedAt:new Date().toISOString(),
    versions:{researchEngine:GOLDILOCKS_RESEARCH_VERSION,strategy:profile.strategyVersion,trainingSchema:GOLDILOCKS_RESEARCH_SCHEMA_VERSION},
    timeframeContract:{
      profileId:profile.id,label:profile.label,trend:profile.trend,zone:profile.zone,zoneLifecycle:profile.zone,
      firstTouch:profile.confirmation,laterConfirmation:profile.confirmation,executionResolution:profile.execution,
      confluence:[...profile.confluence],lookbackDays:profile.defaultLookbackDays,
    },
    hardGates:[
      {id:'market_open',name:'Forex market',rule:'Market must be open under the DST-aware New York calendar.',value:{timeZone:FOREX_MARKET_TIME_ZONE,weeklyOpenHour:FOREX_WEEKLY_OPEN_HOUR,weeklyCloseHour:FOREX_WEEKLY_CLOSE_HOUR}},
      {id:'weekly_entry',name:'Weekly close/reopen',rule:'Reject entries from Friday 16:00 through Sunday 18:00 America/New_York.',value:{fridayBlockHour:FOREX_WEEKEND_LIQUIDATION_HOUR,sundayResumeHour:FOREX_REOPEN_BUFFER_END_HOUR}},
      {id:'weekend_liquidation',name:'Weekend liquidation',rule:'Close unresolved trades at Friday 16:00 America/New_York.',value:FOREX_WEEKEND_LIQUIDATION_HOUR},
      {id:'holiday',name:'Historical holiday',rule:'Reject configured full and partial U.S. market holidays using the historical New York market date.'},
      {id:'session',name:'Pair session',rule:'At least one pair currency local session must be open.'},
      {id:'news',name:'High-impact news',rule:'Either pair currency blocks the inclusive one-hour window before and after; missing coverage fails closed.',value:{minutesBefore:60,minutesAfter:60,missingCoverage:'reject'}},
      {id:'existing_trade',name:'Existing pair trade',rule:'Only one open simulated trade per pair.'},
      {id:'zone_validity',name:'Zone validity',rule:'Zone must be active, unbroken, younger than two calendar years, and have no more than three prior touches.',value:{maximumPriorTouches:3,invalidateOnTouch:4,expiryYears:2}},
      {id:'confirmation',name:'Distinct later confirmation',rule:`A completed ${profile.confirmation} candle after the first ${profile.confirmation} touch must close through the touched wick; one candle cannot be both.`},
      {id:'entry_proximity',name:'Entry proximity',rule:'First-touch range, confirmation distance, and executable-entry distance must stay within the configured zone-width limits.',value:GOLDILOCKS_ENTRY_PROXIMITY},
      {id:'departure_shock',name:'Departure shock/rejection',rule:'Reject the combined oversized ATR departure, rejection wick, and weak close-away pattern.',value:GOLDILOCKS_DEPARTURE_QUALITY},
      {id:'spread',name:'Spread',rule:'Executable spread must not exceed the fixed pip ceiling; historical spread remains unavailable.',value:{maximumPips:MAX_SPREAD_PIPS,historicalMode:'not reconstructed'}},
      {id:'runway',name:'2R runway',rule:'The path to exactly 2R must remain clear at confirmation and executable entry.',value:{minimumR:2}},
      {id:'minimum_score',name:'Minimum score',rule:'Every hard gate passes before the 20-point score is calculated; total must meet or exceed the trial threshold.',value:{minimumScore,maximumScore:20}},
    ],
    score:{
      minimum:minimumScore,maximum:20,weights:{...GOLDILOCKS_SCORE_WEIGHTS},components:[
        {name:`${profile.trend} range`,maximum:0,rule:'Diagnostic only; no score points.'},
        {name:`${profile.trend} trend`,maximum:GOLDILOCKS_SCORE_WEIGHTS.trendAlignment,rule:'Full points only when trade direction aligns with the swing trend; otherwise zero.'},
        {name:`${profile.zone} departure quality`,maximum:8,rule:'Compact base + immediate outside candle + sustained close displacement + opposite-leg structural break.',subscores:{singleCandleBase:3,twoCandleBase:2,threeCandleBase:1,immediate:2,oneLingering:1,sustainedCloseDisplacement:1,structuralReversal:2}},
        {name:`${profile.zone} purity`,maximum:GOLDILOCKS_SCORE_WEIGHTS.purityFresh,rule:'Fresh=4; one shallow retouch under 50%=2; otherwise zero.'},
        {name:'Available RRR',maximum:1,rule:'At least 3R available=1; otherwise zero. The independent 2R runway remains a hard gate.'},
        {name:'Zone inside zone',maximum:3,rule:`Same-side overlap across ${profile.confluence.join('/')}: one timeframe=0, two=1, all three=3.`},
      ],
    },
    zoneRules:[
      {name:'Base selection',rule:'Nearest opposite candle before the leg; overlapping opposite bodies form a cluster and the largest represents it.'},
      {name:'Base width',rule:'Reject wider than 25% of its swing leg.',value:{maximumLegFraction:.25}},
      {name:'Continuation location',rule:'Demand midpoint 25%-49% of leg; supply mirrors at 51%-75%.',value:{demand:[.25,.49],supply:[.51,.75]}},
      {name:'Continuation separation',rule:'At least 5% of leg range from the base.',value:{minimumLegFraction:.05}},
      {name:'Continuation width',rule:'Between max(50% ATR14, 2% leg) and 25% leg.',value:{minimumAtrFraction:.5,minimumLegFraction:.02,maximumLegFraction:.25}},
      {name:'Touch ownership',rule:`${profile.zone} owns prior-touch purity; the ${profile.zone} bucket containing the first ${profile.confirmation} trigger is excluded.`},
      {name:'Zone invalidation',rule:'Demand breaks below distal low; supply breaks above distal high; continuation also breaks on return to same-side base.'},
    ],
    confirmationAndExecution:[
      {name:'First touch',rule:`Freeze the first ${profile.confirmation} wick overlap after the ${profile.zone} first-outside candle.`},
      {name:'Demand confirmation',rule:`A later bullish ${profile.confirmation} close must exceed the touched candle high.`},
      {name:'Supply confirmation',rule:`A later bearish ${profile.confirmation} close must fall below the touched candle low.`},
      {name:'Stop',rule:'Selected zone distal boundary.'},
      {name:'Official target',rule:'Exactly 2R from entry.',value:{targetR:2}},
      {name:'Break-even',rule:'Move stop to entry after +1R.',value:{activationR:1}},
      {name:'Intrabar ordering',rule:`Use ${profile.execution} candles after entry; ambiguous stop/favorable thresholds resolve conservatively to the stop.`},
    ],
    researchDiagnostics:[
      {name:'Approach pressure / confirmation bias',scored:false,rule:`Causal completed-${profile.confirmation} diagnostic: liquidity sweeps, recovery, compression into zone, and confirmation strength.`,thresholds:{approachWindowCandles:24,sweepLookbackCandles:6,recoveryDisplacementAtr:1,compressionScore:.6,weakConfirmationBelow:.35}},
      {name:'Zone age',scored:false,rule:'Exact seconds from originating zone candle to entry eligibility.'},
      {name:'Supply-demand corridor',scored:false,rule:'Timeframe-normalized opposing-zone range, entry location, risk, target, and room percentages.'},
      {name:'MFE/MAE path',scored:false,rule:`Policy-independent ${profile.execution} path with first R milestones and ambiguity records.`},
    ],
    riskProfiles:RISK_PROFILES,
    managementPolicies:GOLDILOCKS_MANAGEMENT_POLICIES,
    knownSimulatorOmissions:['Historical bid/ask spread','Slippage','Latency','Partial fills','Daily and triple-rollover financing charges'],
  };
};
