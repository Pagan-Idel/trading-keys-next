import {useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/router';
import StrategyLabChart from '../StrategyLabChart';
import {forexPairs} from '../../utils/constants';
import type {GoldilocksZone,StrategyCandle,SwingLeg} from '../../utils/goldilocksStrategy';
import type {GoldilocksApproachPressure} from '../../utils/approachPressure';

type Setup={zone:GoldilocksZone;touchCandle:StrategyCandle;confirmationCandle:StrategyCandle;approachPressure?:GoldilocksApproachPressure};
type ActiveTrade={tradeId:string;direction:'BUY'|'SELL';entry:number;stopLoss?:number;takeProfit?:number;openedAt?:string;score?:number;riskProfile?:string;riskPercentage?:number};
type Snapshot={pair:string;scannedAt:string;trend:'bullish'|'bearish'|'unknown';zones:GoldilocksZone[];candles:Record<string,StrategyCandle[]>;confirmationCount:number;setups?:Setup[];activeTrade?:ActiveTrade};
export default function PiZonesDashboard(){
  const router=useRouter();
  const [pair,setPair]=useState('AUD/USD'),[timeframe,setTimeframe]=useState<'M1'|'M5'|'M15'|'H1'>('M15');
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState('');
  const [scannedAt,setScannedAt]=useState('');
  const chartSignatureRef=useRef('');
  useEffect(()=>{if(typeof router.query.pair==='string'&&forexPairs.includes(router.query.pair))setPair(router.query.pair)},[router.query.pair]);
  useEffect(()=>{let active=true;chartSignatureRef.current='';const load=async()=>{try{const r=await fetch(`/api/automation/pi-zones?pair=${encodeURIComponent(pair)}`,{cache:'no-store'});const p=await r.json() as Snapshot&{error?:string};if(!r.ok)throw new Error(p.error);if(active){const signature=JSON.stringify({pair:p.pair,trend:p.trend,zones:p.zones,candles:p.candles,setups:p.setups,activeTrade:p.activeTrade});if(signature!==chartSignatureRef.current){chartSignatureRef.current=signature;setSnapshot(p)}setScannedAt(p.scannedAt);setError('')}}catch(e){if(active)setError(e instanceof Error?e.message:String(e))}};void load();const timer=setInterval(load,3000);return()=>{active=false;clearInterval(timer)}},[pair]);
  const candles=useMemo(()=>snapshot?.candles[timeframe]??[],[snapshot,timeframe]);
  const leg=useMemo<SwingLeg>(()=>({direction:snapshot?.trend==='bearish'?'bearish':'bullish',startIndex:0,endIndex:Math.max(0,candles.length-1),startPrice:candles[0]?.close??0,endPrice:candles.at(-1)?.close??0,range:Math.abs((candles.at(-1)?.close??0)-(candles[0]?.close??0)),startSwing:'L',endSwing:'H'}),[candles,snapshot?.trend]);
  const active=snapshot?.activeTrade;
  const tradeSetups=useMemo(()=>{
    const source=snapshot?.setups??[];
    return source.map((setup,index)=>{
      const focused=index===source.length-1;
      const entry=focused&&active?.entry!==undefined?active.entry:setup.confirmationCandle.close;
      const stop=focused&&active?.stopLoss!==undefined?active.stopLoss:(setup.zone.side==='demand'?setup.zone.low:setup.zone.high);
      const risk=Math.abs(entry-stop);
      return {
        tradeId:focused?active?.tradeId:undefined,
        zone:setup.zone,
        confirmationTimeframe:'M5' as const,
        confirmationTime:setup.confirmationCandle.time,
        confirmationCandle:setup.confirmationCandle,
        touchCandle:setup.touchCandle,
        approachPressure:setup.approachPressure,
        outcome:'open' as const,
        runway:{
          allowed:true,
          direction:setup.zone.side==='demand'?'buy' as const:'sell' as const,
          entry,
          stopLoss:stop,
          takeProfit:focused&&active?.takeProfit!==undefined?active.takeProfit:(setup.zone.side==='demand'?entry+risk*2:entry-risk*2),
          risk,
          reward:risk*2,
          availableReward:Number.POSITIVE_INFINITY,
          availableRatio:Number.POSITIVE_INFINITY,
          ratio:2,
          reason:focused&&active?'Current broker trade geometry.':'Actionable Pi setup geometry.',
        },
      };
    });
  },[active,snapshot?.setups]);
  const tradeSetup=tradeSetups.at(-1)??null;
  const setup=snapshot?.setups?.at(-1);
  const scenario=useMemo(()=>snapshot?{candles,timeframe,leg,zones:snapshot.zones,tradeSetup,tradeSetups}:undefined,[candles,leg,snapshot,timeframe,tradeSetup,tradeSetups]);
  return <section>
    <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:16,flexWrap:'wrap'}}>
      <select aria-label="Pi automation pair" value={pair} onChange={e=>setPair(e.target.value)}>{forexPairs.map(p=><option key={p}>{p}</option>)}</select>
      <span style={{color:error?'#ff8d98':'#69e69a'}}>{error?'Pi connection unavailable':'Connected to Pi'}</span>
      {error&&<button type="button" onClick={()=>location.reload()}>Reconnect</button>}
    </div>
    {error&&<p style={{color:'#ff8d98'}}>{error}</p>}
    {snapshot&&<>
      <p>{snapshot.trend.toUpperCase()} · {snapshot.zones.length} active base zone(s) · {snapshot.confirmationCount} actionable confirmation(s) · {active?`ACTIVE ${active.direction} TRADE · `:''}Pi scan {new Date(scannedAt||snapshot.scannedAt).toLocaleString()}</p>
      <StrategyLabChart direction={snapshot.trend==='bearish'?'bearish':'bullish'} timeframe={timeframe} onTimeframeChange={setTimeframe} drawingStorageKey={`pi-${pair}-${timeframe}`} tradeId={active?.tradeId} pricePrecision={pair.endsWith('/JPY')?3:5} scenario={scenario} />
      {(active||setup)&&<details style={{marginTop:14,border:'1px solid #303846',borderRadius:12,padding:'12px 14px',background:'#11151b'}} open={Boolean(active)}>
        <summary style={{cursor:'pointer',fontWeight:800}}>{active?'Active Pi trade details':'Latest actionable setup details'}</summary>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10,marginTop:12,color:'#cbd3df'}}>
          {active?.tradeId&&<span><b>Trade ID</b><br/>{active.tradeId}</span>}
          <span><b>Direction</b><br/>{active?.direction??(setup?.zone.side==='demand'?'BUY':'SELL')}</span>
          <span><b>Entry</b><br/>{tradeSetup?.runway.entry.toFixed(pair.endsWith('/JPY')?3:5)}</span>
          <span><b>Stop</b><br/>{tradeSetup?.runway.stopLoss.toFixed(pair.endsWith('/JPY')?3:5)}</span>
          <span><b>Target</b><br/>{tradeSetup?.runway.takeProfit.toFixed(pair.endsWith('/JPY')?3:5)}</span>
          {active?.score!==undefined&&<span><b>Score</b><br/>{active.score}/20</span>}
          {active?.riskPercentage!==undefined&&<span><b>Account risk</b><br/>{active.riskPercentage}% · {active.riskProfile}</span>}
          {active?.openedAt&&<span><b>Opened</b><br/>{new Date(active.openedAt).toLocaleString()}</span>}
          {setup&&<>
            <span><b>Zone</b><br/>{setup.zone.side.toUpperCase()} · {setup.zone.low}–{setup.zone.high}</span>
            <span><b>Touch / confirmation</b><br/>{new Date(setup.touchCandle.time*1000).toLocaleString()}<br/>{new Date(setup.confirmationCandle.time*1000).toLocaleString()}</span>
            <span><b>Approach warnings</b><br/>{setup.approachPressure?.adversePressureFlags.length??0} · sweeps {setup.approachPressure?.liquiditySweepTimes?.length??0}</span>
          </>}
        </div>
      </details>}
    </>}
  </section>
}
