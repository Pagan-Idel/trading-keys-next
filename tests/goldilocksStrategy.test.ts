import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateScoreRisk } from '../utils/dynamicRisk.ts';
import { effectiveOandaLeverage,simulateBacktestPortfolio } from '../utils/backtestPortfolio.ts';
import {
  detectGoldilocksZones,
  detectGoldilocksZoneHistory,
  findFullCandleEngulfing,
  findCloseBeyondTouchedCandle,
  validateTwoToOneRunway,
  validateFinalEntryAfterEngulf,
  annotateTimeframeConfluence,
  countZoneTouchesBefore,
  createHistoricalZoneTouchState,
  observeHistoricalZoneCandle,
  summarizeZoneTimeframeTouches,
  measureGoldilocksIntrabarDepartureSpeed,
  validateGoldilocksDepartureQuality,
  validateGoldilocksEntryProximity,
  validateGoldilocksFinalExecutableEntry,
  validateGoldilocksFirstTouchCandle,
  type StrategyCandle,
} from '../utils/goldilocksStrategy';
import { applySpreadBuffer, calculateExactRiskRewardLevels, evaluateSpread } from '../utils/spreadGuard';
import { findFreshGoldilocksConfirmations, zoneUsableAt } from '../utils/goldilocksScanner';
import { isTradeSessionOpen } from '../utils/sessionUtils';
import { zonedWallClockToEpoch } from '../utils/newsGuard';
import { scoreGoldilocksSetup } from '../utils/goldilocksScoring';
import { classifyTradeOutcome } from '../utils/tradeHistory';
import { buildProtectedOutcomeResolver, resolveProtectedOutcome, validateGoldilocksExecutionCoverageAtEntry } from '../utils/goldilocksBacktest';
import { GOLDILOCKS_DEFAULT_BACKTEST_LABEL, GOLDILOCKS_DEMO_TIMEFRAMES, GOLDILOCKS_SCORE_WEIGHTS, GOLDILOCKS_STRATEGY_VERSION, getGoldilocksMinimumScore, getGoldilocksTimeframeProfile } from '../utils/goldilocksConfig';
import { filterReplayRejectedFirstTouchesAt, formatStrategyReplayNewYork, formatStrategyReplayUtc, formatStrategyZoneLabel, getReplayCandleIndexAtOrBefore, getReplayExitMarkerPrice, getReplayVisibleEnd, getReplayVisibleStart, getStrategyReplayBaseContextStart, getStrategyReplayContextAnchor, getStrategyReplayRequestEnd, getStrategyReplayWindow, sortUniqueReplayCandleItems, STRATEGY_REPLAY_BASE_CONTEXT_SECONDS } from '../utils/strategyReplay';
import { evaluateHistoricalNewsGate } from '../utils/historicalNewsStore';
import { stableBacktestTradeId } from '../utils/backtestStore';
import { getForexHolidayStatusAt, isForexMarketOpenAt, isForexWeekendEntryBlocked, isForexWeekendLiquidationWindow, nextForexWeekendLiquidationTime } from '../utils/forexMarketHours';
import { splitCandleRequestRange } from '../utils/oanda/api/fetchCandles';
import { formatGoldilocksZoneAge, getGoldilocksZoneAgeSeconds } from '../utils/zoneAge';
import { calculateBacktestPerformance } from '../utils/backtestAnalytics';
import { measureGoldilocksApproachPressure } from '../utils/approachPressure';
import { evaluateGoldilocksManagementPolicies, evaluateTradeManagementPolicy, GOLDILOCKS_MANAGEMENT_POLICIES } from '../utils/tradeManagementResearch';
import { measureZoneCorridor } from '../utils/zoneCorridor';
import { mergeCandleCoverageRanges } from '../utils/candleArchive';
import { buildAutoResearchConfigurations } from '../utils/autoResearchRunner';
import { researchConfigHash } from '../utils/autoResearchStore';
import { buildGoldilocksResearchManifest } from '../utils/goldilocksResearchManifest';

test('measures backtest edge from realized R instead of protected-win labels',()=>{
  const metrics=calculateBacktestPerformance([
    {confirmationTime:3,realizedR:-1},
    {confirmationTime:1,realizedR:2},
    {confirmationTime:2,realizedR:0},
    {confirmationTime:4,realizedR:-0.5},
    {confirmationTime:5,realizedR:null},
  ]);
  assert.equal(metrics.sampleTrades,4);
  assert.equal(metrics.omittedTrades,1);
  assert.equal(metrics.profitableTrades,1);
  assert.equal(metrics.breakEvenTrades,1);
  assert.equal(metrics.profitableRate,25);
  assert.equal(metrics.averageWinR,2);
  assert.equal(metrics.averageLossR,0.75);
  assert.equal(metrics.expectancyR,0.125);
  assert.ok(Math.abs((metrics.profitFactor??0)-4/3)<1e-12);
  assert.ok(Math.abs((metrics.payoffRatio??0)-8/3)<1e-12);
  assert.ok(Math.abs((metrics.breakEvenWinRate??0)-27.2727272727)<1e-9);
  assert.equal(metrics.netR,0.5);
  assert.equal(metrics.maxDrawdownR,1.5);
  assert.equal(metrics.longestLosingStreak,2);
});

test('derives the new-run tweak label from the current strategy configuration',()=>{
  assert.match(GOLDILOCKS_DEFAULT_BACKTEST_LABEL,new RegExp(GOLDILOCKS_STRATEGY_VERSION));
  assert.match(GOLDILOCKS_DEFAULT_BACKTEST_LABEL,new RegExp(`ZIZ 3/3=${GOLDILOCKS_SCORE_WEIGHTS.zoneInsideZoneThreeTimeframes}pt`));
  assert.match(GOLDILOCKS_DEFAULT_BACKTEST_LABEL,new RegExp(`H1 range=${GOLDILOCKS_SCORE_WEIGHTS.rangeAlignment}pt`));
  assert.match(GOLDILOCKS_DEFAULT_BACKTEST_LABEL,/age\+approach logged/);
  assert.ok(GOLDILOCKS_DEFAULT_BACKTEST_LABEL.length<=80);
});

test('keeps the live intraday contract locked while exposing a separate higher-timeframe research mirror',()=>{
  const intraday=getGoldilocksTimeframeProfile('intraday');
  const higher=getGoldilocksTimeframeProfile('higherTimeframe');
  assert.deepEqual(
    {trend:intraday.trend,zone:intraday.zone,confirmation:intraday.confirmation,execution:intraday.execution},
    {trend:GOLDILOCKS_DEMO_TIMEFRAMES.trend,zone:GOLDILOCKS_DEMO_TIMEFRAMES.zone,confirmation:GOLDILOCKS_DEMO_TIMEFRAMES.confirmation,execution:GOLDILOCKS_DEMO_TIMEFRAMES.execution},
  );
  assert.deepEqual({trend:higher.trend,zone:higher.zone,confirmation:higher.confirmation,execution:higher.execution},{trend:'D',zone:'H4',confirmation:'H1',execution:'M5'});
  assert.deepEqual(higher.confluence,['H1','H4','D']);
  assert.equal(higher.strategyVersion,'d1-h4-h1-research-v1');
});

test('builds a deterministic overnight matrix without varying account risk',()=>{
  const configurations=buildAutoResearchConfigurations({pairs:['EUR/USD'],continuous:false});
  assert.equal(configurations.length,18);
  assert.deepEqual([...new Set(configurations.map(config=>config.minimumScore))],[10,11,12,13,14,15,16,17,18]);
  assert.deepEqual([...new Set(configurations.map(config=>config.timeframeProfile))],['intraday','higherTimeframe']);
  assert.ok(configurations.every(config=>config.riskProfile==='default'));
  assert.equal(configurations.find(config=>config.timeframeProfile==='higherTimeframe')?.lookbackDays,3650);
  assert.equal(researchConfigHash(configurations[0]),researchConfigHash({...configurations[0]}));
});

test('freezes every gate, score component, diagnostic, risk profile, and manager in a research manifest',()=>{
  const manifest=buildGoldilocksResearchManifest('intraday',14);
  assert.equal(manifest.timeframeContract.trend,'H1');
  assert.equal(manifest.timeframeContract.zone,'M15');
  assert.equal(manifest.timeframeContract.firstTouch,'M5');
  assert.equal(manifest.timeframeContract.executionResolution,'M1');
  assert.equal(manifest.score.maximum,20);
  assert.equal(manifest.score.minimum,14);
  assert.ok(manifest.hardGates.some(gate=>gate.id==='news'));
  assert.ok(manifest.hardGates.some(gate=>gate.id==='weekly_entry'));
  assert.ok(manifest.score.components.some(component=>component.name==='M15 departure quality'));
  assert.ok(manifest.researchDiagnostics.some(item=>item.name==='Approach pressure / confirmation bias'&&!item.scored));
  assert.equal(manifest.managementPolicies.length,22);
  assert.deepEqual(Object.keys(manifest.riskProfiles).sort(),['aggressive','default','easy']);
});

test('labels higher-timeframe execution coverage using its actual resolution',()=>{
  const coverage=validateGoldilocksExecutionCoverageAtEntry([{time:600,open:1,high:1,low:1,close:1}],0,300,300,'M5');
  assert.equal(coverage.allowed,true);
  assert.match(coverage.reason,/M5 execution coverage/);
});

test('measures mirrored approach pressure causally without using candles after confirmation',()=>{
  const supplyCandles:StrategyCandle[]=[
    [100.0,100.5,99.5,100.1],[100.1,100.4,99.7,100.2],[100.2,100.4,99.8,100.1],
    [100.1,100.2,98.5,99.7],[100.0,101.0,99.9,100.8],[101.0,102.0,100.9,101.8],
    [102.0,103.0,101.9,102.8],[103.0,104.0,102.9,103.8],[104.0,105.0,103.9,104.8],
    [105.0,106.0,104.9,105.8],[106.0,107.0,105.9,106.8],[107.0,109.0,106.9,108.5],
    [109.2,110.2,109.0,109.5],[109.03,109.2,108.95,108.99],
  ].map((values,index)=>({time:index+1,open:values[0],high:values[1],low:values[2],close:values[3]}));
  const supplyZone={side:'supply' as const,low:110,high:111,width:1};
  const measured=measureGoldilocksApproachPressure(supplyZone,supplyCandles,12,13);
  assert.deepEqual(measured.adversePressureFlags,[
    'downside_sweep','bullish_recovery','compression_into_supply','weak_confirmation',
  ]);
  assert.equal(measured.adversePressureScore,4);
  assert.equal(measured.latestSweepTime,4);
  assert.equal(measured.approachWindowCandles,12);

  const withFuture=[...supplyCandles,{time:15,open:108,high:150,low:50,close:140}];
  assert.deepEqual(measureGoldilocksApproachPressure(supplyZone,withFuture,12,13),measured);

  const demandCandles=supplyCandles.map(candle=>({
    time:candle.time,
    open:220-candle.open,
    high:220-candle.low,
    low:220-candle.high,
    close:220-candle.close,
  }));
  const mirrored=measureGoldilocksApproachPressure({side:'demand',low:109,high:110,width:1},demandCandles,12,13);
  assert.deepEqual(mirrored.adversePressureFlags,[
    'upside_sweep','bearish_recovery','compression_into_demand','weak_confirmation',
  ]);
  assert.equal(mirrored.adversePressureScore,measured.adversePressureScore);
  assert.ok(Math.abs(mirrored.approachCompressionScore-measured.approachCompressionScore)<1e-12);
  assert.ok(Math.abs(mirrored.confirmationStrengthScore-measured.confirmationStrengthScore)<1e-12);
});

test('creates stable unique searchable IDs for stored backtest trades',()=>{
  const trade={runId:'run-a',pair:'EUR/USD',zoneId:'zone-1',confirmationTime:1784139000};
  const id=stableBacktestTradeId(trade);
  assert.match(id,/^GL-EURUSD-\d{8}-\d{4}-[A-F0-9]{8}$/);
  assert.equal(stableBacktestTradeId(trade),id);
  assert.notEqual(stableBacktestTradeId({...trade,runId:'run-b'}),id);
});

const candles: StrategyCandle[] = [
  [104.8,105.4,103.5,104.0],[104.0,104.3,102.7,103.1],[103.1,103.4,101.6,102.0],
  [102.0,102.5,100.4,100.9],[100.9,101.3,99.2,99.7],[101.0,101.4,97.8,98.8],
  [98.8,101.8,98.5,101.4],[101.4,103.2,101.1,102.9],[102.9,104.4,102.5,104.0],
  [104.0,104.2,102.4,102.8],[102.8,106.1,102.6,105.8],[105.8,108.3,105.4,108.0],
  [108.0,110.2,107.7,109.8],[109.8,112.0,109.2,111.5],
].map((item,index)=>({time:index,open:item[0],high:item[1],low:item[2],close:item[3]}));

test('classifies a break-even stop after reaching 1R as a protected win',()=>{
  assert.equal(classifyTradeOutcome('0.00',true),'WIN');
  assert.equal(classifyTradeOutcome('-0.02',true),'WIN');
  assert.equal(classifyTradeOutcome('0.00',false),'LOSS');
});

test('backtest follows +1R protection through break-even or the final 2R target and treats ambiguous stop candles conservatively',()=>{
  const clean=[{time:1,open:100,high:102.1,low:99.5,close:101.5},{time:2,open:101.5,high:101.7,low:99.9,close:100.2}];
  assert.deepEqual(resolveProtectedOutcome(clean,0,'BUY',98,102),{outcome:'WIN',outcomeTime:2,exitReason:'break_even',realizedR:0});
  const target=[{time:1,open:100,high:102.1,low:99.5,close:101.5},{time:2,open:102,high:104.1,low:101,close:104}];
  assert.deepEqual(resolveProtectedOutcome(target,0,'BUY',98,102),{outcome:'WIN',outcomeTime:2,exitReason:'target',realizedR:2});
  const ambiguous=[{time:2,open:100,high:102.1,low:97.9,close:101}];
  assert.deepEqual(resolveProtectedOutcome(ambiguous,0,'BUY',98,102),{outcome:'LOSS',outcomeTime:2,exitReason:'stop',realizedR:-1});
});

test('forces historical trades out at the Friday cutoff before evaluating that M1 candle',()=>{
  const profitable=[
    {time:1,open:100,high:101,low:99.5,close:100.5},
    {time:2,open:101,high:104.5,low:97.5,close:100},
  ];
  assert.deepEqual(resolveProtectedOutcome(profitable,0,'BUY',98,102,104,15,2),{
    outcome:'WIN',outcomeTime:2,exitReason:'weekend_close',realizedR:0.5,
  });
  const losing=[...profitable.slice(0,1),{time:2,open:99,high:104.5,low:97.5,close:100}];
  assert.deepEqual(resolveProtectedOutcome(losing,0,'BUY',98,102,104,15,2),{
    outcome:'LOSS',outcomeTime:2,exitReason:'weekend_close',realizedR:-0.5,
  });
  const beyondStop=[...profitable.slice(0,1),{time:2,open:75,high:76,low:74,close:75}];
  assert.deepEqual(resolveProtectedOutcome(beyondStop,0,'BUY',98,102,104,15,2),{
    outcome:'LOSS',outcomeTime:2,exitReason:'weekend_close',realizedR:-1,
  });
});

test('fails closed when M1 execution coverage starts after the entry candle',()=>{
  const entryTime=Date.parse('2026-05-19T09:30:00Z')/1000;
  const exact=[{time:entryTime,open:1.16179,high:1.162,low:1.1615,close:1.1618}];
  assert.equal(validateGoldilocksExecutionCoverageAtEntry(exact,0,entryTime).allowed,true);
  const late=[{...exact[0],time:Date.parse('2026-06-09T07:12:00Z')/1000,open:1.15414}];
  const rejected=validateGoldilocksExecutionCoverageAtEntry(late,0,entryTime);
  assert.equal(rejected.allowed,false);
  assert.match(rejected.reason,/missing M1 execution coverage/i);
});

test('splits long replay ranges below the OANDA candle limit',()=>{
  const from='2026-05-12T09:25:00.000Z';
  const to='2026-06-10T07:12:00.000Z';
  const ranges=splitCandleRequestRange(from,to,5*60);
  assert.ok(ranges.length>1);
  for(const range of ranges){
    assert.ok((Date.parse(range.to)-Date.parse(range.from))/(5*60*1000)<=4_000);
  }
  assert.equal(ranges[0].from,from);
  assert.equal(ranges.at(-1)?.to,to);
});

test('indexed backtest outcomes match the candle-by-candle reference resolver',()=>{
  const history=Array.from({length:200},(_,index)=>({
    time:index,open:100,close:100,
    high:100+Math.sin(index/4)*3+index/100,
    low:100+Math.sin(index/4)*3-index/100,
  }));
  const indexed=buildProtectedOutcomeResolver(history);
  for(const direction of ['BUY','SELL'] as const){
    for(const start of [0,17,63,125]){
      for(const [stop,oneR] of [[98,102],[96,104],[99.5,100.5]]){
        const expected=resolveProtectedOutcome(history,start,direction,stop,oneR);
        assert.deepEqual(indexed(start,direction,stop,oneR),expected);
      }
    }
  }
});

test('score-tiered runners blend partial 2R profit with the protected runner result',()=>{
  const runnerStop=[
    {time:1,open:100,high:102.1,low:99.5,close:102},
    {time:2,open:102,high:104.1,low:101.5,close:104},
    {time:3,open:104,high:104.2,low:101.9,close:102},
  ];
  assert.deepEqual(resolveProtectedOutcome(runnerStop,0,'BUY',98,102,104,16),{outcome:'WIN',outcomeTime:3,exitReason:'runner_stop',realizedR:1.75});
  const runnerTarget=[
    {time:1,open:100,high:104.1,low:99.5,close:104},
    {time:2,open:104,high:108.1,low:103,close:108},
  ];
  assert.deepEqual(resolveProtectedOutcome(runnerTarget,0,'BUY',98,102,104,18),{outcome:'WIN',outcomeTime:2,exitReason:'runner_target',realizedR:3});
  assert.deepEqual(resolveProtectedOutcome(runnerTarget,0,'BUY',98,102,104,15),{outcome:'WIN',outcomeTime:1,exitReason:'target',realizedR:2});
});

test('portfolio simulation reserves concurrent margin and rejects trades that do not fit',()=>{
  const trades=[
    {id:'a',pair:'EUR/USD',confirmationTime:1,outcomeTime:10,score:20,entry:100,stopLoss:99,outcome:'WIN' as const,realizedR:2},
    {id:'b',pair:'GBP/USD',confirmationTime:2,outcomeTime:9,score:20,entry:100,stopLoss:99,outcome:'WIN' as const,realizedR:2},
  ];
  const result=simulateBacktestPortfolio(trades,{startingBalance:100,leverage:1,riskProfile:'aggressive',minimumScore:14});
  assert.equal(result.acceptedTrades,1);
  assert.equal(result.marginBlocked,1);
  assert.equal(result.peakMargin,100);
  assert.equal(result.ending,102);
  assert.equal(effectiveOandaLeverage('EUR/USD',50),50);
  assert.equal(effectiveOandaLeverage('GBP/JPY',50),20);
});

test('enforces the shared three-pip spread guard and applies its buffer',()=>{
  const accepted=evaluateSpread('EUR/USD',1.10000,1.10020);
  assert.equal(accepted.allowed,true);
  assert.ok(Math.abs(accepted.spreadPips-2)<1e-9);
  const buffered=applySpreadBuffer('BUY',1.095,1.11,accepted.buffer);
  assert.ok(Math.abs(buffered.stopLoss-1.0948)<1e-9);
  assert.ok(Math.abs(buffered.takeProfit-1.1102)<1e-9);
  const rejected=evaluateSpread('USD/JPY',150,150.04);
  assert.equal(rejected.allowed,false);
  assert.ok(rejected.reason.includes('maximum 3'));
});

test('keeps the Goldilocks stop at the zone edge and recalculates an exact live 2R target',()=>{
  const buy=calculateExactRiskRewardLevels('BUY',1.1012,1.1000,2);
  assert.ok(buy);
  assert.equal(buy.stopLoss,1.1000);
  assert.equal(Number(buy.takeProfit.toFixed(4)),1.1036);
  assert.equal(buy.ratio,2);
  assert.equal(calculateExactRiskRewardLevels('BUY',1.0999,1.1000,2),null);
});

test('accepts only the latest completed confirmation candle after a zone departure and touch',()=>{
  const zone={
    id:'base-demand-live',kind:'base' as const,side:'demand' as const,candleIndex:0,candleTime:0,
    availableAt:1,low:99,high:100,width:1,legMidpoint:105,legRange:12,departureMultiple:3,
    strength2x:true,touches:1,maxPenetration:0.2,state:'touched' as const,reasons:[],
  };
  const history={zones:[zone],activeZones:[zone],activeDemand:zone};
  const confirmationCandles:StrategyCandle[]=[
    {time:100,open:102,high:103,low:101,close:102.5},
    {time:200,open:101,high:101.5,low:99.8,close:100.5},
    {time:300,open:100.8,high:103.2,low:100.4,close:102.2},
  ];
  const fresh=findFreshGoldilocksConfirmations(history,confirmationCandles,300,600_000,confirmationCandles,100);
  assert.equal(fresh.length,1);
  assert.equal(fresh[0].touchCandle.time,200);
  assert.equal(findFreshGoldilocksConfirmations(history,confirmationCandles,300,900_000,confirmationCandles,100).length,0);
});

test('does not let one M5 candle act as both the zone touch and its later confirmation',()=>{
  const zone={
    id:'base-supply-m5',kind:'base' as const,side:'supply' as const,candleIndex:0,candleTime:0,
    availableAt:1,low:1.34485,high:1.34519,width:0.00034,legMidpoint:1.34,legRange:0.01,departureMultiple:3,
    strength2x:true,touches:0,maxPenetration:0,state:'fresh' as const,reasons:[],
  };
  const history={zones:[zone],activeZones:[zone],activeSupply:zone};
  const touchOnly:StrategyCandle[]=[
    {time:300,open:1.3440,high:1.3444,low:1.3438,close:1.3441},
    {time:600,open:1.3442,high:1.34498,low:1.34412,close:1.34412},
  ];
  assert.equal(findFreshGoldilocksConfirmations(history,touchOnly,300,1_200_000,touchOnly,300).length,0);
  const laterConfirmation=[...touchOnly,{time:900,open:1.3442,high:1.3443,low:1.3438,close:1.3439}];
  const result=findFreshGoldilocksConfirmations(history,laterConfirmation,300,1_499_999,laterConfirmation,300);
  assert.equal(result.length,1);
  assert.equal(result[0].touchCandle.time,600);
  assert.equal(result[0].confirmationCandle.time,900);
  assert.equal(result[0].priorTouches,0);
});

test('keeps the first M5 zone overlap as the trigger while later touching candles wait for its close-through',()=>{
  const zone={
    id:'first-m5-supply-touch',kind:'base' as const,side:'supply' as const,candleIndex:0,candleTime:0,
    availableAt:1,low:100,high:101,width:1,legMidpoint:95,legRange:10,departureMultiple:3,
    strength2x:true,touches:0,maxPenetration:0,state:'fresh' as const,reasons:[],
  };
  const history={zones:[zone],activeZones:[zone],activeSupply:zone};
  const m5:StrategyCandle[]=[
    {time:300,open:98.5,high:99,low:98.2,close:98.8},
    {time:600,open:99.8,high:100.1,low:99.8,close:100},
    {time:900,open:100,high:100.4,low:99.95,close:100.2},
    {time:1200,open:100,high:100.1,low:99.6,close:99.7},
  ];
  const result=findFreshGoldilocksConfirmations(history,m5,300,1_700_000,m5,300);
  assert.equal(result.length,1);
  assert.equal(result[0].touchCandle.time,600);
  assert.equal(result[0].confirmationCandle.time,1200);
  assert.equal(result[0].priorTouches,0);
  assert.equal(result[0].proximity.allowed,true);
});

test('excludes the trigger M15 bucket and later M15 candles while an M5 close-through is pending',()=>{
  const zone={
    id:'pending-m5-supply-touch',kind:'base' as const,side:'supply' as const,candleIndex:0,candleTime:0,
    availableAt:1,low:100,high:101,width:1,legMidpoint:95,legRange:10,departureMultiple:3,
    strength2x:true,touches:0,maxPenetration:0,state:'fresh' as const,reasons:[],
  };
  const history={zones:[zone],activeZones:[zone],activeSupply:zone};
  const m15:StrategyCandle[]=[
    {time:900,open:98.5,high:99,low:98.2,close:98.8},
    {time:1800,open:99.8,high:100.2,low:99.7,close:99.9},
    {time:2700,open:98.8,high:99,low:98.6,close:98.9},
    {time:3600,open:99.8,high:100.3,low:99.7,close:100.1},
    {time:4500,open:99.9,high:100.2,low:99.7,close:100},
    {time:5400,open:99.8,high:100.4,low:99.7,close:100.2},
  ];
  const m5:StrategyCandle[]=[
    {time:3300,open:98.8,high:99,low:98.6,close:98.9},
    {time:3600,open:99.8,high:100.1,low:99.8,close:100},
    {time:4500,open:99.9,high:100.2,low:99.9,close:100.1},
    {time:5400,open:99.9,high:100.3,low:99.9,close:100.2},
    {time:6600,open:100,high:100.1,low:99.6,close:99.7},
  ];
  const result=findFreshGoldilocksConfirmations(history,m5,300,7_000_000,m15,900);
  assert.equal(result.length,1);
  assert.equal(result[0].touchCandle.time,3600);
  assert.equal(result[0].priorTouches,1);
  assert.ok(Math.abs(result[0].priorMaxPenetration-0.2)<1e-9);
});

test('starts the M15 touch ledger at the originating departure before actionability and excludes the M5 trade touch',()=>{
  const zone={
    id:'m15-supply-purity',kind:'base' as const,side:'supply' as const,candleIndex:0,candleTime:0,
    availableAt:3000,low:100,high:101,width:1,legMidpoint:95,legRange:10,departureMultiple:3,
    strength2x:true,touches:0,maxPenetration:0,state:'fresh' as const,reasons:[],
  };
  const history={zones:[zone],activeZones:[zone],activeSupply:zone};
  const m15:StrategyCandle[]=[
    {time:900,open:98.5,high:99,low:98,close:98.8},
    {time:1800,open:99.5,high:100.2,low:99.2,close:99.8},
    {time:2700,open:98.7,high:99,low:98.4,close:98.6},
    {time:3600,open:99.8,high:100.3,low:99.7,close:100.1},
  ];
  const m5:StrategyCandle[]=[
    {time:3300,open:98.8,high:99,low:98.6,close:98.9},
    {time:3600,open:99.8,high:100.1,low:99.7,close:99.9},
    {time:3900,open:99.9,high:100,low:99.4,close:99.5},
  ];
  const result=findFreshGoldilocksConfirmations(history,m5,300,4_499_000,m15,900);
  assert.equal(result.length,1);
  assert.equal(result[0].firstOutsideTime,900);
  assert.equal(result[0].priorTouches,1);
  assert.ok(Math.abs(result[0].priorMaxPenetration-0.2)<1e-9);
  assert.equal(result[0].touchCandle.time,3600);
  const purity=summarizeZoneTimeframeTouches(zone,m15,900,3600);
  assert.equal(purity.departureInsideCandleCount,0);
  assert.equal(purity.touches,1);
  assert.equal(purity.touchDetails.length,1);
  assert.equal(purity.touchDetails[0].time,1800);
  assert.equal(purity.touchDetails[0].price,100.2);
  assert.ok(Math.abs(purity.touchDetails[0].penetration-0.2)<1e-9);
});

test('counts completed M15 candles that linger in the zone before the first fully outside candle',()=>{
  const zone={
    id:'lingering-departure',kind:'base' as const,side:'supply' as const,candleIndex:0,candleTime:0,
    low:100,high:101,width:1,legMidpoint:95,legRange:10,departureMultiple:1,
    strength2x:false,touches:0,maxPenetration:0,state:'fresh' as const,reasons:[],
  };
  const m15:StrategyCandle[]=[
    {time:900,open:100.4,high:100.8,low:99.8,close:100.1},
    {time:1800,open:99.8,high:99.9,low:99.2,close:99.4},
    {time:2700,open:99.5,high:100.2,low:99.4,close:100},
  ];
  const summary=summarizeZoneTimeframeTouches(zone,m15,900,2700);
  assert.equal(summary.departureInsideCandleCount,1);
  assert.equal(summary.firstOutsideTime,1800);
  assert.equal(summary.touches,0);
});

test('rejects oversized first-touch candles and close-through entries over half a zone width away',()=>{
  const zone={
    id:'proximity-supply',kind:'base' as const,side:'supply' as const,candleIndex:0,candleTime:0,
    availableAt:1,low:100,high:101,width:1,legMidpoint:95,legRange:10,departureMultiple:3,
    strength2x:true,touches:0,maxPenetration:0,state:'fresh' as const,reasons:[],
  };
  const atLimit=validateGoldilocksEntryProximity(zone,{time:1,open:99.8,high:100.1,low:99.6,close:100},99.5);
  assert.equal(atLimit.allowed,true);
  const oversizedTouch={time:1,open:99.8,high:100.1,low:99.5,close:100};
  const firstTouch=validateGoldilocksFirstTouchCandle(zone,oversizedTouch);
  assert.equal(firstTouch.allowed,false);
  assert.ok(firstTouch.touchRangeZoneFraction>firstTouch.maxTouchRangeZoneFraction);
  const oversized=validateGoldilocksEntryProximity(zone,oversizedTouch,99.5);
  assert.equal(oversized.allowed,false);
  assert.match(oversized.reason,/first M5 touch candle/i);
  const farClose=validateGoldilocksEntryProximity(zone,{time:1,open:99.8,high:100.1,low:99.8,close:100},99.4);
  assert.equal(farClose.allowed,false);
  assert.match(farClose.reason,/close-through/i);
  const movedEntry=validateGoldilocksEntryProximity(zone,{time:1,open:99.8,high:100.1,low:99.8,close:100},99.5,99.4);
  assert.equal(movedEntry.allowed,false);
  assert.match(movedEntry.reason,/executable entry/i);
  const finalAtLimit=validateGoldilocksFinalExecutableEntry(
    zone,[zone],{time:1,open:99.8,high:100.1,low:99.8,close:100},99.5,99.5,
  );
  assert.equal(finalAtLimit.allowed,true);
  const finalMoved=validateGoldilocksFinalExecutableEntry(
    zone,[zone],{time:1,open:99.8,high:100.1,low:99.8,close:100},99.5,99.4,
  );
  assert.equal(finalMoved.allowed,false);
  assert.match(finalMoved.reason,/executable entry/i);
});

test('uses explicit market timezones for daylight-saving sessions and news timestamps',()=>{
  assert.equal(isTradeSessionOpen('USD/CAD',new Date('2026-07-16T12:30:00Z')),true);
  assert.equal(isTradeSessionOpen('USD/CAD',new Date('2026-01-16T13:30:00Z')),true);
  assert.equal(isTradeSessionOpen('USD/CAD',new Date('2026-07-16T11:30:00Z')),false);
  assert.equal(new Date(zonedWallClockToEpoch('2026-07-16','08:30:00')).toISOString(),'2026-07-16T13:30:00.000Z');
});

test('uses DST-safe New York weekly close, liquidation, and reopen buffers',()=>{
  assert.equal(isForexMarketOpenAt(new Date('2026-07-17T20:00:00Z')),true);
  assert.equal(isForexWeekendEntryBlocked(new Date('2026-07-17T19:59:59Z')),false);
  assert.equal(isForexWeekendEntryBlocked(new Date('2026-07-17T20:00:00Z')),true);
  assert.equal(isForexWeekendLiquidationWindow(new Date('2026-07-17T20:00:00Z')),true);
  assert.equal(isForexMarketOpenAt(new Date('2026-07-17T21:00:00Z')),false);
  assert.equal(isForexMarketOpenAt(new Date('2026-07-19T21:30:00Z')),true);
  assert.equal(isForexWeekendEntryBlocked(new Date('2026-07-19T21:30:00Z')),true);
  assert.equal(isForexWeekendEntryBlocked(new Date('2026-07-19T22:00:00Z')),false);
  assert.equal(isForexWeekendEntryBlocked(new Date('2026-01-16T20:59:59Z')),false);
  assert.equal(isForexWeekendEntryBlocked(new Date('2026-01-16T21:00:00Z')),true);
  assert.equal(isForexMarketOpenAt(new Date('2026-01-16T22:00:00Z')),false);
  assert.equal(nextForexWeekendLiquidationTime(Date.parse('2026-07-16T12:00:00Z')/1000),Date.parse('2026-07-17T20:00:00Z')/1000);
  assert.equal(nextForexWeekendLiquidationTime(Date.parse('2026-01-15T12:00:00Z')/1000),Date.parse('2026-01-16T21:00:00Z')/1000);
});

test('evaluates historical holidays by the DST-aware New York market date',()=>{
  assert.equal(getForexHolidayStatusAt(new Date('2026-06-19T03:59:59Z')).blocked,false);
  const juneteenth=getForexHolidayStatusAt(new Date('2026-06-19T04:00:00Z'));
  assert.equal(juneteenth.blocked,true);
  assert.equal(juneteenth.marketDate,'2026-06-19');
  assert.equal(juneteenth.kind,'full');
  assert.equal(getForexHolidayStatusAt(new Date('2026-01-01T04:59:59Z')).blocked,false);
  assert.equal(getForexHolidayStatusAt(new Date('2026-01-01T05:00:00Z')).blocked,true);
});

test('renders replay audit timestamps explicitly in UTC and New York market time',()=>{
  const time=Date.parse('2026-06-19T13:30:00Z')/1000;
  assert.equal(formatStrategyReplayUtc(time),'2026-06-19 13:30:00 UTC');
  assert.equal(formatStrategyReplayNewYork(time),'2026-06-19 09:30:00 EDT');
});

test('rejects a wick-only shock departure and measures strength from sustained M15 closes',()=>{
  const calm=Array.from({length:14},(_,index)=>({
    time:index*900,open:99.98,high:100.05,low:99.95,close:100.01,
  }));
  const history:StrategyCandle[]=[
    ...calm,
    {time:14*900,open:100,high:100.2,low:99.9,close:100.1},
    {time:15*900,open:100.1,high:100.4,low:97,close:99.8},
    {time:16*900,open:99.8,high:99.9,low:99.6,close:99.7},
  ];
  const zone=detectGoldilocksZones(history,{direction:'bearish',startIndex:15,endIndex:16}).zones.find(item=>item.kind==='base');
  assert.ok(zone);
  assert.equal(zone.departureQuality?.shockRejected,true);
  assert.ok((zone.departureQuality?.rangeAtrMultiple??0)>=3);
  assert.ok((zone.departureQuality?.rejectionWickFraction??0)>=0.5);
  assert.ok((zone.departureQuality?.closeDepartureZoneMultiple??Infinity)<1);
  assert.ok((zone.departureMultiple??Infinity)<1);
  assert.ok((zone.wickDepartureMultiple??0)>7);
  assert.equal(validateGoldilocksDepartureQuality(zone).allowed,false);

  const departureTime=zone.departureQuality!.departureCandleTime;
  const m1:StrategyCandle[]=[
    ...Array.from({length:14},(_,index)=>({time:departureTime-(14-index)*60,open:100,high:100.01,low:99.99,close:100})),
    {time:departureTime,open:100.1,high:100.4,low:97,close:99.8},
  ];
  const speed=measureGoldilocksIntrabarDepartureSpeed(zone,m1);
  assert.ok(speed);
  assert.ok((speed.rangeAtrMultiple??0)>100);
  assert.equal(speed.departureRangeFraction,1);
});

test('does not assign points until every hard gate passes',()=>{
  const zone={
    id:'score-zone',kind:'base' as const,side:'demand' as const,candleIndex:0,candleTime:1,
    low:99,high:100,width:1,legMidpoint:105,legRange:12,departureMultiple:3,strength2x:true,
    touches:0,maxPenetration:0,state:'fresh' as const,reasons:[],
  };
  const rejected=scoreGoldilocksSetup({zone,tradeDirection:'BUY',trend:'bullish',minimumScore:0,gates:[{name:'2:1 runway',passed:false,reason:'blocked'}]});
  assert.equal(rejected.scored,false);
  assert.equal(rejected.eligible,false);
  assert.equal(rejected.components.length,0);
  const passed=scoreGoldilocksSetup({zone,tradeDirection:'BUY',trend:'bullish',minimumScore:0,gates:[{name:'2:1 runway',passed:true,reason:'clear'}]});
  assert.equal(passed.scored,true);
  assert.equal(passed.eligible,true);
  assert.equal(passed.total,14);
});

test('weights departure quality at eight, H1 trend at four, available RRR at one, and caps the complete score at twenty',()=>{
  const zone={
    id:'max-score-zone',kind:'base' as const,side:'demand' as const,candleIndex:0,candleTime:1,
    low:99,high:100,width:1,legMidpoint:105,legRange:12,departureMultiple:3,strength2x:true,
    baseCandleCount:1,departureInsideCandleCount:0,brokeOppositeLegIn:true,touches:1,maxPenetration:0.1,state:'touched' as const,reasons:[],
    timeframeConfluence:{timeframes:['M1','M5','M15'],timeframeCount:3,overlaps:[]},
  };
  const score=scoreGoldilocksSetup({
    zone,tradeDirection:'BUY',trend:'bullish',minimumScore:0,purityTouches:0,purityMaxPenetration:0,
    availableRewardRisk:6,rangeAssessment:{aligned:true,detail:'correct M15 half'},
    gates:[{name:'all',passed:true,reason:'passed'}],
  });
  assert.equal(score.components.find(component=>component.name==='H1 trend')?.points,4);
  assert.equal(score.components.find(component=>component.name==='M15 departure quality')?.points,8);
  assert.equal(score.components.find(component=>component.name==='Available RRR')?.points,1);
  assert.equal(score.components.find(component=>component.name==='H1 range')?.points,0);
  assert.equal(score.components.find(component=>component.name==='Zone inside zone')?.points,3);
  assert.equal(score.total,20);
});

test('awards one ZIZ point for 2/3 and three points only for full 3/3 overlap',()=>{
  const zone={
    id:'ziz-score-zone',kind:'base' as const,side:'demand' as const,candleIndex:0,candleTime:1,
    low:99,high:100,width:1,legMidpoint:105,legRange:12,departureMultiple:1,strength2x:false,
    touches:2,maxPenetration:0.6,state:'touched' as const,reasons:[],
    timeframeConfluence:{timeframes:['M5','M15'],timeframeCount:2,overlaps:[]},
  };
  const two=scoreGoldilocksSetup({zone,tradeDirection:'BUY',trend:'unknown',minimumScore:0,gates:[{name:'all',passed:true,reason:'passed'}]});
  assert.equal(two.components.find(component=>component.name==='Zone inside zone')?.points,1);
  const three=scoreGoldilocksSetup({
    zone:{...zone,timeframeConfluence:{timeframes:['M5','M15','H1'],timeframeCount:3,overlaps:[]}},
    tradeDirection:'BUY',trend:'unknown',minimumScore:0,gates:[{name:'all',passed:true,reason:'passed'}],
  });
  assert.equal(three.components.find(component=>component.name==='Zone inside zone')?.points,3);
});

test('heavily penalizes multi-candle bases and lingering M15 candles in departure quality',()=>{
  const zone={
    id:'slow-departure-zone',kind:'base' as const,side:'demand' as const,candleIndex:0,candleTime:1,
    low:99,high:100,width:1,legMidpoint:105,legRange:12,departureMultiple:1,strength2x:false,
    baseCandleCount:4,departureInsideCandleCount:2,brokeOppositeLegIn:false,
    touches:0,maxPenetration:0,state:'fresh' as const,reasons:[],
  };
  const score=scoreGoldilocksSetup({
    zone,tradeDirection:'BUY',trend:'unknown',minimumScore:0,
    gates:[{name:'all',passed:true,reason:'passed'}],
  });
  const departure=score.components.find(component=>component.name==='M15 departure quality');
  assert.equal(departure?.points,0);
  assert.match(departure?.detail??'',/4-candle base/);
  assert.match(departure?.detail??'',/2 lingering/);
});

test('awards one available-RRR point from 3R through 5R',()=>{
  const zone={
    id:'rrr-score-zone',kind:'base' as const,side:'demand' as const,candleIndex:0,candleTime:1,
    low:99,high:100,width:1,legMidpoint:105,legRange:12,departureMultiple:1,strength2x:false,
    touches:2,maxPenetration:0.8,state:'touched' as const,reasons:[],
  };
  const score=scoreGoldilocksSetup({
    zone,tradeDirection:'BUY',trend:'unknown',minimumScore:0,availableRewardRisk:3,
    gates:[{name:'all',passed:true,reason:'passed'}],
  });
  assert.equal(score.components.find(component=>component.name==='Available RRR')?.points,1);
});

test('uses a 14 point live threshold by default and clamps configured thresholds to the 20 point scale',()=>{
  const original=process.env.GOLDILOCKS_MIN_SCORE;
  delete process.env.GOLDILOCKS_MIN_SCORE;
  assert.equal(getGoldilocksMinimumScore(),14);
  process.env.GOLDILOCKS_MIN_SCORE='17.9';
  assert.equal(getGoldilocksMinimumScore(),17);
  process.env.GOLDILOCKS_MIN_SCORE='99';
  assert.equal(getGoldilocksMinimumScore(),20);
  if(original===undefined) delete process.env.GOLDILOCKS_MIN_SCORE;
  else process.env.GOLDILOCKS_MIN_SCORE=original;
});

test('detects the largest opposite base and most discounted continuation demand',()=>{
  const result=detectGoldilocksZones(candles,{direction:'bullish',startIndex:5,endIndex:13});
  assert.equal(result.zones.length,2);
  assert.equal(result.zones[0].kind,'base');
  assert.equal(result.zones[0].candleIndex,5);
  assert.equal(result.zones[0].low,97.8);
  assert.equal(result.zones[0].high,101.0);
  assert.equal(result.zones[1].kind,'continuation');
  assert.equal(result.zones[1].candleIndex,9);
  assert.ok(result.zones[1].high<=result.midpoint);
});

test('expires zones older than two calendar years while preserving them in history',()=>{
  const sample:StrategyCandle[]=[
    {time:Date.parse('2023-01-01T00:00:00Z')/1000,open:100,high:100.5,low:99,close:99.5},
    {time:Date.parse('2023-01-02T00:00:00Z')/1000,open:99.5,high:110,low:99.4,close:109},
    {time:Date.parse('2025-08-01T00:00:00Z')/1000,open:105,high:106,low:104,close:105.5},
  ];
  const history=detectGoldilocksZoneHistory(sample,[{direction:'bullish',startIndex:0,endIndex:1}]);
  const base=history.zones.find(zone=>zone.kind==='base');
  assert.equal(base?.state,'expired');
  assert.ok(base?.reasons.some(reason=>reason.includes('two calendar years')));
  assert.equal(history.activeZones.length,0);
});

test('rejects a continuation thinner than the ATR-adjusted minimum',()=>{
  const history:StrategyCandle[]=Array.from({length:13},(_,index)=>({
    time:index,
    open:100+(index%2)*0.2,
    high:101,
    low:99,
    close:100.2-(index%2)*0.2,
  }));
  const sample:StrategyCandle[]=[
    ...history,
    {time:13,open:100,high:100.2,low:99,close:99.5},
    {time:14,open:106,high:106.1,low:105.8,close:105.9},
    {time:15,open:105.9,high:120,low:105.8,close:119.5},
  ];
  const result=detectGoldilocksZones(sample,{direction:'bullish',startIndex:13,endIndex:15});
  assert.equal(result.zones.some(zone=>zone.kind==='continuation'),false);
  assert.ok(result.rejected.some(item=>item.reason.includes('too thin')&&item.reason.includes('ATR(14)')));
});

test('requires a complete candle engulfing on the confirmation timeframe',()=>{
  const lower:StrategyCandle[]=[
    {time:1,open:100,high:101,low:98,close:99},
    {time:2,open:98.8,high:101.4,low:97.7,close:101.2},
  ];
  const confirmation=findFullCandleEngulfing(lower,'bullish');
  assert.equal(confirmation.confirmed,true);
  assert.equal(confirmation.candleIndex,1);
});

test('confirms a sell when a later bearish candle closes below the touched candle wick low',()=>{
  const sample:StrategyCandle[]=[
    {time:1,open:1.42091,high:1.42173,low:1.42058,close:1.42096},
    {time:2,open:1.42342,high:1.42486,low:1.42085,close:1.42146},
    {time:3,open:1.42146,high:1.42150,low:1.41776,close:1.41956},
  ];
  const confirmation=findCloseBeyondTouchedCandle(sample,'bearish',0);
  assert.equal(confirmation.confirmed,true);
  assert.equal(confirmation.candleIndex,2);
});

test('selects the largest opposite candle from an overlapping sideways base',()=>{
  const sample:StrategyCandle[]=[
    {time:0,open:105,high:105.5,low:103.8,close:104.2},
    {time:1,open:104.4,high:104.8,low:101.0,close:101.5},
    {time:2,open:101.5,high:106,low:101.3,close:105.8},
    {time:3,open:105.8,high:120,low:105.5,close:119.7},
  ];
  const result=detectGoldilocksZones(sample,{direction:'bullish',startIndex:0,endIndex:3});
  assert.equal(result.zones[0].candleIndex,1);
});

test('extends the bullish base distal edge to the true leg low from another candle',()=>{
  const sample:StrategyCandle[]=[
    {time:0,open:102,high:102.5,low:100,close:100.9},
    {time:1,open:101,high:101.4,low:98.5,close:100.5},
    {time:2,open:100.5,high:108,low:100.2,close:107.5},
    {time:3,open:107.5,high:115,low:107,close:114.5},
  ];
  const result=detectGoldilocksZones(sample,{direction:'bullish',startIndex:0,endIndex:3});
  const base=result.zones.find(zone=>zone.kind==='base');
  assert.equal(base?.candleIndex,1);
  assert.equal(base?.high,101);
  assert.equal(base?.low,98.5);
});

test('counts an exact proximal-boundary equality as a touch after 2x departure',()=>{
  const sample:StrategyCandle[]=[
    {time:0,open:100,high:100.4,low:99,close:99.5},
    {time:1,open:99.5,high:103,low:99.4,close:102.8},
    {time:2,open:102.8,high:104,low:102.5,close:103.7},
    {time:3,open:103.7,high:104,low:100,close:101},
  ];
  const result=detectGoldilocksZones(sample,{direction:'bullish',startIndex:0,endIndex:3});
  assert.equal(result.zones[0].state,'touched');
  assert.equal(result.zones[0].touches,1);
});

test('treats exact equality at the leg-extreme distal boundary as a touch, not a break',()=>{
  const wickOnly:StrategyCandle[]=[
    {time:0,open:100,high:100.4,low:99,close:99.5},
    {time:1,open:99.5,high:103,low:99.4,close:102.8},
    {time:2,open:102.8,high:104,low:102.5,close:103.7},
    {time:3,open:103.7,high:104,low:98.8,close:99.4},
  ];
  const wickResult=detectGoldilocksZones(wickOnly,{direction:'bullish',startIndex:0,endIndex:3});
  assert.equal(wickResult.zones[0].state,'touched');
  const closedThrough=wickOnly.map(candle=>({...candle}));
  closedThrough[3].close=98.9;
  const closeResult=detectGoldilocksZones(closedThrough,{direction:'bullish',startIndex:0,endIndex:3});
  assert.equal(closeResult.zones[0].low,98.8);
  assert.equal(closeResult.zones[0].state,'touched');
});

test('breaks an established supply zone as soon as a later wick passes its high',()=>{
  const sample:StrategyCandle[]=[
    {time:0,open:109.8,high:112,low:109.2,close:111.5},
    {time:1,open:111.5,high:111.7,low:107,close:107.5},
    {time:2,open:107.5,high:108,low:103,close:103.5},
    {time:3,open:103.5,high:112.01,low:103.2,close:111},
  ];
  const history=detectGoldilocksZoneHistory(sample,[{direction:'bearish',startIndex:0,endIndex:2}]);
  assert.equal(history.zones.find(zone=>zone.kind==='base')?.state,'invalidated');
  assert.equal(history.activeZones.filter(zone=>zone.side==='supply').length,0);
});

test('rejects continuation demand that overlaps or sits too close to the base zone',()=>{
  const sample:StrategyCandle[]=[
    {time:0,open:101,high:101.5,low:99,close:99.5},
    {time:1,open:99.5,high:103,low:99.4,close:102.8},
    {time:2,open:102.8,high:104,low:102.4,close:103.8},
    {time:3,open:103.8,high:104,low:101.3,close:102},
    {time:4,open:102,high:110,low:101.9,close:109.5},
  ];
  const result=detectGoldilocksZones(sample,{direction:'bullish',startIndex:0,endIndex:4});
  assert.equal(result.zones.filter(zone=>zone.kind==='continuation').length,0);
  assert.ok(result.rejected.some(rejection=>rejection.reason.includes('overlaps the base or is within 5%')));
});

test('rejects continuation demand outside the 25%-49% leg band',()=>{
  const sample:StrategyCandle[]=[
    {time:0,open:101,high:101.5,low:99,close:99.5},
    {time:1,open:99.5,high:113,low:99.4,close:112.5},
    {time:2,open:112.5,high:113,low:111,close:111.5},
    {time:3,open:111.5,high:120,low:111.4,close:119.5},
  ];
  const result=detectGoldilocksZones(sample,{direction:'bullish',startIndex:0,endIndex:3});
  assert.equal(result.zones.filter(zone=>zone.kind==='continuation').length,0);
  assert.ok(result.rejected.length>0);
});

test('blocks a 2:1 entry when another Goldilocks zone intersects the target path',()=>{
  const result=detectGoldilocksZones(candles,{direction:'bullish',startIndex:5,endIndex:13});
  const base=result.zones.find(zone=>zone.kind==='base');
  assert.ok(base);
  const opposing={...base,id:'opposing-supply',side:'supply' as const,low:base.high+base.width,high:base.high+base.width*1.5};
  const check=validateTwoToOneRunway(base,[...result.zones,opposing]);
  assert.equal(check.allowed,false);
  assert.ok(check.blockingZoneId);
});

test('does not treat an earlier same-side continuation as a runway blocker',()=>{
  const result=detectGoldilocksZones(candles,{direction:'bullish',startIndex:5,endIndex:13});
  const base=result.zones.find(zone=>zone.kind==='base');
  assert.ok(base);
  const check=validateTwoToOneRunway(base,result.zones);
  assert.equal(check.allowed,true);
});

test('uses only the most recent active opposing base or continuation prices',()=>{
  const result=detectGoldilocksZones(candles,{direction:'bullish',startIndex:5,endIndex:13});
  const base=result.zones.find(zone=>zone.kind==='base');
  assert.ok(base);
  const olderBlocking={...base,id:'old-supply',side:'supply' as const,candleTime:10,low:base.high+base.width,high:base.high+base.width*1.5};
  const recentClear={...base,id:'recent-supply',kind:'continuation' as const,side:'supply' as const,candleTime:20,low:base.high+base.width*3,high:base.high+base.width*3.5};
  const check=validateTwoToOneRunway(base,[base,olderBlocking,recentClear]);
  assert.equal(check.allowed,true);
  assert.ok(Math.abs(check.availableRatio-3)<1e-9);
  assert.ok(check.reason.includes('most recent active continuation supply'));
});

test('historical runway keeps an opposing zone that was usable at entry but invalidated later',()=>{
  const supply={
    id:'entry-supply',kind:'base' as const,side:'supply' as const,candleIndex:0,candleTime:100,
    low:1.1700,high:1.1720,width:0.002,legMidpoint:1.17,legRange:0.01,departureMultiple:3,
    strength2x:true,touches:0,maxPenetration:0,state:'fresh' as const,reasons:[],
  };
  const laterInvalidatedDemand={
    ...supply,id:'opposing-demand',side:'demand' as const,candleTime:200,availableAt:300,
    low:1.1655,high:1.1659,state:'invalidated' as const,invalidatedAt:900,
  };
  const check=validateTwoToOneRunway(supply,[supply,laterInvalidatedDemand],1.17064,{knownZonesUsableAtEntry:true});
  assert.equal(check.allowed,true);
  assert.ok(Number.isFinite(check.availableRatio));
  assert.ok(Math.abs(check.availableRatio-((1.17064-1.1659)/(1.1720-1.17064)))<1e-9);
});

test('rejects continuation when price later reaches through it toward its same-side base',()=>{
  const sample=[...candles,{time:14,open:111.5,high:112,low:100.5,close:101.2}];
  const result=detectGoldilocksZones(sample,{direction:'bullish',startIndex:5,endIndex:14});
  assert.equal(result.zones.some(zone=>zone.kind==='continuation'),false);
  assert.ok(result.rejected.some(item=>item.reason.includes('distal boundary')));
});

test('allows a 2:1 entry when the target path contains no other active zone',()=>{
  const result=detectGoldilocksZones(candles,{direction:'bullish',startIndex:5,endIndex:13});
  const continuation=result.zones.find(zone=>zone.kind==='continuation');
  assert.ok(continuation);
  const check=validateTwoToOneRunway(continuation,[continuation]);
  assert.equal(check.allowed,true);
  assert.equal(check.takeProfit,check.entry+check.risk*2);
});

test('uses the engulfing body close for entry and the continuation distal edge for the stop',()=>{
  const result=detectGoldilocksZones(candles,{direction:'bullish',startIndex:5,endIndex:13});
  const continuation=result.zones.find(zone=>zone.kind==='continuation');
  assert.ok(continuation);
  const engulfClose=continuation.high+0.4;
  const check=validateTwoToOneRunway(continuation,[continuation],engulfClose);
  assert.equal(check.entry,engulfClose);
  assert.equal(check.stopLoss,continuation.low);
  assert.equal(check.risk,engulfClose-continuation.low);
  assert.equal(check.takeProfit,engulfClose+(engulfClose-continuation.low)*2);
});

test('does not apply a subjective choppiness rejection to continuation candidates',()=>{
  const result=detectGoldilocksZones(candles,{direction:'bullish',startIndex:5,endIndex:13});
  assert.ok(result.zones.some(zone=>zone.kind==='continuation'));
  assert.equal(result.rejected.some(item=>item.reason.toLowerCase().includes('choppy')),false);
});

test('does not backtrack from a swing high through the preceding rally when selecting supply base',()=>{
  const sample=[...candles,
    {time:14,open:111.5,high:111.7,low:109.8,close:110.2},
    {time:15,open:110.2,high:110.5,low:107.2,close:107.8},
    {time:16,open:107.8,high:108.1,low:104.1,close:104.6},
    {time:17,open:104.6,high:105,low:102.8,close:103.5},
  ];
  const result=detectGoldilocksZones(sample,{direction:'bearish',startIndex:13,endIndex:17});
  const supply=result.zones.find(zone=>zone.kind==='base');
  assert.ok(supply);
  assert.equal(supply.candleIndex,13);
  assert.equal(supply.low,109.8);
  assert.equal(supply.high,112);
  const demand=detectGoldilocksZones(sample,{direction:'bullish',startIndex:5,endIndex:13}).zones.find(zone=>zone.kind==='continuation');
  assert.ok(demand);
  assert.equal(validateTwoToOneRunway(demand,[demand,supply],104.6).allowed,true);
  assert.equal(validateTwoToOneRunway(demand,[demand,supply],107.1).allowed,false);
});

test('uses the nearest bullish candle before a bearish swing high as its supply base',()=>{
  const sample:StrategyCandle[]=[
    {time:0,open:1.15106,high:1.15235,low:1.15104,close:1.15228},
    {time:1,open:1.15227,high:1.15272,low:1.15196,close:1.15271},
    {time:2,open:1.15270,high:1.15283,low:1.15193,close:1.15256},
    {time:3,open:1.15255,high:1.15258,low:1.14900,close:1.14920},
    {time:4,open:1.14920,high:1.14930,low:1.14532,close:1.14550},
  ];
  const result=detectGoldilocksZones(sample,{direction:'bearish',startIndex:2,endIndex:4});
  const supply=result.zones.find(zone=>zone.kind==='base');
  assert.ok(supply);
  assert.equal(supply.candleIndex,0);
  assert.equal(supply.low,1.15106);
  assert.equal(supply.high,1.15283);
});

test('counts every touching candle after the first full candle exits the zone',()=>{
  const sample:StrategyCandle[]=[
    {time:0,open:100,high:100.3,low:99,close:99.5},
    {time:1,open:100.5,high:103,low:100.5,close:102.8},
    {time:2,open:102.8,high:103,low:99.8,close:100.2},
    {time:3,open:100.2,high:100.4,low:99.7,close:100.1},
    {time:4,open:101,high:102,low:100.8,close:101.8},
    {time:5,open:101.8,high:102,low:99.9,close:100.3},
  ];
  const result=detectGoldilocksZones(sample,{direction:'bullish',startIndex:0,endIndex:5});
  const base=result.zones.find(zone=>zone.kind==='base');
  assert.equal(base?.touches,3);
  assert.equal(base?.firstTouchIndex,2);
});

test('does not count touches before the originating swing makes a zone actionable',()=>{
  const sample:StrategyCandle[]=[
    {time:10,open:100,high:100.3,low:99,close:99.5},
    {time:20,open:99.5,high:103,low:99.4,close:102.8},
    {time:30,open:102.8,high:103,low:99.8,close:100.2},
    {time:40,open:100.2,high:108,low:100.1,close:107.5},
    {time:50,open:107.5,high:109,low:106.8,close:108.5},
  ];
  const history=detectGoldilocksZoneHistory(sample,[{direction:'bullish',startIndex:0,endIndex:3}]);
  const base=history.zones.find(zone=>zone.kind==='base');
  assert.equal(base?.availableAt,40);
  assert.equal(base?.touches,0);
  assert.equal(base?.firstTouchIndex,undefined);
});

test('invalidates a zone on its fourth qualifying touch',()=>{
  const sample:StrategyCandle[]=[
    {time:10,open:100,high:100.3,low:99,close:99.5},
    {time:20,open:99.5,high:103,low:99.4,close:102.8},
    {time:30,open:102,high:103,low:101,close:102.5},
    {time:40,open:102.5,high:102.8,low:100,close:101},
    {time:50,open:101,high:102,low:99.8,close:100.8},
    {time:60,open:100.8,high:101.5,low:99.5,close:100.5},
    {time:70,open:100.5,high:101,low:99,close:100.2},
  ];
  const history=detectGoldilocksZoneHistory(sample,[{direction:'bullish',startIndex:0,endIndex:1}]);
  const base=history.zones.find(zone=>zone.kind==='base');
  assert.equal(base?.touches,4);
  assert.equal(base?.state,'invalidated');
  assert.equal(base?.invalidatedAt,70);
  assert.equal(base?.maxPenetration,1);
  assert.ok(base?.reasons.some(reason=>reason.includes('fourth qualifying touch')));
  assert.equal(history.activeZones.includes(base!),false);
});

test('historical trade labels snapshot prior touches and exclude the triggering touch candle',()=>{
  const sample:StrategyCandle[]=[
    {time:10,open:100,high:100.3,low:99,close:99.5},
    {time:20,open:99.5,high:103,low:99.4,close:102.8},
    {time:30,open:102,high:103,low:101,close:102.5},
    {time:40,open:102.5,high:102.8,low:100,close:101},
    {time:50,open:101,high:102,low:99.8,close:100.8},
    {time:60,open:100.8,high:101.5,low:99.5,close:100.5},
  ];
  const history=detectGoldilocksZoneHistory(sample,[{direction:'bullish',startIndex:0,endIndex:1}]);
  const base=history.zones.find(zone=>zone.kind==='base');
  assert.ok(base);
  assert.equal(base.touches,3);
  assert.equal(countZoneTouchesBefore(base,sample,3),0);
  assert.equal(countZoneTouchesBefore(base,sample,4),1);
  assert.equal(countZoneTouchesBefore(base,sample,5),2);
});

test('historical scanners keep counting later touch candles while a confirmation is pending',()=>{
  const zone={
    id:'pending-supply',kind:'base' as const,side:'supply' as const,candleIndex:0,candleTime:1,
    availableAt:2,low:100,high:101,width:1,legMidpoint:95,legRange:10,departureMultiple:3,
    strength2x:true,touches:0,maxPenetration:0,state:'fresh' as const,reasons:[],
  };
  const state=createHistoricalZoneTouchState();
  observeHistoricalZoneCandle(zone,{time:3,open:99,high:99.5,low:98.5,close:99},0,state);
  for(let index=1;index<=4;index+=1){
    observeHistoricalZoneCandle(zone,{time:3+index,open:99.8,high:100.2,low:99.7,close:99.9},index,state);
  }
  assert.equal(state.totalTouches,4);
  assert.equal(state.touchesBeforeTouch,3);
  assert.equal(state.touchCandleIndex,4);
  assert.equal(state.invalidated,true);
});

test('historical replay windows include context before entry and the complete stored trade',()=>{
  const entry=1771594260;
  const exit=1771599660;
  const window=getStrategyReplayWindow(entry,exit);
  assert.ok(window.chartStart<entry);
  assert.ok(window.chartEnd>exit);
  assert.ok(window.confirmationStart<entry);
  assert.ok(window.confirmationEnd>entry);
  assert.ok((window.confirmationEnd-window.confirmationStart)/60<5_000);
});

test('records zone age from the M15 base through completed M5 entry eligibility',()=>{
  const base=1777534200;
  const confirmationOpen=1783323000;
  const age=getGoldilocksZoneAgeSeconds(base,confirmationOpen+5*60);
  assert.equal(age,5_789_100);
  assert.equal(formatGoldilocksZoneAge(age),'67.0d');
});

test('historical replay windows include a distant stored M15 base and chart it initially',()=>{
  const base=1777534200;
  const entry=1783323000;
  const exit=1783333440;
  const window=getStrategyReplayWindow(entry,exit,base);
  assert.equal(window.chartStart,base-STRATEGY_REPLAY_BASE_CONTEXT_SECONDS);
  assert.ok(window.chartStart<base);
  assert.equal(getReplayVisibleStart(144,13_200,13_240,20),124);
});

test('historical replay requests never send OANDA a future end time',()=>{
  const now=1784330000;
  assert.equal(getStrategyReplayRequestEnd(now+24*60*60,now),Math.floor(now/60)*60-1);
  assert.equal(getStrategyReplayRequestEnd(now-3600,now),now-3600);
});

test('backtest replay charts start with context before the M15 trade-zone base',()=>{
  const baseTime=1777420800;
  const chartStart=getStrategyReplayBaseContextStart(baseTime);
  assert.equal(chartStart,baseTime-STRATEGY_REPLAY_BASE_CONTEXT_SECONDS);
  assert.ok(chartStart<baseTime);
});

test('replay context includes every projected zone base so no chart box floats without its source candle',()=>{
  const tradeZoneBase=1782957600;
  const contextualDemandBases=[1782732600,1782722700];
  const anchor=getStrategyReplayContextAnchor(tradeZoneBase,[],contextualDemandBases);
  assert.equal(anchor,1782722700);
  assert.ok(getStrategyReplayBaseContextStart(anchor!)<contextualDemandBases[1]);
});

test('historical M1 exits map to the containing higher-timeframe candle, never the next candle',()=>{
  const m5=[14*60+10,14*60+15,14*60+20].map(time=>({time:time*60}));
  assert.equal(getReplayCandleIndexAtOrBefore(m5,(14*60+18)*60),1);
  assert.equal(m5[getReplayCandleIndexAtOrBefore(m5,(14*60+18)*60)].time,(14*60+15)*60);
});

test('historical replay leaves visible space after an exit even when the market has no later candles',()=>{
  assert.equal(getReplayVisibleEnd(100,80,100,'M15'),104);
  assert.equal(getReplayVisibleEnd(100,80,100,'H1'),103);
  assert.equal(getReplayVisibleEnd(150,80,100,'M15'),120);
});

test('failed-touch replay overlays are unique and strictly ascending before chart rendering',()=>{
  const ordered=sortUniqueReplayCandleItems([
    {id:'later-original',candle:{time:1779087300}},
    {id:'earlier',candle:{time:1779084600}},
    {id:'later-replacement',candle:{time:1779087300}},
  ]);
  assert.deepEqual(ordered.map(item=>item.candle.time),[1779084600,1779087300]);
  assert.equal(ordered[1].id,'later-replacement');
});

test('historical exit markers use stop, target, or break-even price according to exit reason',()=>{
  const runway={entry:0.8078,stopLoss:0.80866,takeProfit:0.80608};
  assert.equal(getReplayExitMarkerPrice({exitReason:'stop',runway}),0.80866);
  assert.equal(getReplayExitMarkerPrice({exitReason:'target',runway}),0.80608);
  assert.equal(getReplayExitMarkerPrice({exitReason:'break_even',runway}),0.8078);
  assert.equal(getReplayExitMarkerPrice({exitReason:'weekend_close',exitPrice:0.8072,runway}),0.8072);
});

test('historical zone labels keep outcome, trigger, active state, and dates out of the chart box',()=>{
  const label=formatStrategyZoneLabel({
    historicalTradeZone:true,kind:'base',side:'supply',departureMultiple:18.24,touches:0,
    timeframeConfluence:{timeframeCount:2,timeframes:['M15','M5']},
  });
  assert.equal(label,'HISTORY TRADE ZONE · Base supply · 18.2x · 0 prior touches · ZIZ 2/3 · M15+M5');
  assert.doesNotMatch(label,/WIN|LOSS|trigger touch|active|UTC|\d{4}-\d{2}-\d{2}/i);
  const contextLabel=formatStrategyZoneLabel({
    historicalTradeZone:false,historicalContextZone:true,kind:'base',side:'supply',departureMultiple:3.6,touches:0,
    timeframeConfluence:{timeframeCount:2,timeframes:['M15','M5']},
  });
  assert.equal(contextLabel,'HISTORY CONTEXT ZONE · Base supply · 3.6x · 0 touches · ZIZ 2/3 · M15+M5');
});

test('historical replay zones exclude future bases and use validity at confirmation time',()=>{
  const replayZone={
    id:'m15-supply',kind:'base' as const,side:'supply' as const,candleIndex:0,
    candleTime:100,availableAt:200,low:1.17,high:1.18,width:0.01,
    legMidpoint:1.16,legRange:0.04,departureMultiple:3,strength2x:true,
    touches:0,maxPenetration:0,state:'invalidated' as const,invalidatedAt:400,reasons:[],
  };
  assert.equal(zoneUsableAt(replayZone,199),false);
  assert.equal(zoneUsableAt(replayZone,200),true);
  assert.equal(zoneUsableAt(replayZone,399),true);
  assert.equal(zoneUsableAt(replayZone,400),false);
});

test('removes a failed first-touch marker once its source zone is invalid at the displayed replay time',()=>{
  const sourceZone={
    id:'continuation-demand',kind:'continuation' as const,side:'demand' as const,candleIndex:0,
    candleTime:100,availableAt:110,low:186.51,high:186.548,width:0.038,
    legMidpoint:186.688,legRange:0.734,departureMultiple:12.5,strength2x:true,
    touches:0,maxPenetration:0,state:'invalidated' as const,invalidatedAt:120,reasons:[],
  };
  const marker={zoneId:sourceZone.id,time:115,candle:{time:115}};
  assert.deepEqual(filterReplayRejectedFirstTouchesAt([marker],[sourceZone],119),[marker]);
  assert.deepEqual(filterReplayRejectedFirstTouchesAt([marker],[sourceZone],120),[]);
});

test('removes an orphan failed first-touch marker when its valid source zone is not drawn',()=>{
  const sourceZone={
    id:'unrelated-supply',kind:'base' as const,side:'supply' as const,candleIndex:0,
    candleTime:100,availableAt:110,low:187.316,high:187.367,width:0.051,
    legMidpoint:187.165,legRange:0.404,departureMultiple:6.8,strength2x:true,
    touches:0,maxPenetration:0,state:'invalidated' as const,invalidatedAt:500,reasons:[],
  };
  const marker={zoneId:sourceZone.id,time:115,candle:{time:115}};
  assert.deepEqual(filterReplayRejectedFirstTouchesAt([marker],[sourceZone],200,new Set([sourceZone.id])),[marker]);
  assert.deepEqual(filterReplayRejectedFirstTouchesAt([marker],[sourceZone],200,new Set(['drawn-trade-zone'])),[]);
});

test('records reversal strength and the overlapping base candle count',()=>{
  const sample:StrategyCandle[]=[
    {time:1,open:101,high:101.2,low:99.8,close:100},
    {time:2,open:100.8,high:101,low:99.7,close:100.1},
    {time:3,open:100.1,high:105,low:100,close:104.8},
  ];
  const result=detectGoldilocksZones(sample,{direction:'bullish',startIndex:1,endIndex:2,startSwing:'LL',endSwing:'HH',brokeOppositeLegIn:true});
  const base=result.zones.find(zone=>zone.kind==='base');
  assert.equal(base?.brokeOppositeLegIn,true);
  assert.equal(base?.baseCandleCount,2);
});

test('rechecks 2:1 at the actual entry price after the engulf close and skips a missed trade',()=>{
  const result=detectGoldilocksZones(candles,{direction:'bullish',startIndex:5,endIndex:13});
  const demand=result.zones.find(zone=>zone.kind==='continuation');
  assert.ok(demand);
  const supply={...demand,id:'active-supply',side:'supply' as const,low:109,high:110,candleTime:demand.candleTime+1,state:'fresh' as const};
  const atClose=validateFinalEntryAfterEngulf(demand,[demand,supply],104.6,104.6);
  assert.equal(atClose.allowed,true);
  const afterMove=validateFinalEntryAfterEngulf(demand,[demand,supply],104.6,107.1);
  assert.equal(afterMove.allowed,false);
  assert.ok(afterMove.reason.includes('MISSED - DO NOT CHASE'));
});

test('records same-side overlapping zones across the three scoring timeframes',()=>{
  const result=detectGoldilocksZones(candles,{direction:'bullish',startIndex:5,endIndex:13});
  const demand=result.zones.find(zone=>zone.kind==='continuation');
  assert.ok(demand);
  const h1={...demand,id:'h1-demand',low:demand.low-0.2,high:demand.high+0.2};
  const h4Supply={...demand,id:'h4-supply',side:'supply' as const};
  const annotated=annotateTimeframeConfluence([demand],'M15',[
    {timeframe:'H1',zones:[h1]},
    {timeframe:'H4',zones:[h4Supply]},
  ])[0];
  assert.deepEqual(annotated.timeframeConfluence?.timeframes,['M15','H1']);
  assert.equal(annotated.timeframeConfluence?.timeframeCount,2);
  assert.equal(annotated.timeframeConfluence?.overlaps[0].relationship,'inside');
});

test('rejects a continuation that breaks its distal edge before the 2x departure',()=>{
  const sample:StrategyCandle[]=[
    {time:0,open:1.399,high:1.3993,low:1.398,close:1.3985},
    {time:1,open:1.3985,high:1.402,low:1.3984,close:1.4018},
    {time:2,open:1.4018,high:1.4022,low:1.4007,close:1.4009},
    {time:3,open:1.4009,high:1.4012,low:1.4002,close:1.4004},
    {time:4,open:1.4004,high:1.410,low:1.4003,close:1.409},
  ];
  const result=detectGoldilocksZones(sample,{direction:'bullish',startIndex:0,endIndex:4});
  assert.equal(result.zones.some(zone=>zone.kind==='continuation'),false);
  assert.ok(result.rejected.some(item=>item.reason.includes('before it could remain an active zone')));
});

test('groups alternating-color overlapping sideways candles into one continuation cluster',()=>{
  const sample:StrategyCandle[]=[
    {time:0,open:99.8,high:100.2,low:99,close:99.3},
    {time:1,open:99.3,high:104,low:99.2,close:103.7},
    {time:2,open:103.5,high:104.0,low:102.9,close:103.1},
    {time:3,open:103.05,high:103.9,low:102.95,close:103.6},
    {time:4,open:103.55,high:104.0,low:102.7,close:102.9},
    {time:5,open:102.95,high:103.8,low:102.8,close:103.5},
    {time:6,open:103.5,high:108,low:103.4,close:107.7},
    {time:7,open:107.7,high:112,low:107.5,close:111.6},
  ];
  const result=detectGoldilocksZones(sample,{direction:'bullish',startIndex:0,endIndex:7});
  const continuations=result.zones.filter(zone=>zone.kind==='continuation');
  assert.equal(continuations.length,1);
  assert.equal(continuations[0].candleIndex,4);
  assert.equal(continuations[0].low,102.7);
  assert.equal(continuations[0].high,103.55);
});
test('scales fixed-fractional risk from the eligible score to 20 for each profile', () => {
  assert.equal(calculateScoreRisk(14, 14, 'easy').riskPercentage, 0.1);
  assert.equal(calculateScoreRisk(20, 14, 'easy').riskPercentage, 0.25);
  assert.equal(calculateScoreRisk(14, 14, 'default').riskPercentage, 0.25);
  assert.equal(calculateScoreRisk(17, 14, 'default').riskPercentage, 0.375);
  assert.equal(calculateScoreRisk(20, 14, 'default').riskPercentage, 0.5);
  assert.equal(calculateScoreRisk(14, 14, 'aggressive').riskPercentage, 0.5);
  assert.equal(calculateScoreRisk(20, 14, 'aggressive').riskPercentage, 1);
});

test('historical high-impact news blocks either pair currency throughout the inclusive one-hour window',()=>{
  const event={currency:'USD',title:'CPI m/m',scheduledAt:10_000,windowStart:6_400,windowEnd:13_600,timeLabel:'8:30am'};
  assert.equal(evaluateHistoricalNewsGate('EUR/USD',6_400,[event]).allowed,false);
  assert.equal(evaluateHistoricalNewsGate('EUR/USD',13_600,[event]).allowed,false);
  assert.equal(evaluateHistoricalNewsGate('EUR/USD',13_601,[event]).allowed,true);
  assert.equal(evaluateHistoricalNewsGate('GBP/JPY',10_000,[event]).allowed,true);
});

test('replays multiple versioned managers on the identical M1 path',()=>{
  const path:StrategyCandle[]=[
    {time:100,open:100,high:101.1,low:99.5,close:100.8},
    {time:160,open:100.8,high:102.1,low:100.4,close:102},
    {time:220,open:102,high:104.1,low:100.9,close:103},
  ];
  const results=evaluateGoldilocksManagementPolicies({candles:path,startIndex:0,direction:'BUY',entry:100,stopLoss:99});
  assert.equal(results.find(result=>result.policyId==='set-forget-2r-v1')?.realizedR,2);
  assert.equal(results.find(result=>result.policyId==='partial-25-runner-4r-v1')?.realizedR,1.75);
  assert.equal(results.find(result=>result.policyId==='partial-50-runner-4r-v1')?.realizedR,1.5);
  assert.equal(results[0].path.firstReachedAt['+1R'],100);
  assert.equal(results[0].path.firstReachedAt['+2R'],160);
});

test('research manager grid spans target, break-even, and partial-runner choices without changing entry risk',()=>{
  assert.equal(GOLDILOCKS_MANAGEMENT_POLICIES.length,22);
  assert.ok(GOLDILOCKS_MANAGEMENT_POLICIES.some(policy=>policy.id==='set-forget-1r-v1'));
  assert.ok(GOLDILOCKS_MANAGEMENT_POLICIES.some(policy=>policy.id==='set-forget-5r-v1'));
  assert.ok(GOLDILOCKS_MANAGEMENT_POLICIES.some(policy=>policy.id==='be-at-1r-full-3r-v1'));
  assert.ok(GOLDILOCKS_MANAGEMENT_POLICIES.some(policy=>policy.id==='partial-75-runner-5r-v1'));
  assert.ok(GOLDILOCKS_MANAGEMENT_POLICIES.every(policy=>policy.version===1));
});

test('uses a conservative stop when one M1 candle contains both stop and break-even activation',()=>{
  const result=evaluateTradeManagementPolicy({
    candles:[{time:100,open:100,high:101.2,low:98.8,close:100}],startIndex:0,direction:'BUY',entry:100,stopLoss:99,
    policy:GOLDILOCKS_MANAGEMENT_POLICIES.find(policy=>policy.id==='be-at-1r-full-2r-v1')!,
  });
  assert.equal(result.realizedR,-1);
  assert.equal(result.exitReason,'stop');
  assert.equal(result.path.ambiguousCandles.length,1);
});

test('records a timeframe-normalized supply-demand corridor without future zones',()=>{
  const base={kind:'base' as const,candleIndex:0,candleTime:1,availableAt:2,width:1,legMidpoint:0,legRange:1,departureMultiple:2,strength2x:true,touches:0,maxPenetration:0,state:'fresh' as const,reasons:[]};
  const demand={...base,id:'demand',side:'demand' as const,low:99,high:100};
  const supply={...base,id:'supply',side:'supply' as const,low:110,high:111};
  const future={...base,id:'future-supply',side:'supply' as const,low:105,high:106,availableAt:999};
  const candles:Array<StrategyCandle>=Array.from({length:16},(_,index)=>({time:index+1,open:100,high:101,low:99,close:100}));
  const corridor=measureZoneCorridor({pair:'EUR/USD',timeframe:'M15',measuredAt:20,entry:102,stopLoss:99,takeProfit:108,zones:[demand,supply,future],candles});
  assert.equal(corridor.available,true);
  assert.equal(corridor.width,10);
  assert.equal(corridor.entryLocationPct,20);
  assert.equal(corridor.initialRiskPct,30);
  assert.equal(corridor.targetDistancePct,60);
  assert.equal(corridor.supplyZoneId,'supply');
});

test('merges overlapping and candle-adjacent archive coverage without inventing distant coverage',()=>{
  assert.deepEqual(mergeCandleCoverageRanges([
    {startTime:300,endTime:400},{startTime:100,endTime:200},{startTime:190,endTime:250},{startTime:261,endTime:290},
  ],10),[
    {startTime:100,endTime:250},{startTime:261,endTime:400},
  ]);
});
