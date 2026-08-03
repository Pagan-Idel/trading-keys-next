import {useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/router';
import StrategyLabChart from '../components/StrategyLabChart';
import {forexPairs} from '../utils/constants';
import type {GoldilocksZone,StrategyCandle,SwingLeg} from '../utils/goldilocksStrategy';

type Snapshot={pair:string;scannedAt:string;trend:'bullish'|'bearish'|'unknown';zoneTimeframe:string;confirmationTimeframe:string;zones:GoldilocksZone[];candles:Record<string,StrategyCandle[]>;confirmationCount:number};
export default function PiZones(){
  const router=useRouter();
  const [pair,setPair]=useState('EUR/USD'),[timeframe,setTimeframe]=useState<'M5'|'M15'>('M15');
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState('');
  useEffect(()=>{if(typeof router.query.pair==='string'&&forexPairs.includes(router.query.pair))setPair(router.query.pair)},[router.query.pair]);
  useEffect(()=>{let active=true;const load=async()=>{try{const r=await fetch(`/api/automation/pi-zones?pair=${encodeURIComponent(pair)}`,{cache:'no-store'});const p=await r.json();if(!r.ok)throw new Error(p.error);if(active){setSnapshot(p);setError('')}}catch(e){if(active)setError(e instanceof Error?e.message:String(e))}};void load();const timer=setInterval(load,5000);return()=>{active=false;clearInterval(timer)}},[pair]);
  const candles=useMemo(()=>snapshot?.candles[timeframe]??[],[snapshot,timeframe]);
  const leg=useMemo<SwingLeg>(()=>({direction:snapshot?.trend==='bearish'?'bearish':'bullish',startIndex:0,endIndex:Math.max(0,candles.length-1),startPrice:candles[0]?.close??0,endPrice:candles.at(-1)?.close??0,range:Math.abs((candles.at(-1)?.close??0)-(candles[0]?.close??0)),startSwing:'L',endSwing:'H'}),[candles,snapshot?.trend]);
  return <main style={{padding:24,maxWidth:1500,margin:'0 auto'}}><h1>Pi live automation zones</h1><p>The Raspberry Pi supplies its exact scan snapshot; this PC renders the chart.</p><div style={{display:'flex',gap:12,alignItems:'center',marginBottom:16}}><select value={pair} onChange={e=>setPair(e.target.value)}>{forexPairs.map(p=><option key={p}>{p}</option>)}</select><select value={timeframe} onChange={e=>setTimeframe(e.target.value as 'M5'|'M15')}><option>M15</option><option>M5</option></select><span style={{color:error?'#ff8d98':'#69e69a'}}>{error?'Pi connection unavailable':'Connected to Pi'}</span>{error&&<button type="button" onClick={()=>location.reload()}>Reconnect</button>}</div>{error&&<p style={{color:'#ff8d98'}}>{error}</p>}{snapshot&&<><p>{snapshot.trend.toUpperCase()} · {snapshot.zones.length} active base zone(s) · {snapshot.confirmationCount} actionable confirmation(s) · scanned {new Date(snapshot.scannedAt).toLocaleString()}</p><StrategyLabChart direction={snapshot.trend==='bearish'?'bearish':'bullish'} timeframe={timeframe} drawingStorageKey={`pi-${pair}-${timeframe}`} scenario={{candles,leg,zones:snapshot.zones}} /></>}</main>
}
