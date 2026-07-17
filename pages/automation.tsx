import { useCallback, useEffect, useMemo, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { forexPairs } from '../utils/constants';

type EventRow = { id: number; createdAt: string; level: 'debug' | 'info' | 'warn' | 'error'; pair?: string; source?: string; step?: string; message: string };
type WorkerRow = { pair: string; state: string; step: string; message: string; mode: 'live' | 'demo'; pid: number; updatedAt: string };
type TradeRow = { tradeId: string; pair: string; direction: 'BUY' | 'SELL'; entry: number; stopLoss: number; takeProfit: number; outcome: 'WIN' | 'LOSS'; realizedPL: number | null; mode: 'live' | 'demo'; openedAt?: string; closedAt: string };
type ActiveTradeRow = { tradeId: string; pair: string; direction: 'BUY' | 'SELL'; entry: number; stopLoss: number|null; takeProfit: number|null; mode: 'live'|'demo'; openedAt: string; updatedAt: string };
type DashboardData = { events: EventRow[]; workers: WorkerRow[]; trades: TradeRow[]; activeTrades: ActiveTradeRow[]; summary: { total: number; wins: number; losses: number; realizedPL: number }; generatedAt: string };
type RuntimeData = { running: boolean; pid: number | null; mode: 'demo' | null; startedAt: string | null };

const glow = keyframes`0%,100%{opacity:.45;transform:scale(.92)}50%{opacity:1;transform:scale(1.08)}`;
const Page = styled.div`width:min(1420px,calc(100% - 32px));margin:0 auto 64px;color:#f7f7fb;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;`;
const Hero = styled.section`border:1px solid #2b303b;border-radius:24px;padding:24px;background:radial-gradient(circle at 8% 0%,rgba(0,200,83,.16),transparent 32%),radial-gradient(circle at 95% 20%,rgba(76,120,255,.18),transparent 35%),linear-gradient(145deg,#171a20,#0c0e12);box-shadow:0 24px 80px rgba(0,0,0,.38);`;
const HeroTop = styled.div`display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;`;
const Eyebrow = styled.div`color:#65ff9d;font-size:.75rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase;`;
const Title = styled.h1`margin:7px 0 5px;font-size:clamp(1.8rem,4vw,3.3rem);line-height:1;letter-spacing:-.05em;`;
const Subtitle = styled.p`color:#9aa3b2;margin:0;max-width:680px;`;
const LiveBadge = styled.div`display:flex;align-items:center;gap:9px;border:1px solid #294a36;background:rgba(16,55,30,.58);color:#8bffb4;border-radius:999px;padding:9px 14px;font-weight:750;font-size:.82rem;`;
const RuntimeControls = styled.div`display:flex;align-items:center;gap:9px;flex-wrap:wrap;justify-content:flex-end;`;
const RuntimeButton = styled.button<{running?:boolean}>`border:1px solid ${({running})=>running?'#71333d':'#2c7544'};background:${({running})=>running?'#35151b':'#12321d'};color:${({running})=>running?'#ff8590':'#7dffa7'};border-radius:11px;padding:10px 14px;cursor:pointer;font-size:.78rem;font-weight:800;&:disabled{opacity:.45;cursor:wait}`;
const Dot = styled.span`width:9px;height:9px;border-radius:50%;background:#39ff7d;box-shadow:0 0 16px #39ff7d;animation:${glow} 1.7s ease-in-out infinite;`;
const Stats = styled.div`display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:24px;@media(max-width:760px){grid-template-columns:repeat(2,1fr)}`;
const Stat = styled.div`border:1px solid #292e38;background:rgba(10,12,16,.72);border-radius:16px;padding:15px;`;
const StatLabel = styled.div`color:#818a99;font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;font-weight:700;`;
const StatValue = styled.div<{tone?:'good'|'bad'}>`margin-top:7px;font-size:1.65rem;font-weight:850;color:${({tone})=>tone==='good'?'#53f58c':tone==='bad'?'#ff6675':'#fff'};`;
const Layout = styled.div`display:grid;grid-template-columns:minmax(0,1.35fr) minmax(360px,.65fr);gap:18px;margin-top:18px;@media(max-width:1020px){grid-template-columns:1fr}`;
const Card = styled.section`border:1px solid #292e38;border-radius:20px;background:linear-gradient(160deg,#14171d,#0d0f13);overflow:hidden;`;
const CardHeader = styled.div`display:flex;align-items:center;justify-content:space-between;padding:17px 19px;border-bottom:1px solid #292e38;`;
const CardTitle = styled.h2`margin:0;font-size:.95rem;letter-spacing:.01em;`;
const Muted = styled.span`color:#747e8e;font-size:.76rem;`;
const Feed = styled.div`max-height:590px;overflow:auto;`;
const Event = styled.div`display:grid;grid-template-columns:12px 68px minmax(0,1fr);gap:11px;padding:12px 18px;border-bottom:1px solid rgba(44,49,59,.7);&:hover{background:rgba(255,255,255,.025)}`;
const EventDot = styled.span<{level:EventRow['level']}>`width:9px;height:9px;margin-top:5px;border-radius:50%;background:${({level})=>level==='error'?'#ff5063':level==='warn'?'#ffba49':level==='debug'?'#7d86a0':'#55e88b'};`;
const Time = styled.time`color:#697384;font-size:.72rem;padding-top:2px;`;
const EventMessage = styled.div`min-width:0;font-size:.82rem;line-height:1.45;color:#d9dce3;`;
const Tag = styled.span<{$manager?:boolean}>`display:inline-block;color:${({$manager})=>$manager?'#75f2a7':'#aeb8ff'};background:${({$manager})=>$manager?'rgba(27,112,72,.22)':'rgba(94,112,255,.12)'};border:1px solid ${({$manager})=>$manager?'#28764f':'rgba(107,124,255,.2)'};border-radius:6px;padding:2px 6px;margin-right:7px;font-size:.68rem;font-weight:800;`;
const WorkerGrid = styled.div`display:grid;gap:10px;padding:13px;`;
const Worker = styled.div`border:1px solid #2c323d;background:#11141a;border-radius:14px;padding:13px;`;
const WorkerTop = styled.div`display:flex;justify-content:space-between;align-items:center;`;
const Pair = styled.strong`font-size:.9rem;`;
const State = styled.span<{state:string}>`color:${({state})=>state==='error'?'#ff6c78':state==='in_trade'?'#69a7ff':state==='paused'?'#ffbd59':'#66ef96'};font-size:.66rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase;`;
const WorkerStep = styled.div`margin-top:9px;color:#eef0f5;font-size:.78rem;font-weight:700;text-transform:capitalize;`;
const WorkerMessage = styled.div`color:#7f8999;font-size:.72rem;margin-top:4px;`;
const TableCard = styled(Card)`margin-top:18px;`;
const TableScroll = styled.div`overflow-x:auto;`;
const Table = styled.table`width:100%;border-collapse:collapse;min-width:880px;th,td{padding:13px 18px;text-align:left;border-bottom:1px solid #252a33}th{color:#747e8e;font-size:.67rem;text-transform:uppercase;letter-spacing:.08em}td{color:#cbd0d9;font-size:.78rem}`;
const Result = styled.span<{result:'WIN'|'LOSS'}>`color:${({result})=>result==='WIN'?'#58ee8d':'#ff6876'};font-weight:850;`;
const Empty = styled.div`color:#6f7888;padding:38px 20px;text-align:center;font-size:.82rem;`;
const Filters = styled.div`display:grid;grid-template-columns:1fr 1fr;gap:9px;padding:12px 16px;border-bottom:1px solid #292e38;background:#101318;@media(max-width:620px){grid-template-columns:1fr}`;
const FilterSelect = styled.select`width:100%;border:1px solid #303642;background:#171b22;color:#cfd5df;border-radius:9px;padding:9px 10px;font-size:.75rem;outline:none;&:focus{border-color:#4d8d62}`;
const Tabs = styled.div`display:flex;gap:8px;margin:18px 0 0;`;
const Tab = styled.button<{active:boolean}>`border:1px solid ${({active})=>active?'#376548':'#292e38'};background:${({active})=>'#112c1b'};background:${({active})=>active?'#112c1b':'#12151a'};color:${({active})=>active?'#74f9a1':'#8a93a1'};border-radius:11px;padding:10px 14px;font-weight:800;font-size:.78rem;cursor:pointer;`;
const PositionStatus = styled.span<{open:boolean}>`display:inline-flex;align-items:center;gap:7px;color:${({open})=>open?'#61f493':'#747d8b'};font-weight:850;&:before{content:'';width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:${({open})=>open?'0 0 12px #55ef88':'none'}}`;

const formatTime=(value?:string)=>value?new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'}):'—';
const formatDate=(value?:string)=>value?new Date(value).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';

export default function AutomationDashboard(){
  const [data,setData]=useState<DashboardData|null>(null);
  const [runtime,setRuntime]=useState<RuntimeData|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [changingRuntime,setChangingRuntime]=useState(false);
  const [activeTab,setActiveTab]=useState<'activity'|'positions'>('activity');
  const [selectedPair,setSelectedPair]=useState('');
  const refresh=useCallback(async()=>{try{const [dashboardResponse,runtimeResponse]=await Promise.all([fetch('/api/automation/dashboard?eventLimit=160',{cache:'no-store'}),fetch('/api/automation/runtime',{cache:'no-store'})]);if(!dashboardResponse.ok||!runtimeResponse.ok)throw new Error('Dashboard request failed');setData(await dashboardResponse.json());setRuntime(await runtimeResponse.json());setError(null)}catch(requestError){setError((requestError as Error).message)}},[]);
  const toggleRuntime=async()=>{setChangingRuntime(true);try{const response=await fetch('/api/automation/runtime',{method:runtime?.running?'DELETE':'POST'});if(!response.ok)throw new Error((await response.json()).error??'Runtime request failed');setRuntime(await response.json());await refresh()}catch(runtimeError){setError((runtimeError as Error).message)}finally{setChangingRuntime(false)}};
  useEffect(()=>{refresh();const timer=window.setInterval(refresh,3000);return()=>window.clearInterval(timer)},[refresh]);
  const winRate=useMemo(()=>data?.summary.total?(data.summary.wins/data.summary.total)*100:0,[data]);
  const activeTradeByPair=useMemo(()=>new Map((data?.activeTrades??[]).map(trade=>[trade.pair,trade])),[data]);
  const activeWorkers=useMemo(()=>(data?.workers??[]).filter(worker=>!['paused','stopped','error'].includes(worker.state)),[data]);
  const inactiveWorkers=useMemo(()=>(data?.workers??[]).filter(worker=>['paused','stopped','error'].includes(worker.state)),[data]);
  const filteredEvents=useMemo(()=>{
    const events=selectedPair?(data?.events??[]).filter(event=>event.pair===selectedPair):(data?.events??[]);
    return [...events].sort((a,b)=>b.id-a.id);
  },[data,selectedPair]);
  return <Page>
    <Hero><HeroTop><div><Eyebrow>Strategy command center</Eyebrow><Title>Automation Pulse</Title><Subtitle>Live strategy steps, worker health, trade decisions, and performance. Dashboard startup is restricted to the OANDA demo account.</Subtitle></div><RuntimeControls><LiveBadge>{runtime?.running&&<Dot/>}{runtime?.running?`DEMO running · PID ${runtime.pid}`:'Automation stopped'}</LiveBadge><RuntimeButton type="button" running={runtime?.running} disabled={changingRuntime} onClick={toggleRuntime}>{changingRuntime?'Working…':runtime?.running?'Stop automation':'Start demo automation'}</RuntimeButton></RuntimeControls></HeroTop>
      <Stats><Stat><StatLabel>Total trades</StatLabel><StatValue>{data?.summary.total??0}</StatValue></Stat><Stat><StatLabel>Win rate</StatLabel><StatValue tone="good">{winRate.toFixed(1)}%</StatValue></Stat><Stat><StatLabel>Wins / losses</StatLabel><StatValue>{data?.summary.wins??0} <Muted>/ {data?.summary.losses??0}</Muted></StatValue></Stat><Stat><StatLabel>Realized P/L</StatLabel><StatValue tone={(data?.summary.realizedPL??0)>=0?'good':'bad'}>{Number(data?.summary.realizedPL??0).toFixed(2)}</StatValue></Stat></Stats>
    </Hero>
    <Tabs><Tab active={activeTab==='activity'} onClick={()=>setActiveTab('activity')}>Activity & workers</Tab><Tab active={activeTab==='positions'} onClick={()=>setActiveTab('positions')}>Pair positions ({data?.activeTrades.length??0} open)</Tab></Tabs>
    {activeTab==='activity'?<><Layout>
      <Card><CardHeader><CardTitle>Live strategy candylog</CardTitle><Muted>{selectedPair?`filtered to ${selectedPair}`:'all workers'} · refreshes every 3 seconds</Muted></CardHeader><Filters><FilterSelect aria-label="Filter active workers" value={activeWorkers.some(worker=>worker.pair===selectedPair)?selectedPair:''} onChange={event=>setSelectedPair(event.target.value)}><option value="">Active workers ({activeWorkers.length})</option>{activeWorkers.map(worker=><option key={worker.pair} value={worker.pair}>{worker.pair} — {worker.step.replaceAll('_',' ')}</option>)}</FilterSelect><FilterSelect aria-label="Filter inactive workers" value={inactiveWorkers.some(worker=>worker.pair===selectedPair)?selectedPair:''} onChange={event=>setSelectedPair(event.target.value)}><option value="">Inactive workers ({inactiveWorkers.length})</option>{inactiveWorkers.map(worker=><option key={worker.pair} value={worker.pair}>{worker.pair} — {worker.message}</option>)}</FilterSelect></Filters><Feed>{filteredEvents.length?filteredEvents.map(event=>{const manager=event.step?.startsWith('trade_manager_')??false;return <Event key={event.id}><EventDot level={event.level}/><Time>{formatTime(event.createdAt)}</Time><EventMessage>{event.pair&&<Tag $manager={manager}>{event.pair}</Tag>}{event.step&&<Tag $manager={manager}>{event.step.replaceAll('_',' ')}</Tag>}{event.message}</EventMessage></Event>}):<Empty>{error??(selectedPair?`No retained events for ${selectedPair}.`:'No automation events yet. Start demo automation to populate the feed.')}</Empty>}</Feed></Card>
      <Card><CardHeader><CardTitle>Pair workers</CardTitle><Muted>{data?.workers.length??0} reporting</Muted></CardHeader><WorkerGrid>{data?.workers.length?data.workers.map(worker=><Worker key={worker.pair}><WorkerTop><Pair>{worker.pair}</Pair><State state={worker.state}>{worker.state.replaceAll('_',' ')}</State></WorkerTop><WorkerStep>{worker.step.replaceAll('_',' ')}</WorkerStep><WorkerMessage>{worker.message} · {worker.mode.toUpperCase()} · {formatTime(worker.updatedAt)}</WorkerMessage></Worker>):<Empty>No workers have reported status yet.</Empty>}</WorkerGrid></Card>
    </Layout>
    <TableCard><CardHeader><CardTitle>Trade history</CardTitle><Muted>SQLite journal</Muted></CardHeader><TableScroll><Table><thead><tr><th>Closed</th><th>Pair</th><th>Side</th><th>Mode</th><th>Entry</th><th>Stop loss</th><th>Take profit</th><th>Result</th><th>P/L</th></tr></thead><tbody>{data?.trades.map(trade=><tr key={trade.tradeId}><td>{formatDate(trade.closedAt)}</td><td>{trade.pair}</td><td>{trade.direction}</td><td>{trade.mode.toUpperCase()}</td><td>{trade.entry}</td><td>{trade.stopLoss}</td><td>{trade.takeProfit}</td><td><Result result={trade.outcome}>{trade.outcome}</Result></td><td>{trade.realizedPL??'—'}</td></tr>)}</tbody></Table>{!data?.trades.length&&<Empty>No completed trades recorded yet.</Empty>}</TableScroll></TableCard>
    </>:<TableCard><CardHeader><CardTitle>Pair positions</CardTitle><Muted>Current automation ledger</Muted></CardHeader><TableScroll><Table><thead><tr><th>Pair</th><th>Open trade?</th><th>Direction</th><th>Mode</th><th>Entry</th><th>Stop loss</th><th>Take profit</th><th>Trade ID</th><th>Opened</th></tr></thead><tbody>{forexPairs.map(pair=>{const trade=activeTradeByPair.get(pair);return <tr key={pair}><td><Pair>{pair}</Pair></td><td><PositionStatus open={Boolean(trade)}>{trade?'OPEN':'NO OPEN TRADE'}</PositionStatus></td><td>{trade?.direction??'—'}</td><td>{trade?.mode.toUpperCase()??'—'}</td><td>{trade?.entry??'—'}</td><td>{trade?.stopLoss??'—'}</td><td>{trade?.takeProfit??'—'}</td><td>{trade?.tradeId??'—'}</td><td>{formatDate(trade?.openedAt)}</td></tr>})}</tbody></Table></TableScroll></TableCard>}
  </Page>;
}
