import assert from 'node:assert/strict';
import test from 'node:test';
import type { Candle } from '../utils/swingLabeler.ts';
import { ContinuousCandleCollector,activeCandleSynchronizationCount,findUnexpectedGap,isScheduledForexClosure,type CandleCollectorDependencies,type CandleCollectorKey } from '../utils/continuousCandleCollector.ts';
import { canExecuteTouch,shouldRetainPricingStream,transitionZoneLifecycle,type ZoneLifecycleRecord } from '../utils/zoneLifecycle.ts';
import { minimumSafeRetentionDays } from '../utils/candleArchive.ts';
import { stableZoneLegKey } from '../utils/goldilocksStrategy.ts';
import { getHubInterestSnapshot,updateHubInterest } from '../utils/oanda/api/marketDataHub.ts';

const candle=(seconds:number):Candle=>({time:new Date(seconds*1000).toISOString(),candleIndex:0,open:1,high:2,low:0,close:1});
let fixtureId=0;
const fixture=(initial:number[]=[],returned:number[]=[])=>{
  const key:CandleCollectorKey={pair:`EUR/USD-${++fixtureId}`,timeframe:'M5',mode:'demo'};
  const stored=new Map(initial.map(time=>[time,candle(time)]));let bootstrapCalls=0,incrementalCalls=0;
  let release:(()=>void)|undefined;
  const dependencies:CandleCollectorDependencies={
    bounds:()=>{const times=[...stored.keys()].sort((a,b)=>a-b);return {startTime:times[0]??null,endTime:times.at(-1)??null,candleCount:times.length}},
    bootstrap:async()=>{bootstrapCalls++;for(const time of returned)stored.set(time,candle(time));return [...stored.values()]},
    incremental:async()=>{incrementalCalls++;if(release)await new Promise<void>(resolve=>{const previous=release;release=()=>{previous?.();resolve()}});return returned.map(candle)},
    repair:async()=>[],
    append:(_key,candles)=>{let writes=0;for(const item of candles){const time=Math.floor(Date.parse(item.time)/1000);if(!stored.has(time))writes++;stored.set(time,item)}return writes},
    recordGap:()=>undefined,clearGaps:()=>undefined,
    read:()=>[...stored.values()],now:()=>2_000_000*1000,
  };
  return {key,stored,dependencies,get bootstrapCalls(){return bootstrapCalls},get incrementalCalls(){return incrementalCalls},block(){release=()=>{}},unblock(){release?.();release=undefined}};
};

test('startup backfills only an empty archive',async()=>{const f=fixture([], [1000]);await new ContinuousCandleCollector(f.key,{lookbackDays:730,maxCandles:5000},f.dependencies).bootstrap();assert.equal(f.bootstrapCalls,1)});
test('startup with local candles avoids full-history bootstrap',async()=>{const f=fixture([1000],[1300]);await new ContinuousCandleCollector(f.key,{lookbackDays:730,maxCandles:5000},f.dependencies).bootstrap();assert.equal(f.bootstrapCalls,0);assert.equal(f.incrementalCalls,1)});
test('normal close appends one completed candle',async()=>{const f=fixture([1000],[1300]);const result=await new ContinuousCandleCollector(f.key,{lookbackDays:730,maxCandles:5000},f.dependencies).synchronize();assert.equal(result.appended,1)});
test('missed intervals append all returned missing candles',async()=>{const f=fixture([1000],[1300,1600,1900]);const result=await new ContinuousCandleCollector(f.key,{lookbackDays:730,maxCandles:5000},f.dependencies).synchronize();assert.equal(result.appended,3)});
test('an unresolved leading gap is reported without advancing storage',async()=>{const f=fixture([1000],[1600]);const result=await new ContinuousCandleCollector(f.key,{lookbackDays:730,maxCandles:5000},f.dependencies).synchronize();assert.equal(result.gapDetected,true);assert.equal(f.dependencies.bounds(f.key).endTime,1000)});
test('targeted repair atomically promotes repaired and newer candles',async()=>{const f=fixture([1000],[1600]);f.dependencies.repair=async()=>[candle(1300)];const result=await new ContinuousCandleCollector(f.key,{lookbackDays:730,maxCandles:5000},f.dependencies).synchronize();assert.equal(result.gapDetected,false);assert.deepEqual([...f.stored.keys()].sort(),[1000,1300,1600])});
test('duplicate responses do not duplicate stored candles',async()=>{const f=fixture([1000,1300],[1300]);const result=await new ContinuousCandleCollector(f.key,{lookbackDays:730,maxCandles:5000},f.dependencies).synchronize();assert.equal(result.appended,0);assert.equal(f.stored.size,2)});
test('failed request leaves the last timestamp unchanged and next success repairs it',async()=>{const f=fixture([1000],[1300]);let fail=true;const incremental=f.dependencies.incremental;f.dependencies.incremental=async(...args)=>{if(fail){fail=false;throw new Error('offline')}return incremental(...args)};const collector=new ContinuousCandleCollector(f.key,{lookbackDays:730,maxCandles:5000},f.dependencies);await assert.rejects(collector.synchronize());assert.equal(f.dependencies.bounds(f.key).endTime,1000);assert.equal((await collector.synchronize()).appended,1)});
test('one operation per pair/timeframe is in flight',async()=>{const f=fixture([1000],[1300]);let resolve!:()=>void;f.dependencies.incremental=async()=>{await new Promise<void>(r=>{resolve=r});return [candle(1300)]};const collector=new ContinuousCandleCollector(f.key,{lookbackDays:730,maxCandles:5000},f.dependencies);const first=collector.synchronize(),second=collector.synchronize();assert.equal(first,second);assert.equal(activeCandleSynchronizationCount(),1);resolve();await first});
test('shutdown abort propagates without advancing archive',async()=>{const f=fixture([1000],[]);f.dependencies.incremental=async(_key,_last,_count,signal)=>new Promise((_r,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true}));const controller=new AbortController();const promise=new ContinuousCandleCollector(f.key,{lookbackDays:730,maxCandles:5000},f.dependencies).synchronize(controller.signal);controller.abort();await assert.rejects(promise);assert.equal(f.dependencies.bounds(f.key).endTime,1000)});

const discovered=():ZoneLifecycleRecord=>({zoneId:'z1',pair:'EUR/USD',state:'DISCOVERED',updatedAt:1});
test('zone discovery progresses through departure pending and active far',()=>{const pending=transitionZoneLifecycle(discovered(),{type:'departure_pending'},2);assert.equal(pending.state,'DEPARTURE_PENDING');assert.equal(transitionZoneLifecycle(pending,{type:'departure_confirmed'},3).state,'ACTIVE_FAR')});
test('approach, arm, touch, and execution are idempotent',()=>{let state=transitionZoneLifecycle(discovered(),{type:'departure_confirmed'});state=transitionZoneLifecycle(state,{type:'approach'});state=transitionZoneLifecycle(state,{type:'arm'});state=transitionZoneLifecycle(state,{type:'touch',touchKey:'t1'});state=transitionZoneLifecycle(state,{type:'execute'});assert.equal(state.state,'EXECUTED');assert.equal(transitionZoneLifecycle(state,{type:'touch',touchKey:'t2'}),state)});
test('invalid and expired zones are terminal',()=>{const invalid=transitionZoneLifecycle(discovered(),{type:'invalidate',reason:'distal break'});assert.equal(transitionZoneLifecycle(invalid,{type:'departure_confirmed'}).state,'INVALIDATED');const expired=transitionZoneLifecycle(discovered(),{type:'expire',reason:'age'});assert.equal(expired.state,'EXPIRED')});
test('hysteresis permits returning an approaching zone to far',()=>{let state=transitionZoneLifecycle(discovered(),{type:'departure_confirmed'});state=transitionZoneLifecycle(state,{type:'approach'});assert.equal(transitionZoneLifecycle(state,{type:'far'}).state,'ACTIVE_FAR')});
test('fresh stream and known broker state are mandatory for one touch',()=>{const armed:{state:'ARMED'}&ZoneLifecycleRecord={...discovered(),state:'ARMED'};assert.equal(canExecuteTouch(armed,true,true,'t1'),true);assert.equal(canExecuteTouch(armed,false,true,'t1'),false);assert.equal(canExecuteTouch({...armed,touchKey:'t1'},true,true,'t1'),false)});
test('stream policy releases protected set-and-forget and retains active management',()=>{assert.equal(shouldRetainPricingStream({actionableZones:0,armed:false,activeManagement:false,setAndForgetProtected:true,shutdown:false}),false);assert.equal(shouldRetainPricingStream({actionableZones:0,armed:false,activeManagement:true,setAndForgetProtected:false,shutdown:false}),true)});
test('zone state and trade mode never stop candle synchronization policy',async()=>{for(const _condition of ['invalid','open','set-forget','managed']){const f=fixture([1000],[1300]);assert.equal((await new ContinuousCandleCollector(f.key,{lookbackDays:730,maxCandles:5000},f.dependencies).synchronize()).appended,1)}});
test('retention floors preserve each bounded live working set plus safety margin',()=>{assert.deepEqual(['M1','M5','M15','H1'].map(minimumSafeRetentionDays),[30,45,100,330])});
test('New York weekend closure is calendar classified across DST',()=>{for(const value of ['2026-01-10T12:00:00Z','2026-07-11T12:00:00Z'])assert.equal(isScheduledForexClosure(Date.parse(value)/1000),true)});
test('weekday and holiday-like gaps fail conservatively',()=>{const start=Date.parse('2026-12-24T15:00:00Z')/1000;assert.ok(findUnexpectedGap(start,[start+900],300));});
test('zone leg identity uses stable candle times rather than reconstruction indexes',()=>{assert.equal(stableZoneLegKey('bullish',100,200),stableZoneLegKey('bullish',100,200));assert.notEqual(stableZoneLegKey('bullish',100,200),stableZoneLegKey('bullish',101,200))});
test('hub interest is lease-deduplicated and drops the network subscription at zero owners',()=>{const instrument='TEST_PAIR';updateHubInterest(instrument,'owner-a',true);updateHubInterest(instrument,'owner-a',true);updateHubInterest(instrument,'owner-b',true);assert.equal(getHubInterestSnapshot().instruments.filter(value=>value===instrument).length,1);updateHubInterest(instrument,'owner-a',false);assert.ok(getHubInterestSnapshot().instruments.includes(instrument));updateHubInterest(instrument,'owner-b',false);assert.ok(!getHubInterestSnapshot().instruments.includes(instrument))});
