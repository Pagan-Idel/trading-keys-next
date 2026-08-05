import assert from 'node:assert/strict';
import test from 'node:test';
import {detectGoldilocksImbalanceBalanceZones,type StrategyCandle} from '../utils/goldilocksStrategy.ts';
import {resolveProtectedOutcome} from '../utils/goldilocksBacktest.ts';
import {GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID} from '../utils/goldilocksTradeManagement.ts';

const imbalanceBalanceFixture=(arrival:'up'|'down',departure:'up'|'down'):StrategyCandle[]=>{
  const candles=Array.from({length:14},(_,index)=>{
    const center=100+(index%2===0?0.02:-0.02);
    return {time:index*900,open:center-0.04,high:center+0.15,low:center-0.15,close:center+0.04};
  });
  candles.push(arrival==='up'
    ?{time:14*900,open:100,high:100.75,low:99.95,close:100.7}
    :{time:14*900,open:100,high:100.05,low:99.25,close:99.3});
  const center=arrival==='up'?100.66:99.34;
  for(let index=0;index<4;index+=1){
    const shift=((index%3)-1)*0.01;
    candles.push({time:(15+index)*900,open:center-0.04+shift,high:center+0.11+shift,low:center-0.11+shift,close:center+0.04-shift});
  }
  const departureIndex=19;
  const direction=departure==='up'?1:-1;
  candles.push(
    {time:departureIndex*900,open:center,high:direction>0?center+0.85:center+0.03,low:direction>0?center-0.03:center-0.85,close:center+direction*0.8},
    {time:(departureIndex+1)*900,open:center+direction*0.8,high:direction>0?center+1:center-0.5,low:direction>0?center+0.5:center-1,close:center+direction*0.9},
    {time:(departureIndex+2)*900,open:center+direction*0.9,high:direction>0?center+1.1:center-0.6,low:direction>0?center+0.6:center-1.1,close:center+direction},
  );
  return candles;
};

const detectionFingerprint=()=>[
  ['up','up'],['down','down'],['up','down'],['down','up'],
].flatMap(([arrival,departure])=>detectGoldilocksImbalanceBalanceZones(
  imbalanceBalanceFixture(arrival as 'up'|'down',departure as 'up'|'down'),
).map(zone=>({pattern:zone.imbalancePattern,side:zone.side,balanceCandles:zone.balanceMetrics?.candleCount,low:Number(zone.low.toFixed(4)),high:Number(zone.high.toFixed(4))})));

test('CONTROL: frozen candles always produce the same four strategy zones',()=>{
  const expected=[
    {pattern:'up-balance-up',side:'demand',balanceCandles:4,low:100.54,high:100.71},
    {pattern:'down-balance-down',side:'supply',balanceCandles:4,low:99.29,high:99.46},
    {pattern:'up-balance-down',side:'supply',balanceCandles:4,low:100.61,high:100.78},
    {pattern:'down-balance-up',side:'demand',balanceCandles:4,low:99.22,high:99.39},
  ];
  for(let replay=0;replay<10;replay+=1)assert.deepEqual(detectionFingerprint(),expected);
});

const executionFingerprint=()=>{
  const scenarios:Array<{direction:'BUY'|'SELL';candles:StrategyCandle[]}>= [
    {direction:'BUY',candles:[{time:1,open:100,high:102.1,low:99.4,close:102}]},
    {direction:'BUY',candles:[{time:2,open:100,high:100.4,low:98.9,close:99}]},
    {direction:'SELL',candles:[{time:3,open:100,high:100.6,low:97.9,close:98}]},
    {direction:'SELL',candles:[{time:4,open:100,high:101.1,low:99.6,close:101}]},
    {direction:'BUY',candles:[{time:5,open:100,high:101.5,low:99.4,close:101}]},
  ];
  const results=scenarios.map(({direction,candles})=>resolveProtectedOutcome(
    candles,0,direction,direction==='BUY'?99:101,direction==='BUY'?101:99,
    undefined,11,undefined,GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID,
  ));
  const resolved=results.filter((result):result is NonNullable<typeof result>=>result!==null);
  return {resolvedTrades:resolved.length,realizedR:resolved.map(result=>result.realizedR),totalR:resolved.reduce((sum,result)=>sum+result.realizedR,0),exitReasons:resolved.map(result=>result.exitReason)};
};

test('CONTROL: fixed 2R execution paths keep the same trade count and aggregate R',()=>{
  const expected={resolvedTrades:4,realizedR:[2,-1,2,-1],totalR:2,exitReasons:['target','stop','target','stop']};
  for(let replay=0;replay<10;replay+=1)assert.deepEqual(executionFingerprint(),expected);
});
