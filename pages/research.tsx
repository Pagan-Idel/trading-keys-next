import Head from 'next/head';
import Link from 'next/link';
import {useCallback,useEffect,useMemo,useState} from 'react';
import styled from 'styled-components';

const Page=styled.div`
  width:min(1380px,calc(100% - 30px));margin:0 auto 80px;color:#edf5ff;
  font-family:Inter,system-ui,sans-serif;
`;
const Hero=styled.section`
  padding:clamp(22px,4vw,42px);border:1px solid #294d57;border-radius:24px;
  background:radial-gradient(circle at 85% 0,#174953 0,transparent 36%),linear-gradient(145deg,#111922,#090d12);
  box-shadow:0 24px 80px #0009;
`;
const Kicker=styled.div`color:#72efff;font-size:.72rem;font-weight:900;letter-spacing:.16em;text-transform:uppercase;`;
const Title=styled.h1`
  margin:10px 0;font-size:clamp(2.2rem,6vw,4.7rem);line-height:.95;
  background:linear-gradient(90deg,#fff,#83f4ff,#a5ffcd);-webkit-background-clip:text;color:transparent;
`;
const Sub=styled.p`max-width:850px;margin:0;color:#9cabbc;line-height:1.6;`;
const StatusRow=styled.div`display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:22px;`;
const Badge=styled.span<{$tone?:'good'|'warn'|'bad'|'idle'}>`
  display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;font-size:.72rem;font-weight:900;
  color:${p=>p.$tone==='bad'?'#ffabb5':p.$tone==='warn'?'#ffe09b':p.$tone==='idle'?'#bcc7d4':'#87ffd0'};
  border:1px solid ${p=>p.$tone==='bad'?'#703542':p.$tone==='warn'?'#705b2b':p.$tone==='idle'?'#414b58':'#2a7058'};
  background:${p=>p.$tone==='bad'?'#2b1118':p.$tone==='warn'?'#28210f':p.$tone==='idle'?'#171c23':'#10291f'};
`;
const Dot=styled.i`width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 14px currentColor;`;
const Button=styled.button`
  border:1px solid #367987;background:#16383f;color:#a8f7ff;border-radius:11px;padding:9px 13px;font-weight:850;cursor:pointer;
  &:disabled{opacity:.45;cursor:not-allowed;}
`;
const StopButton=styled(Button)`border-color:#713b49;background:#351720;color:#ffb1bc;`;
const Grid=styled.div`
  display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px;
  @media(max-width:900px){grid-template-columns:repeat(2,minmax(0,1fr));}
  @media(max-width:520px){grid-template-columns:1fr;}
`;
const Card=styled.div`padding:18px;border:1px solid #2b3541;border-radius:18px;background:#10151c;box-shadow:inset 0 1px #ffffff08;`;
const Label=styled.div`font-size:.65rem;color:#7f8d9d;text-transform:uppercase;letter-spacing:.12em;font-weight:850;`;
const Metric=styled.div`margin-top:7px;font-size:clamp(1.25rem,3vw,2rem);font-weight:950;color:#f7fbff;`;
const Small=styled.div`margin-top:7px;color:#8493a4;font-size:.72rem;line-height:1.45;overflow-wrap:anywhere;`;
const Section=styled.section`
  margin-top:16px;padding:20px;border:1px solid #293441;border-radius:20px;background:linear-gradient(145deg,#10151c,#0a0e13);
`;
const SectionHead=styled.div`
  display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:14px;
  h2{margin:0;font-size:1.05rem;} p{margin:5px 0 0;color:#7f8d9f;font-size:.72rem;}
`;
const Meter=styled.div`
  height:10px;border-radius:99px;background:#252d38;overflow:hidden;margin-top:14px;
  span{display:block;height:100%;background:linear-gradient(90deg,#48d9ff,#56efaf);transition:width .4s ease;}
`;
const TableWrap=styled.div`
  overflow:auto;border:1px solid #29323e;border-radius:14px;
  table{width:100%;border-collapse:collapse;min-width:820px;} th,td{padding:11px 12px;text-align:left;border-bottom:1px solid #242d38;font-size:.72rem;}
  th{color:#8493a5;text-transform:uppercase;letter-spacing:.08em;font-size:.62rem;background:#111720;position:sticky;top:0;}
  tr:last-child td{border-bottom:0;} td{color:#dce8f4;} .good{color:#67efb2;font-weight:850;} .bad{color:#ff8795;font-weight:850;}
`;
const EventList=styled.div`display:grid;gap:8px;`;
const Event=styled.div`
  display:grid;grid-template-columns:155px 1fr;gap:12px;padding:11px 12px;border:1px solid #252f3a;border-radius:12px;background:#0c1117;
  time{color:#748396;font-size:.67rem;} span{color:#cbd7e4;font-size:.72rem;line-height:1.45;}
  @media(max-width:620px){grid-template-columns:1fr;gap:4px;}
`;
const Empty=styled.div`padding:28px;text-align:center;color:#778699;border:1px dashed #34404d;border-radius:14px;`;
const ErrorBox=styled.div`margin-top:14px;padding:12px;border:1px solid #713442;border-radius:12px;background:#2b1118;color:#ffabb7;font-size:.8rem;`;

type Performance={sampleTrades:number;expectancyR:number|null;profitFactor:number|null;maxDrawdownR:number;netR:number;profitableRate:number};
type Trial={
  id:string;datasetKey:string;status:string;backtestRunId?:string;createdAt:string;startedAt?:string;completedAt?:string;error?:string;
  config:{label:string;minimumScore:number;timeframeProfile?:'intraday'|'higherTimeframe';lookbackDays:number;pairs:string[];strategyVersion?:string;riskProfile?:string};
  metrics?:{official?:Performance;byPair?:Array<{pair:string}&Performance>;policies?:Array<{policyId:string}&Performance>};
};
type Campaign={id:string;status:string;label:string;createdAt:string;startedAt?:string;updatedAt:string;completedAt?:string;workerPid?:number;currentTrialId?:string;error?:string;preparationStage?:string;preparationDone?:number;preparationTotal?:number;datasetKey?:string};
type ActiveBacktest={
  id:string;status?:string;label?:string;heartbeatAt?:string;progressPair?:string;progressDone?:number;progressTotal?:number;
  progressStage?:string;progressPercent?:number;totalTrades?:number;error?:string;latestEvent?:{createdAt:string;message:string};
};
type ResearchData={
  selectedCampaignId:string;campaigns:Campaign[];trials:Trial[];counts:Array<{status:string;count:number}>;
  events:Array<{id:number;createdAt:string;step:string;message:string}>;workerAlive:boolean;serverTime:string;
  activeBacktest:ActiveBacktest|null;researchVersion:string;
  archive:{usedBytes:number;maxBytes:number;remainingBytes:number;percent:number};
  coverage:Array<{pair:string;timeframe:string;startTime:number;endTime:number;candleCount:number}>;
};

const formatR=(value:number|null|undefined,signed=false)=>value==null?'—':`${signed&&value>0?'+':''}${value.toFixed(3)}R`;
const formatFactor=(value:number|null|undefined)=>value==null?'—':Number.isFinite(value)?value.toFixed(2):'∞';
const formatTime=(value?:string)=>value?new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(value)):'—';
const formatBytes=(value:number)=>`${(value/1024/1024/1024).toFixed(2)} GiB`;
const statusTone=(status?:string):'good'|'warn'|'bad'|'idle'=>status==='running'?'good':status==='preparing'||status==='waiting'||status==='queued'||status==='paused'?'warn':status==='failed'||status==='cancelled'?'bad':'idle';
const sampleQuality=(count:number)=>count>=100?'ELIGIBLE':count>=50?'PROVISIONAL':'INSUFFICIENT';

export default function ResearchStatus(){
  const [data,setData]=useState<ResearchData|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [lastRefresh,setLastRefresh]=useState<Date|null>(null);
  const load=useCallback(async()=>{
    try{
      const response=await fetch('/api/backtests/research',{cache:'no-store'});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error??'Unable to load research status.');
      setData(body);setLastRefresh(new Date());setError('');
    }catch(loadError){setError(loadError instanceof Error?loadError.message:String(loadError))}
  },[]);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),5_000);return()=>clearInterval(timer)},[load]);

  const campaign=data?.campaigns.find(item=>item.id===data.selectedCampaignId)??data?.campaigns[0];
  const counts=useMemo(()=>Object.fromEntries((data?.counts??[]).map(item=>[item.status,Number(item.count)])),[data?.counts]);
  const total=Object.values(counts).reduce((sum,value)=>sum+value,0);
  const finished=(counts.completed??0)+(counts.failed??0);
  const campaignProgress=total?finished/total*100:0;
  const currentTrial=data?.trials.find(trial=>trial.id===campaign?.currentTrialId)||data?.trials.find(trial=>trial.status==='running');
  const completedTrials=useMemo(()=>[...(data?.trials??[])].filter(trial=>trial.status==='completed').sort((left,right)=>
    Number(right.metrics?.official?.expectancyR??Number.NEGATIVE_INFINITY)-Number(left.metrics?.official?.expectancyR??Number.NEGATIVE_INFINITY)
    || Number(left.metrics?.official?.maxDrawdownR??Number.POSITIVE_INFINITY)-Number(right.metrics?.official?.maxDrawdownR??Number.POSITIVE_INFINITY)
  ),[data?.trials]);
  const eligibleTrials=completedTrials.filter(trial=>Number(trial.metrics?.official?.sampleTrades??0)>=100);
  const leader=eligibleTrials[0];
  const active=data?.activeBacktest;
  const activeProgress=Math.max(0,Math.min(100,Number(active?.progressPercent??0)));
  const inactive=!campaign||['completed','cancelled','failed'].includes(campaign.status);
  const activity=campaign?.status==='preparing'
    ?campaign.preparationStage??'Acquiring the fixed historical dataset once'
    :campaign?.status==='running'
    ?`Evaluating ${currentTrial?.config.label??'the current configuration'}`
    :campaign?.status==='waiting'&&active
      ?`Waiting for backtest ${active.id.slice(0,8)} to release the shared research lock`
      :campaign?.status==='waiting'
        ?'All trials on the sealed historical snapshot are complete'
        :campaign?.status==='paused'?'Paused after the current deterministic operation':campaign?.status??'Not started';

  const action=async(kind:'start'|'pause'|'resume'|'stop')=>{
    setBusy(true);
    try{
      const response=await fetch(kind==='start'?'/api/backtests/research':`/api/backtests/research?campaignId=${encodeURIComponent(String(campaign?.id??''))}`,{
        method:kind==='start'?'POST':kind==='stop'?'DELETE':'PATCH',headers:{'Content-Type':'application/json'},
        body:kind==='start'?JSON.stringify({continuous:false}):kind==='stop'?undefined:JSON.stringify({action:kind}),
      });
      const body=await response.json();if(!response.ok)throw new Error(body.error??'Research action failed.');await load();
    }catch(actionError){setError(actionError instanceof Error?actionError.message:String(actionError))}finally{setBusy(false)}
  };

  return <Page>
    <Head><title>Research Status · Trading Keys</title></Head>
    <Hero>
      <Kicker>Goldilocks overnight discovery</Kicker>
      <Title>Research Status</Title>
      <Sub>This page refreshes every five seconds. OANDA is used only while preparing one fixed historical snapshot; every configuration trial then reads sealed candles from local SQLite. Research never changes live or demo trading.</Sub>
      <StatusRow>
        <Badge $tone={statusTone(campaign?.status)}><Dot/>{campaign?.status?.toUpperCase()??'NOT STARTED'}</Badge>
        <Badge $tone={data?.workerAlive?'good':'bad'}><Dot/>{data?.workerAlive?'WORKER ONLINE':'WORKER OFFLINE'}</Badge>
        <span style={{color:'#7f8d9e',fontSize:12}}>{activity}</span>
        <span style={{marginLeft:'auto',color:'#657486',fontSize:11}}>Last refreshed {lastRefresh?formatTime(lastRefresh.toISOString()):'—'}</span>
      </StatusRow>
      <StatusRow>
        {inactive&&<Button disabled={busy} onClick={()=>void action('start')}>{busy?'Starting…':'Start research'}</Button>}
        {!inactive&&campaign?.status==='paused'&&<Button disabled={busy} onClick={()=>void action('resume')}>Resume</Button>}
        {!inactive&&campaign?.status!=='paused'&&<Button disabled={busy} onClick={()=>void action('pause')}>Pause</Button>}
        {!inactive&&<StopButton disabled={busy} onClick={()=>void action('stop')}>Stop</StopButton>}
        <Link href="/backtesting" style={{color:'#a7dce3',fontSize:12}}>Open full Backtesting Lab</Link>
      </StatusRow>
      {error&&<ErrorBox>{error}</ErrorBox>}
    </Hero>

    <Grid>
      <Card><Label>{campaign?.status==='preparing'?'Dataset acquisition':'Campaign progress'}</Label><Metric>{campaign?.status==='preparing'?`${campaign.preparationDone??0} / ${campaign.preparationTotal??0}`:`${finished} / ${total}`}</Metric><Small>{campaign?.status==='preparing'?'Unique pair/timeframe histories cached once':`${counts.running??0} running - ${counts.queued??0} queued - ${counts.failed??0} failed`}</Small></Card>
      <Card><Label>Trial trade observations</Label><Metric>{completedTrials.reduce((sum,trial)=>sum+Number(trial.metrics?.official?.sampleTrades??0),0)}</Metric><Small>Repeated strategy observations across completed configurations, not unique market trades</Small></Card>
      <Card><Label>Best eligible expectancy</Label><Metric style={{color:Number(leader?.metrics?.official?.expectancyR??0)>=0?'#68efb3':'#ff8795'}}>{formatR(leader?.metrics?.official?.expectancyR,true)}</Metric><Small>{leader?`${leader.config.timeframeProfile==='higherTimeframe'?'D1/H4/H1':'H1/M15/M5'} - score ${leader.config.minimumScore}`:'Requires at least 100 trades in one configuration'}</Small></Card>
      <Card><Label>Candle archive</Label><Metric>{data?formatBytes(data.archive.usedBytes):'—'}</Metric><Small>{data?`${data.archive.percent.toFixed(1)}% of ${formatBytes(data.archive.maxBytes)} · ${formatBytes(data.archive.remainingBytes)} free`:'Loading storage…'}</Small></Card>
    </Grid>

    <Section>
      <SectionHead><div><h2>Campaign queue</h2><p>{campaign?.label??'No campaign yet'} · {campaign?.id??'—'}</p></div><div style={{color:'#718093',fontSize:11}}>Started {formatTime(campaign?.startedAt)}</div></SectionHead>
      <Meter><span style={{width:`${campaign?.status==='preparing'?(campaign.preparationTotal?100*Number(campaign.preparationDone??0)/campaign.preparationTotal:0):campaignProgress}%`}}/></Meter>
      <Small>{campaign?.status==='preparing'?`${campaign.preparationStage??'Preparing'} - dataset ${campaign.datasetKey??'not sealed yet'}`:`${campaignProgress.toFixed(1)}% complete - research engine ${data?.researchVersion??'unknown'} - worker PID ${campaign?.workerPid??'offline'}`}</Small>
    </Section>

    <Section>
      <SectionHead><div><h2>What is running now</h2><p>The shared backtest lock prevents two large candle scans from corrupting or competing for the same state.</p></div></SectionHead>
      {active?<>
        <Grid style={{marginTop:0}}>
          <Card><Label>Backtest</Label><Metric style={{fontSize:'1rem'}}>{active.status?.toUpperCase()??'ACTIVE'}</Metric><Small>{active.label??active.id}</Small></Card>
          <Card><Label>Pair / stage</Label><Metric style={{fontSize:'1rem'}}>{active.progressPair??'Preparing'}</Metric><Small>{active.progressStage??active.latestEvent?.message??'Loading historical inputs'}</Small></Card>
          <Card><Label>Backtest progress</Label><Metric>{activeProgress.toFixed(1)}%</Metric><Small>{active.progressDone??0} / {active.progressTotal??0} units · {active.totalTrades??0} trades found</Small></Card>
          <Card><Label>Heartbeat</Label><Metric style={{fontSize:'1rem'}}>{formatTime(active.heartbeatAt)}</Metric><Small>{active.latestEvent?.message??'No event message yet'}</Small></Card>
        </Grid>
        <Meter><span style={{width:`${activeProgress}%`}}/></Meter>
      </>:<Empty>{campaign?.status==='preparing'
        ?`Historical dataset acquisition is active: ${campaign.preparationDone??0} of ${campaign.preparationTotal??0} pair/timeframe histories cached. Backtests will start automatically after this fixed snapshot is sealed.`
        :campaign?.status==='completed'
          ?'The sealed-snapshot campaign is complete; no backtest currently holds the lock.'
          :'No backtest currently holds the lock. The research worker will claim the next queued trial automatically.'}</Empty>}
    </Section>

    <Section>
      <SectionHead><div><h2>Leading configurations</h2><p>Only configurations with at least 100 realized trades receive a rank. Expectancy leads; drawdown breaks ties. Click any row for every frozen input, gate, score component, diagnostic, manager, pair result, and trade audit.</p></div><div style={{color:'#718093',fontSize:11}}>{eligibleTrials.length} eligible / {completedTrials.length} completed</div></SectionHead>
      {completedTrials.length?<TableWrap><table><thead><tr><th>Rank</th><th>Evidence</th><th>Configuration</th><th>Stack</th><th>Score</th><th>Trades</th><th>Expectancy</th><th>Profit factor</th><th>Net R</th><th>Max DD</th><th>Best manager</th></tr></thead><tbody>
        {completedTrials.slice(0,24).map(trial=>{const metric=trial.metrics?.official;const policy=trial.metrics?.policies?.[0];const trades=Number(metric?.sampleTrades??0);const rank=eligibleTrials.findIndex(item=>item.id===trial.id);return <tr key={trial.id} style={{cursor:'pointer'}}>
          <td><Link href={`/research/trials/${trial.id}`} style={{color:'#8beeff',fontWeight:900,textDecoration:'none'}}>{rank>=0?`#${rank+1}`:'--'}</Link></td><td>{sampleQuality(trades)}</td><td><Link href={`/research/trials/${trial.id}`} style={{color:'#dce8f4',textDecoration:'none'}}>{trial.config.label}</Link></td><td>{trial.config.timeframeProfile==='higherTimeframe'?'D1/H4/H1':'H1/M15/M5'}</td><td>{trial.config.minimumScore}/20</td><td>{trades}</td>
          <td className={Number(metric?.expectancyR??0)>=0?'good':'bad'}>{formatR(metric?.expectancyR,true)}</td><td>{formatFactor(metric?.profitFactor)}</td><td>{formatR(metric?.netR,true)}</td><td>{formatR(metric?.maxDrawdownR)}</td><td>{policy?.policyId??'--'}</td>
        </tr>})}
      </tbody></table></TableWrap>:<Empty>The leaderboard will populate after sealed-data trials finish.</Empty>}
    </Section>

    <Section>
      <SectionHead><div><h2>Recent research log</h2><p>Newest campaign events first. Active backtest detail appears above.</p></div></SectionHead>
      {data?.events?.length?<EventList>{data.events.slice(0,20).map(event=><Event key={event.id}><time>{formatTime(event.createdAt)}</time><span>{event.message}</span></Event>)}</EventList>:<Empty>No research events recorded yet.</Empty>}
    </Section>
  </Page>;
}
