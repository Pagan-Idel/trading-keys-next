import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';

type EventRow = { id: number; createdAt: string; level: string; pair?: string; step?: string; message: string };
type WorkerRow = { pair: string; state: string; step: string; message: string };
type DashboardData = { events: EventRow[]; workers: WorkerRow[] };

const Shell=styled.section`width:100%;border:1px solid #292e38;border-radius:20px;overflow:hidden;background:linear-gradient(160deg,#14171d,#0d0f13);color:#e6e9ef;`;
const Header=styled.div`display:flex;justify-content:space-between;gap:12px;align-items:center;padding:15px 17px;border-bottom:1px solid #292e38;`;
const Title=styled.h2`font-size:.95rem;margin:0;`;
const Status=styled.span`color:#738092;font-size:.7rem;`;
const Filters=styled.div`display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 14px;border-bottom:1px solid #292e38;@media(max-width:620px){grid-template-columns:1fr}`;
const Select=styled.select`min-width:0;border:1px solid #303642;background:#171b22;color:#cfd5df;border-radius:9px;padding:8px 9px;font-size:.72rem;`;
const Feed=styled.div`max-height:390px;overflow:auto;`;
const Row=styled.div`display:grid;grid-template-columns:9px 66px minmax(0,1fr);gap:10px;padding:11px 15px;border-bottom:1px solid #252a33;`;
const Dot=styled.span<{level:string}>`width:8px;height:8px;border-radius:50%;margin-top:4px;background:${({level})=>level==='error'?'#ff5b68':level==='warn'?'#ffbd57':'#58e990'};`;
const Time=styled.time`font-size:.68rem;color:#6f7a8b;`;
const Message=styled.div`font-size:.76rem;line-height:1.4;min-width:0;`;
const Tag=styled.span<{$manager?:boolean}>`display:inline-block;margin-right:6px;padding:2px 5px;border-radius:5px;background:${({$manager})=>$manager?'rgba(27,112,72,.22)':'#192044'};border:1px solid ${({$manager})=>$manager?'#28764f':'#303b70'};color:${({$manager})=>$manager?'#75f2a7':'#aeb8ff'};font-size:.62rem;font-weight:800;`;
const Empty=styled.div`padding:30px 16px;text-align:center;color:#737d8d;font-size:.76rem;`;

export default function AutomationCandyLog(){
  const [data,setData]=useState<DashboardData|null>(null);
  const [selectedPair,setSelectedPair]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;const refresh=async()=>{try{const response=await fetch('/api/automation/dashboard?eventLimit=100',{cache:'no-store'});if(!response.ok)throw new Error('Telemetry unavailable');const next=await response.json();if(active){setData(next);setError('')}}catch(requestError){if(active)setError((requestError as Error).message)}};refresh();const timer=window.setInterval(refresh,5000);return()=>{active=false;window.clearInterval(timer)}},[]);
  const activeWorkers=useMemo(()=>(data?.workers??[]).filter(worker=>!['paused','stopped','error'].includes(worker.state)),[data]);
  const inactiveWorkers=useMemo(()=>(data?.workers??[]).filter(worker=>['paused','stopped','error'].includes(worker.state)),[data]);
  const events=useMemo(()=>[...(data?.events??[])].filter(event=>!selectedPair||event.pair===selectedPair).sort((a,b)=>b.id-a.id),[data,selectedPair]);
  return <Shell><Header><Title>Automation candylog</Title><Status>Newest first · refreshes every 5 seconds</Status></Header><Filters>
    <Select aria-label="Filter active automation workers" value={activeWorkers.some(worker=>worker.pair===selectedPair)?selectedPair:''} onChange={event=>setSelectedPair(event.target.value)}><option value="">Active workers ({activeWorkers.length})</option>{activeWorkers.map(worker=><option key={worker.pair} value={worker.pair}>{worker.pair} — {worker.step.replaceAll('_',' ')}</option>)}</Select>
    <Select aria-label="Filter inactive automation workers" value={inactiveWorkers.some(worker=>worker.pair===selectedPair)?selectedPair:''} onChange={event=>setSelectedPair(event.target.value)}><option value="">Inactive workers ({inactiveWorkers.length})</option>{inactiveWorkers.map(worker=><option key={worker.pair} value={worker.pair}>{worker.pair} — {worker.message}</option>)}</Select>
  </Filters><Feed>{events.length?events.map(event=>{const manager=event.step?.startsWith('trade_manager_')??false;return <Row key={event.id}><Dot level={event.level}/><Time>{new Date(event.createdAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'})}</Time><Message>{event.pair&&<Tag $manager={manager}>{event.pair}</Tag>}{event.step&&<Tag $manager={manager}>{event.step.replaceAll('_',' ')}</Tag>}{event.message}</Message></Row>}):<Empty>{error||'No automation events to show yet.'}</Empty>}</Feed></Shell>;
}
