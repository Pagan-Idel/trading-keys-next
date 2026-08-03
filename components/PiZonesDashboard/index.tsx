import {useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/router';
import StrategyLabChart from '../StrategyLabChart';
import {forexPairs} from '../../utils/constants';
import type {GoldilocksZone,StrategyCandle,SwingLeg} from '../../utils/goldilocksStrategy';
import type {GoldilocksApproachPressure} from '../../utils/approachPressure';

type Setup={zone:GoldilocksZone;touchCandle:StrategyCandle;confirmationCandle:StrategyCandle;approachPressure?:GoldilocksApproachPressure};
type ActiveTrade={tradeId:string;direction:'BUY'|'SELL';entry:number;stopLoss?:number;takeProfit?:number;openedAt?:string};
type Snapshot={pair:string;scannedAt:string;trend:'bullish'|'bearish'|'unknown';zones:GoldilocksZone[];candles:Record<string,StrategyCandle[]>;confirmationCount:number;setups?:Setup[];activeTrade?:ActiveTrade};
export default function PiZonesDashboard(){
  const router=useRouter();
  const [pair,setPair]=useState('AUD/USD'),[timeframe,setTimeframe]=useState<'M1'|'M5'|'M15'|'H1'>('M15');
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState('');
  useEffect(()=>{if(typeof router.query.pair==='string'&&forexPairs.includes(router.query.pair))setPair(router.query.pair)},[router.query.pair]);
  useEffect(()=>{let active=true;const load=async()=>{try{const r=await fetch(`/api/automation/pi-zones?pair=${encodeURIComponent(pair)}`,{cache:'no-store'});const p=await r.json();if(!r.ok)throw new Error(p.error);if(active){setSnapshot(p);setError('')}}catch(e){if(active)setError(e instanceof Error?e.message:String(e))}};void load();const timer=setInterval(load,3000);return()=>{active=false;clearInterval(timer)}},[pair]);
  const candles=useMemo(()=>snapshot?.candles[timeframe]??[],[snapshot,timeframe]);
  const leg=useMemo<SwingLeg>(()=>({direction:snapshot?.trend==='bearish'?'bearish':'bullish',startIndex:0,endIndex:Math.max(0,candles.length-1),startPrice:candles[0]?.close??0,endPrice:candles.at(-1)?.close??0,range:Math.abs((candles.at(-1)?.close??0)-(candles[0]?.close??0)),startSwing:'L',endSwing:'H'}),[candles,snapshot?.trend]);
  const setup=snapshot?.setups?.at(-1);
  const active=snapshot?.activeTrade;
  const entry=active?.entry??setup?.confirmationCandle.close;
  const stop=active?.stopLoss??(setup?.zone.side==='demand'?setup?.zone.low:setup?.zone.high);
  const risk=entry!==undefined&&stop!==undefined?Math.abs(entry-stop):0;
  const tradeSetup=setup&&entry!==undefined&&stop!==undefined?{tradeId:active?.tradeId,zone:setup.zone,confirmationTimeframe:'M5',confirmationTime:setup.confirmationCandle.time,confirmationCandle:setup.confirmationCandle,touchCandle:setup.touchCandle,approachPressure:setup.approachPressure,outcome:'open' as const,runway:{allowed:true,direction:setup.zone.side==='demand'?'buy' as const:'sell' as const,entry,stopLoss:stop,takeProfit:active?.takeProfit??(setup.zone.side==='demand'?entry+risk*2:entry-risk*2),risk,reward:risk*2,availableReward:Number.POSITIVE_INFINITY,availableRatio:Number.POSITIVE_INFINITY,ratio:2,reason:active?'Current broker trade geometry.':'Latest actionable Pi setup geometry.'}}:null;
  return <section><div style={{display:'flex',gap:12,alignItems:'center',marginBottom:16,flexWrap:'wrap'}}><select aria-label="Pi automation pair" value={pair} onChange={e=>setPair(e.target.value)}>{forexPairs.map(p=><option key={p}>{p}</option>)}</select><span style={{color:error?'#ff8d98':'#69e69a'}}>{error?'Pi connection unavailable':'Connected to Pi'}</span>{error&&<button type="button" onClick={()=>location.reload()}>Reconnect</button>}</div>{error&&<p style={{color:'#ff8d98'}}>{error}</p>}{snapshot&&<><p>{snapshot.trend.toUpperCase()} · {snapshot.zones.length} active base zone(s) · {snapshot.confirmationCount} actionable confirmation(s) · {active?`ACTIVE ${active.direction} TRADE · `:''}Pi scan {new Date(snapshot.scannedAt).toLocaleString()}</p><StrategyLabChart direction={snapshot.trend==='bearish'?'bearish':'bullish'} timeframe={timeframe} onTimeframeChange={setTimeframe} drawingStorageKey={`pi-${pair}-${timeframe}`} tradeId={active?.tradeId} scenario={{candles,timeframe,leg,zones:snapshot.zones,tradeSetup}} /></>}</section>
}
