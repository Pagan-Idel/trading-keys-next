import {useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/router';
import StrategyLabChart from '../StrategyLabChart';
import {forexPairs} from '../../utils/constants';
import type {GoldilocksZone,StrategyCandle,SwingLeg} from '../../utils/goldilocksStrategy';
import type {GoldilocksApproachPressure} from '../../utils/approachPressure';
import {buildGoldilocksZoneChartEvidence,type GoldilocksZoneChartEvidence} from '../../utils/goldilocksScanner';
import {GOLDILOCKS_TIMEFRAME_SECONDS} from '../../utils/goldilocksConfig';
import {determineSwingPoints} from '../../utils/swingLabeler';

type Setup={zone:GoldilocksZone;touchCandle:StrategyCandle;confirmationCandle:StrategyCandle;approachPressure?:GoldilocksApproachPressure};
type ActiveTrade={tradeId:string;direction:'BUY'|'SELL';entry:number;stopLoss?:number;takeProfit?:number;openedAt?:string;score?:number;riskProfile?:string;riskPercentage?:number};
type Snapshot={pair:string;scannedAt:string;trend:'bullish'|'bearish'|'unknown';zoneTimeframe?:string;confirmationTimeframe?:string;confirmationMode?:'close-through'|'touch-entry';minimumScore?:number;zones:GoldilocksZone[];zoneEvidence?:GoldilocksZoneChartEvidence[];candles:Record<string,StrategyCandle[]>;confirmationCount:number;setups?:Setup[];activeTrade?:ActiveTrade};
type ArchiveBounds={startTime:number|null;endTime:number|null;candleCount:number};
type CandlePage={candles:StrategyCandle[];bounds:ArchiveBounds;hasOlder:boolean;hasNewer:boolean;error?:string};
const mergeCandles=(...groups:StrategyCandle[][])=>Array.from(new Map(groups.flat().map(candle=>[candle.time,candle])).values()).sort((a,b)=>a.time-b.time);
export default function PiZonesDashboard(){
  const router=useRouter();
  const [pair,setPair]=useState('AUD/USD'),[timeframe,setTimeframe]=useState<'M1'|'M5'|'M15'|'H1'>('M15');
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState('');
  const [scannedAt,setScannedAt]=useState('');
  const [historyCandles,setHistoryCandles]=useState<Record<string,StrategyCandle[]>>({});
  const [archiveBounds,setArchiveBounds]=useState<Record<string,ArchiveBounds>>({});
  const [historyError,setHistoryError]=useState('');
  const [annotationScope,setAnnotationScope]=useState<'focus'|'all'>('focus');
  const chartSignatureRef=useRef('');
  useEffect(()=>{const params=new URLSearchParams(window.location.search);const requestedPair=typeof router.query.pair==='string'?router.query.pair:params.get('pair');const requestedTimeframe=typeof router.query.timeframe==='string'?router.query.timeframe:params.get('timeframe');if(requestedPair&&forexPairs.includes(requestedPair))setPair(requestedPair);if(['M1','M5','M15','H1'].includes(requestedTimeframe??'')&&snapshot?.candles[requestedTimeframe!]?.length)setTimeframe(requestedTimeframe as 'M1'|'M5'|'M15'|'H1')},[router.isReady,router.query.pair,router.query.timeframe,snapshot]);
  const preserveChartLocation=(nextPair=pair,nextTimeframe=timeframe)=>{void router.replace({pathname:'/automation',query:{...router.query,tab:'zones',pair:nextPair,timeframe:nextTimeframe}},undefined,{shallow:true,scroll:false})};
  useEffect(()=>{setHistoryCandles({});setArchiveBounds({});setHistoryError('');setAnnotationScope('focus')},[pair]);
  useEffect(()=>{let active=true;chartSignatureRef.current='';const load=async()=>{try{const r=await fetch(`/api/automation/pi-zones?pair=${encodeURIComponent(pair)}`,{cache:'no-store'});const p=await r.json() as Snapshot&{error?:string};if(!r.ok)throw new Error(p.error);if(active){const signature=JSON.stringify({pair:p.pair,trend:p.trend,zones:p.zones,zoneEvidence:p.zoneEvidence,candles:p.candles,setups:p.setups,activeTrade:p.activeTrade});if(signature!==chartSignatureRef.current){chartSignatureRef.current=signature;setSnapshot(p)}setScannedAt(p.scannedAt);setError('')}}catch(e){if(active)setError(e instanceof Error?e.message:String(e))}};void load();const timer=setInterval(load,3000);return()=>{active=false;clearInterval(timer)}},[pair]);
  const latestSnapshotCandleTime=snapshot?.candles[timeframe]?.at(-1)?.time;
  useEffect(()=>{let active=true;const loadBounds=async()=>{try{const response=await fetch(`/api/automation/pi-zone-candles?pair=${encodeURIComponent(pair)}&timeframe=${timeframe}`,{cache:'no-store'});const page=await response.json() as CandlePage;if(!response.ok)throw new Error(page.error);if(active)setArchiveBounds(items=>({...items,[timeframe]:page.bounds}))}catch(requestError){if(active)setHistoryError(requestError instanceof Error?requestError.message:String(requestError))}};void loadBounds();return()=>{active=false}},[latestSnapshotCandleTime,pair,timeframe]);
  const candles=useMemo(()=>mergeCandles(snapshot?.candles[timeframe]??[],historyCandles[timeframe]??[]),[historyCandles,snapshot,timeframe]);
  const bounds=archiveBounds[timeframe];
  const hasOlder=Boolean(bounds?.startTime!==null&&candles.length&&bounds!.startTime!<candles[0].time);
  const hasNewer=Boolean(bounds?.endTime!==null&&candles.length&&bounds!.endTime!>candles.at(-1)!.time);
  const loadHistory=async(side:'older'|'newer')=>{
    const edge=side==='older'?candles[0]?.time:candles.at(-1)?.time;
    if(edge===undefined)return;
    setHistoryError('');
    try{
      const response=await fetch(`/api/automation/pi-zone-candles?pair=${encodeURIComponent(pair)}&timeframe=${timeframe}&${side==='older'?'before':'after'}=${edge}`,{cache:'no-store'});
      const page=await response.json() as CandlePage;
      if(!response.ok)throw new Error(page.error);
      setHistoryCandles(items=>({...items,[timeframe]:mergeCandles(items[timeframe]??[],page.candles)}));
      setArchiveBounds(items=>({...items,[timeframe]:page.bounds}));
    }catch(requestError){setHistoryError(requestError instanceof Error?requestError.message:String(requestError))}
  };
  const swings=useMemo(()=>determineSwingPoints(candles.map((candle,candleIndex)=>({...candle,time:new Date(candle.time*1000).toISOString(),candleIndex})))
    .filter(swing=>['HH','HL','LH','LL'].includes(swing.swing))
    .map(swing=>({...swing,swing:swing.swing as 'HH'|'HL'|'LH'|'LL',time:candles[swing.candleIndex]?.time??0})),[candles]);
  const leg=useMemo<SwingLeg>(()=>({direction:snapshot?.trend==='bearish'?'bearish':'bullish',startIndex:0,endIndex:Math.max(0,candles.length-1),startPrice:candles[0]?.close??0,endPrice:candles.at(-1)?.close??0,range:Math.abs((candles.at(-1)?.close??0)-(candles[0]?.close??0)),startSwing:'L',endSwing:'H'}),[candles,snapshot?.trend]);
  const zoneEvidence=useMemo(()=>{
    if(!snapshot)return [];
    if(snapshot.zoneEvidence?.length)return snapshot.zoneEvidence;
    const zoneTimeframe=snapshot.zoneTimeframe??'M15';
    const confirmationTimeframe=snapshot.confirmationTimeframe??'M5';
    const zoneCandles=snapshot.candles[zoneTimeframe]??[];
    const confirmationCandles=snapshot.candles[confirmationTimeframe]??[];
    return buildGoldilocksZoneChartEvidence({
      history:{zones:snapshot.zones,activeZones:snapshot.zones,
        activeDemand:snapshot.zones.filter(zone=>zone.side==='demand').at(-1),
        activeSupply:snapshot.zones.filter(zone=>zone.side==='supply').at(-1)},
      zoneCandles,zoneSeconds:GOLDILOCKS_TIMEFRAME_SECONDS[zoneTimeframe]??300,zoneTimeframe,
      confirmationCandles,confirmationSeconds:GOLDILOCKS_TIMEFRAME_SECONDS[confirmationTimeframe]??60,confirmationTimeframe,
      completedBefore:Number.POSITIVE_INFINITY,
    });
  },[snapshot]);
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
  const focus=useMemo(()=>{
    if(!snapshot)return null;
    const confirmationTimeframe=snapshot.confirmationTimeframe??'M1';
    const confirmationCandles=snapshot.candles[confirmationTimeframe]??[];
    const latest=confirmationCandles.at(-1);
    const candidates=snapshot.zones.map(zone=>{
      const evidence=zoneEvidence.find(item=>item.zoneId===zone.id);
      const lastTouchTime=evidence?.priorTouchDetails.at(-1)?.time;
      const lastTouch=lastTouchTime===undefined?undefined:confirmationCandles.find(candle=>candle.time===lastTouchTime);
      const distance=latest?latest.close<zone.low?zone.low-latest.close:latest.close>zone.high?latest.close-zone.high:0:Number.POSITIVE_INFINITY;
      return {zone,lastTouch,distance};
    }).sort((a,b)=>(b.lastTouch?.time??0)-(a.lastTouch?.time??0)||a.distance-b.distance);
    return {...candidates[0],latest,confirmationTimeframe};
  },[snapshot,zoneEvidence]);
  const focusedZoneEvidence=useMemo(()=>{
    const zoneId=tradeSetup?.zone.id??focus?.zone.id;
    return zoneId?zoneEvidence.filter(evidence=>evidence.zoneId===zoneId):[];
  },[focus?.zone.id,tradeSetup?.zone.id,zoneEvidence]);
  const activeZoneEvidence=useMemo(()=>{const ids=new Set(snapshot?.zones.map(zone=>zone.id)??[]);return zoneEvidence.filter(evidence=>ids.has(evidence.zoneId))},[snapshot?.zones,zoneEvidence]);
  const displayedZoneEvidence=annotationScope==='all'?activeZoneEvidence:focusedZoneEvidence;
  const scenario=useMemo(()=>snapshot?{candles,timeframe,isLiveAutomation:true,leg,swings,zones:snapshot.zones,zoneEvidence:displayedZoneEvidence,tradeSetup,tradeSetups}:undefined,[candles,displayedZoneEvidence,leg,snapshot,swings,timeframe,tradeSetup,tradeSetups]);
  const precision=pair.endsWith('/JPY')?3:5;
  return <section>
    <div style={{display:'flex',gap:10,alignItems:'center',justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',padding:'10px 12px',border:'1px solid #29313d',borderRadius:12,background:'linear-gradient(135deg,#111820,#0d1117)'}}>
      <div><div style={{color:'#7f8b9c',fontSize:11,fontWeight:850,textTransform:'uppercase',letterSpacing:'.1em'}}>Pi automation monitor</div><div style={{color:'#f4f7fb',fontSize:23,fontWeight:950,lineHeight:1.15}}>{pair}</div></div>
      <label style={{display:'flex',alignItems:'center',gap:10,color:'#8793a5',fontSize:12,fontWeight:800,textTransform:'uppercase',letterSpacing:'.08em'}}>
        Change pair
        <span style={{position:'relative',display:'inline-flex',alignItems:'center'}}>
          <select aria-label="Pi automation pair" value={pair} onChange={e=>{setPair(e.target.value);preserveChartLocation(e.target.value,timeframe)}} style={{appearance:'none',WebkitAppearance:'none',minWidth:132,border:'1px solid #3a4656',borderRadius:9,background:'#171d25',color:'#f4f7fb',padding:'9px 34px 9px 12px',fontSize:14,fontWeight:850,outline:'none',cursor:'pointer'}}>{forexPairs.map(p=><option key={p}>{p}</option>)}</select>
          <span aria-hidden style={{position:'absolute',right:12,color:'#79eda2',fontSize:11,pointerEvents:'none'}}>▼</span>
        </span>
      </label>
      <span style={{display:'inline-flex',alignItems:'center',gap:7,border:`1px solid ${error?'#69323b':'#285b3a'}`,borderRadius:999,background:error?'rgba(104,32,43,.22)':'rgba(31,111,59,.18)',color:error?'#ff8d98':'#79eda2',padding:'7px 10px',fontSize:12,fontWeight:800}}><span style={{width:7,height:7,borderRadius:'50%',background:'currentColor',boxShadow:error?'none':'0 0 10px #58e78a'}}/>{error?'Pi unavailable':'Pi connected'}</span>
      {error&&<button type="button" onClick={()=>location.reload()}>Reconnect</button>}
    </div>
    {error&&<p style={{color:'#ff8d98'}}>{error}</p>}
    {snapshot&&<>
      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',margin:'0 0 12px'}}>
        <span style={{border:'1px solid #34404e',borderRadius:999,background:'#161c24',color:'#d5dbe5',padding:'6px 10px',fontSize:12,fontWeight:800}}>{snapshot.zones.length} active base zone{snapshot.zones.length===1?'':'s'}</span>
        <span style={{border:'1px solid #34404e',borderRadius:999,background:'#161c24',color:snapshot.confirmationCount?'#ffd66b':'#8d98a8',padding:'6px 10px',fontSize:12,fontWeight:800}}>{snapshot.confirmationCount} actionable setup{snapshot.confirmationCount===1?'':'s'}</span>
        {active&&<span style={{border:'1px solid #34784c',borderRadius:999,background:'rgba(32,112,58,.22)',color:'#7af0a1',padding:'6px 10px',fontSize:12,fontWeight:850}}>Active {active.direction} trade</span>}
        <span role="group" aria-label="Zone annotation scope" style={{display:'inline-flex',gap:3,border:'1px solid #34404e',borderRadius:999,padding:3,background:'#111820'}}>
          <button type="button" aria-pressed={annotationScope==='focus'} onClick={()=>setAnnotationScope('focus')} style={{border:0,borderRadius:999,padding:'4px 8px',background:annotationScope==='focus'?'#30405a':'transparent',color:annotationScope==='focus'?'#fff':'#8d98a8',fontSize:11,fontWeight:800,cursor:'pointer'}}>Focus evidence</button>
          <button type="button" aria-pressed={annotationScope==='all'} onClick={()=>setAnnotationScope('all')} style={{border:0,borderRadius:999,padding:'4px 8px',background:annotationScope==='all'?'#30405a':'transparent',color:annotationScope==='all'?'#fff':'#8d98a8',fontSize:11,fontWeight:800,cursor:'pointer'}}>All active evidence</button>
        </span>
        <span style={{marginLeft:'auto',color:'#697587',fontSize:11}}>Pi scan {new Date(scannedAt||snapshot.scannedAt).toLocaleTimeString()}</span>
      </div>
      {historyError&&<p role="alert" style={{color:'#ff9aa4',fontSize:12,margin:'-4px 0 10px'}}>Chart history: {historyError}</p>}
      {focus&&<div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:1,overflow:'hidden',margin:'0 0 12px',border:'1px solid #303a47',borderRadius:12,background:'#303a47'}}>
        <div style={{padding:'12px 14px',background:'#111820'}}><small style={{color:'#7d899a',fontWeight:800}}>PAIR + STRUCTURE</small><div style={{marginTop:4,fontWeight:900,color:'#f4f7fb'}}>{pair} · {snapshot.zoneTimeframe??'M15'} {snapshot.trend}</div></div>
        <div style={{padding:'12px 14px',background:'#111820'}}><small style={{color:'#7d899a',fontWeight:800}}>FOCUS BASE</small><div style={{marginTop:4,fontWeight:900,color:focus.zone.side==='demand'?'#55e6c1':'#ff8794'}}>{focus.zone.side.toUpperCase()} {focus.zone.low.toFixed(precision)}–{focus.zone.high.toFixed(precision)}</div></div>
        <div style={{padding:'12px 14px',background:'#111820'}}><small style={{color:'#7d899a',fontWeight:800}}>ENTRY RULE</small><div style={{marginTop:4,fontWeight:900,color:'#f4f7fb'}}>{focus.confirmationTimeframe} {snapshot.confirmationMode==='touch-entry'?'immediate touch':'close-through'}{snapshot.minimumScore!==undefined?` · ${snapshot.minimumScore}/20 min`:''}</div></div>
      </div>}
      <StrategyLabChart direction={snapshot.trend==='bearish'?'bearish':'bullish'} timeframe={timeframe} availableTimeframes={Object.entries(snapshot.candles).filter(([,items])=>items.length>0).map(([item])=>item as 'M1'|'M5'|'M15'|'H1')} hasOlder={hasOlder} hasNewer={hasNewer} enableJumpToLive onLoadOlder={()=>loadHistory('older')} onLoadNewer={()=>loadHistory('newer')} onTimeframeChange={next=>{setTimeframe(next);preserveChartLocation(pair,next)}} drawingStorageKey={`pi-${pair}-${timeframe}`} tradeId={active?.tradeId} pricePrecision={pair.endsWith('/JPY')?3:5} scenario={scenario} />
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
