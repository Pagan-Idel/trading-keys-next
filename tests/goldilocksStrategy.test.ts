import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectGoldilocksZones,
  detectGoldilocksZoneHistory,
  findFullCandleEngulfing,
  findCloseBeyondTouchedCandle,
  validateTwoToOneRunway,
  validateFinalEntryAfterEngulf,
  annotateTimeframeConfluence,
  countZoneTouchesBefore,
  type StrategyCandle,
} from '../utils/goldilocksStrategy';
import { applySpreadBuffer, calculateExactRiskRewardLevels, evaluateSpread } from '../utils/spreadGuard';
import { findFreshGoldilocksConfirmations } from '../utils/goldilocksScanner';
import { isTradeSessionOpen } from '../utils/sessionUtils';
import { zonedWallClockToEpoch } from '../utils/newsGuard';
import { scoreGoldilocksSetup } from '../utils/goldilocksScoring';
import { classifyTradeOutcome } from '../utils/tradeHistory';
import { buildProtectedOutcomeResolver, resolveProtectedOutcome } from '../utils/goldilocksBacktest';
import { getGoldilocksMinimumScore } from '../utils/goldilocksConfig';

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

test('backtest records +1R immediately as a protected win and treats ambiguous stop candles conservatively',()=>{
  const clean=[{time:1,open:100,high:102.1,low:99.5,close:101.5}];
  assert.deepEqual(resolveProtectedOutcome(clean,0,'BUY',98,102),{outcome:'WIN',outcomeTime:1,exitReason:'one_r_protected'});
  const ambiguous=[{time:2,open:100,high:102.1,low:97.9,close:101}];
  assert.deepEqual(resolveProtectedOutcome(ambiguous,0,'BUY',98,102),{outcome:'LOSS',outcomeTime:2,exitReason:'stop'});
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
  const fresh=findFreshGoldilocksConfirmations(history,confirmationCandles,300,600_000);
  assert.equal(fresh.length,1);
  assert.equal(fresh[0].touchCandle.time,200);
  assert.equal(findFreshGoldilocksConfirmations(history,confirmationCandles,300,900_000).length,0);
});

test('uses explicit market timezones for daylight-saving sessions and news timestamps',()=>{
  assert.equal(isTradeSessionOpen('USD/CAD',new Date('2026-07-16T12:30:00Z')),true);
  assert.equal(isTradeSessionOpen('USD/CAD',new Date('2026-01-16T13:30:00Z')),true);
  assert.equal(isTradeSessionOpen('USD/CAD',new Date('2026-07-16T11:30:00Z')),false);
  assert.equal(new Date(zonedWallClockToEpoch('2026-07-16','08:30:00')).toISOString(),'2026-07-16T13:30:00.000Z');
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
  assert.equal(passed.total,10);
});

test('caps trend at two points and the complete score at twenty',()=>{
  const zone={
    id:'max-score-zone',kind:'base' as const,side:'demand' as const,candleIndex:0,candleTime:1,
    low:99,high:100,width:1,legMidpoint:105,legRange:12,departureMultiple:3,strength2x:true,
    baseCandleCount:1,brokeOppositeLegIn:true,touches:1,maxPenetration:0.1,state:'touched' as const,reasons:[],
    timeframeConfluence:{timeframes:['M1','M5','M15'],timeframeCount:3,overlaps:[]},
  };
  const score=scoreGoldilocksSetup({
    zone,tradeDirection:'BUY',trend:'bullish',minimumScore:0,purityTouches:0,purityMaxPenetration:0,
    availableRewardRisk:6,rangeAssessment:{aligned:true,detail:'correct M15 half'},
    gates:[{name:'all',passed:true,reason:'passed'}],
  });
  assert.equal(score.components.find(component=>component.name==='M15 trend')?.points,2);
  assert.equal(score.total,20);
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
