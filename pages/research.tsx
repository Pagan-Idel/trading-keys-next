import Head from 'next/head';
import Link from 'next/link';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import styled from 'styled-components';
import {getGoldilocksTimeframeProfile,type GoldilocksTimeframeProfileId} from '../utils/goldilocksConfig';
import {GOLDILOCKS_BACKTEST_MANAGERS,GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID} from '../utils/goldilocksTradeManagement';

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
const DangerButton=styled(Button)`border-color:#63303b;background:#2b141a;color:#ffadb8;`;
const Field=styled.input`width:100%;min-width:110px;border:1px solid #344352;background:#0a1016;color:#eaf4ff;border-radius:9px;padding:8px;`;
const Select=styled.select`border:1px solid #344352;background:#0a1016;color:#eaf4ff;border-radius:9px;padding:8px;`;
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
const QueueShell=styled.div`
  padding:1px;border-radius:18px;background:linear-gradient(120deg,#39e6ff66,#7cffb955,#bf6cff55,#ffcf5c55);
  box-shadow:0 18px 55px #0008,0 0 35px #44e7ff12;
  ${TableWrap}{border:0;border-radius:17px;background:#090e14;}
`;
const QueueRow=styled.tr<{$active?:boolean;$explore?:boolean}>`
  position:relative;background:${p=>p.$active?'linear-gradient(90deg,#0d3a3ccc,#10292dcc,#111923)':p.$explore?'linear-gradient(90deg,#24173199,#15111dcc)':'transparent'};
  box-shadow:${p=>p.$active?'inset 4px 0 #57ffd2,0 0 26px #38f5ca18':p.$explore?'inset 4px 0 #c779ff':'none'};
  td{border-bottom-color:${p=>p.$active?'#2e7a6c':p.$explore?'#533363':'#242d38'};}
  ${p=>p.$active?'select,input,details,button{pointer-events:none;opacity:.72;}':''}
`;
const QueueStatus=styled.span<{$tone?:'live'|'next'|'explore'}>`
  display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:4px 7px;border-radius:999px;font-size:.56rem;font-weight:950;letter-spacing:.08em;text-transform:uppercase;
  color:${p=>p.$tone==='live'?'#8fffdc':p.$tone==='explore'?'#dfa6ff':'#9ecbff'};
  border:1px solid ${p=>p.$tone==='live'?'#368b73':p.$tone==='explore'?'#71438b':'#355b82'};
  background:${p=>p.$tone==='live'?'#123b31':p.$tone==='explore'?'#2c1838':'#12243a'};
`;
const QueueRibbon=styled.div`
  display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:14px 0 10px;
  span{padding:7px 10px;border:1px solid #304252;border-radius:999px;background:#0b141d;color:#90a8bd;font-size:.65rem;font-weight:800;}
  strong{color:#e9fbff;}
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
type TrialConfig={
  label?:string;minimumScore:number;timeframeProfile?:GoldilocksTimeframeProfileId;lookbackDays:number;pairs:string[];
  strategyVersion?:string;riskProfile?:string;confirmationMode?:string;tradeManager?:string;
  setAndForgetTargetMode?:'fixed-r'|'opposing-base';setAndForgetTargetR?:number;
  strategyTweaks?:{maximumPriorTouches?:number;maxEntryDistanceZoneFraction?:number;[key:string]:unknown};
  gateSettings?:Record<string,boolean>;[key:string]:unknown;
};
type Trial={
  id:string;datasetKey:string;status:string;queuePosition?:number;backtestRunId?:string;createdAt:string;startedAt?:string;completedAt?:string;error?:string;
  config:TrialConfig;
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
  globalLeader:null|{id:string;backtestRunId:string;runUid:string|null;config:TrialConfig;metrics:{official?:Performance};compatibility:{compatible:boolean;blockers:string[]}};
  allTimeRecords:Array<{id:string;backtestRunId:string;runUid:string|null;config:TrialConfig;metrics:{official?:Performance};compatibility:{compatible:boolean;blockers:string[]}}>;
  appliedStrategy:{sourceRunUid:string;appliedAt:string;config:TrialConfig};
  coverage:Array<{pair:string;timeframe:string;startTime:number;endTime:number;candleCount:number}>;
};

const formatR=(value:number|null|undefined,signed=false)=>value==null?'—':`${signed&&value>0?'+':''}${value.toFixed(3)}R`;
const formatFactor=(value:number|null|undefined)=>value==null?'—':Number.isFinite(value)?value.toFixed(2):'∞';
const formatTime=(value?:string)=>value?new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(value)):'—';
const formatBytes=(value:number)=>`${(value/1024/1024/1024).toFixed(2)} GiB`;
const statusTone=(status?:string):'good'|'warn'|'bad'|'idle'=>status==='running'?'good':status==='preparing'||status==='waiting'||status==='queued'||status==='paused'?'warn':status==='failed'||status==='cancelled'?'bad':'idle';

export default function ResearchStatus(){
  const requestInFlight=useRef(false);
  const [data,setData]=useState<ResearchData|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [sendingLeader,setSendingLeader]=useState(false);
  const [lastRefresh,setLastRefresh]=useState<Date|null>(null);
  const [drafts,setDrafts]=useState<Record<string,TrialConfig>>({});
  const load=useCallback(async()=>{
    if(requestInFlight.current)return;
    requestInFlight.current=true;
    try{
      const response=await fetch('/api/backtests/research',{cache:'no-store'});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error??'Unable to load research status.');
      setData(body);setLastRefresh(new Date());setError('');
    }catch(loadError){setError(loadError instanceof Error?loadError.message:String(loadError))}finally{requestInFlight.current=false}
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
  const appliedConfig=data?.appliedStrategy?.config;
  const appliedManager=GOLDILOCKS_BACKTEST_MANAGERS.find(manager=>manager.id===appliedConfig?.tradeManager)?.label.replace(' (default)','')??appliedConfig?.tradeManager??'Loading';
  const active=data?.activeBacktest;
  const activeProgress=Math.max(0,Math.min(100,Number(active?.progressPercent??0)));
  const queuedTrials=(data?.trials??[]).filter(trial=>trial.status==='queued');
  const visibleQueue=currentTrial?[currentTrial,...queuedTrials.slice(0,4)]:queuedTrials.slice(0,5);
  const inactive=!campaign||['completed','cancelled','failed'].includes(campaign.status);
  const activity=campaign?.status==='preparing'
    ?campaign.preparationStage??'Acquiring the fixed historical dataset once'
    :campaign?.status==='running'
    ?`Evaluating ${currentTrial?.config.label??'the current configuration'}`
    :campaign?.status==='waiting'&&active
      ?`Waiting for backtest ${active.id.slice(0,8)} to release the shared research lock`
      :campaign?.status==='waiting'
        ?'Waiting to seal the next historical snapshot comparison cycle'
        :campaign?.status==='paused'?'Paused after the current deterministic operation':campaign?.status??'Not started';

  const action=async(kind:'start'|'pause'|'resume'|'stop')=>{
    setBusy(true);
    try{
      const response=await fetch(kind==='start'?'/api/backtests/research':`/api/backtests/research?campaignId=${encodeURIComponent(String(campaign?.id??''))}`,{
        method:kind==='start'?'POST':kind==='stop'?'DELETE':'PATCH',headers:{'Content-Type':'application/json'},
        body:kind==='start'?JSON.stringify({continuous:true}):kind==='stop'?undefined:JSON.stringify({action:kind}),
      });
      const body=await response.json();if(!response.ok)throw new Error(body.error??'Research action failed.');await load();
    }catch(actionError){setError(actionError instanceof Error?actionError.message:String(actionError))}finally{setBusy(false)}
  };

  const queueAction=async(trial:Trial,kind:'up'|'down'|'remove'|'save')=>{
    if(!campaign)return;
    setBusy(true);
    try{
      const draft=drafts[trial.id]??trial.config;
      const savedConfig={...draft,lookbackDays:365,label:`Research ${trial.id.slice(0,8)} | ${getGoldilocksTimeframeProfile(draft.timeframeProfile??'intraday').label} | score ${draft.minimumScore}`};
      const body=kind==='save'?{action:'edit',trialId:trial.id,config:savedConfig}:kind==='remove'?{action:'remove',trialId:trial.id}:{action:'move',trialId:trial.id,direction:kind};
      const response=await fetch(`/api/backtests/research?campaignId=${encodeURIComponent(campaign.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok)throw new Error(result.error??'Queue update failed.');await load();
    }catch(actionError){setError(actionError instanceof Error?actionError.message:String(actionError))}finally{setBusy(false)}
  };

  const sendGlobalLeaderToPi=async()=>{
    setSendingLeader(true);
    try{
      const response=await fetch('/api/automation/dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'move-global-leader'})});
      const body=await response.json();if(!response.ok)throw new Error(body.error??'Unable to approve the record for Pi sync.');await load();
    }catch(sendError){setError(sendError instanceof Error?sendError.message:String(sendError))}finally{setSendingLeader(false)}
  };

  return <Page>
    <Head><title>Research Status · Trading Keys</title></Head>
    <Hero>
      <Kicker>Goldilocks overnight discovery</Kicker>
      <Title>Research Status</Title>
      <Sub>This page refreshes every five seconds. Each comparison cycle acquires a bounded historical snapshot once, seals it, and runs every configuration from local SQLite. A new sealed cycle is added whenever the queue finishes; research never changes live or demo trading.</Sub>
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
      <Card><Label>Current Pi configuration</Label><Metric style={{fontSize:'1rem'}}>{appliedConfig?getGoldilocksTimeframeProfile(appliedConfig.timeframeProfile).label:'Loading'}</Metric><Small>Score {appliedConfig?.minimumScore??'—'}/20 · {String(appliedConfig?.riskProfile??'—')} risk<br/>Source {data?.appliedStrategy?.sourceRunUid??'—'}</Small></Card>
      <Card><Label>Pi trade management</Label><Metric style={{fontSize:'1rem'}}>{appliedManager}</Metric><Small>{appliedConfig?.confirmationMode??'—'} confirmation · {appliedConfig?.setAndForgetTargetMode==='opposing-base'?'opposing-base target':appliedConfig?.setAndForgetTargetR?`${appliedConfig.setAndForgetTargetR}R target`:'manager-controlled target'}</Small></Card>
      <Card><Label>Trial trade observations</Label><Metric>{completedTrials.reduce((sum,trial)=>sum+Number(trial.metrics?.official?.sampleTrades??0),0)}</Metric><Small>Current campaign observations only; these do not define the all-time records below</Small></Card>
      <Card><Label>Candle archive</Label><Metric>{data?formatBytes(data.archive.usedBytes):'—'}</Metric><Small>{data?`${data.archive.percent.toFixed(1)}% of ${formatBytes(data.archive.maxBytes)} · ${formatBytes(data.archive.remainingBytes)} free`:'Loading storage…'}</Small></Card>
    </Grid>

    <Section>
      <SectionHead><div><h2>Campaign queue</h2><p>{campaign?.label??'No campaign yet'} · {campaign?.id??'—'}</p></div><div style={{color:'#718093',fontSize:11}}>Started {formatTime(campaign?.startedAt)}</div></SectionHead>
      <Meter><span style={{width:`${campaign?.status==='preparing'?(campaign.preparationTotal?100*Number(campaign.preparationDone??0)/campaign.preparationTotal:0):campaignProgress}%`}}/></Meter>
      <Small>{campaign?.status==='preparing'?`${campaign.preparationStage??'Preparing'} - dataset ${campaign.datasetKey??'not sealed yet'}`:`${campaignProgress.toFixed(1)}% complete - research engine ${data?.researchVersion??'unknown'} - worker PID ${campaign?.workerPid??'offline'}`}</Small>
      <QueueRibbon><span>⚡ <strong>{currentTrial?'1 active':'Waiting'}</strong></span><span>◆ <strong>{queuedTrials.length}</strong> queued</span><span>◉ <strong>{finished}</strong> finished</span><span>✦ Wildcard = <strong>one broader automatic test</strong></span><span>Dataset <strong>{campaign?.datasetKey?.slice(0,18)??'sealing'}</strong></span>{active&&<span>Progress <strong>{activeProgress.toFixed(1)}%</strong></span>}</QueueRibbon>
      <div style={{marginTop:16}}>
        {visibleQueue.length?<QueueShell><TableWrap><table><thead><tr><th>ID / Status</th><th>Strategy</th><th>Score</th><th>Manager</th><th>Target</th><th>More</th><th>Actions</th></tr></thead><tbody>
          {visibleQueue.map((trial,index)=>{const draft=drafts[trial.id]??trial.config;const tweaks=draft.strategyTweaks??{};const gates=draft.gateSettings??{};const isActive=trial.status==='running';const isExplore=/wildcard/i.test(String(draft.label??''));return <QueueRow key={trial.id} $active={isActive} $explore={isExplore}>
            <td><code title={trial.id}>{trial.id.slice(0,8)}</code><br/><QueueStatus title={isExplore?'One automatic broader test; it never changes live/demo settings.':undefined} $tone={isActive?'live':isExplore?'explore':'next'}>{isActive?'● Live':isExplore?'✦ Wildcard':`Next ${currentTrial?index:index+1}`}</QueueStatus></td>
            <td><Select value={String(draft.timeframeProfile??'intraday')} onChange={event=>setDrafts(old=>({...old,[trial.id]:{...draft,timeframeProfile:event.target.value as GoldilocksTimeframeProfileId}}))}><option value="lowerTimeframe">M15/M5/M1</option><option value="intraday">H1/M15/M5</option><option value="higherTimeframe">D1/H4/H1</option></Select></td>
            <td><Field style={{minWidth:60,width:60}} type="number" min={0} max={20} value={Number(draft.minimumScore??14)} onChange={event=>setDrafts(old=>({...old,[trial.id]:{...draft,minimumScore:Number(event.target.value)}}))}/></td>
            <td><Select style={{maxWidth:190}} value={String(draft.tradeManager??'secure-half-atr-runner-v3')} onChange={event=>setDrafts(old=>({...old,[trial.id]:{...draft,tradeManager:event.target.value}}))}>{GOLDILOCKS_BACKTEST_MANAGERS.map(manager=><option key={manager.id} value={manager.id}>{manager.label.replace(' (default)','')}</option>)}</Select></td>
            <td>{draft.tradeManager===GOLDILOCKS_SET_AND_FORGET_2R_MANAGEMENT_ID?<Select value={draft.setAndForgetTargetMode==='fixed-r'?String(draft.setAndForgetTargetR??2):'opposing-base'} onChange={event=>setDrafts(old=>({...old,[trial.id]:event.target.value==='opposing-base'?{...draft,setAndForgetTargetMode:'opposing-base',setAndForgetTargetR:2}:{...draft,setAndForgetTargetMode:'fixed-r',setAndForgetTargetR:Number(event.target.value)}}))}><option value="opposing-base">Opp. base</option>{[1,1.5,2,2.5,3,4,5].map(target=><option key={target} value={target}>{target}R</option>)}</Select>:<span title="This manager controls exits internally and has no separate target setting." style={{color:'#718093'}}>—</span>}</td>
            <td><details><summary style={{cursor:'pointer',color:'#8beeff'}}>Tune</summary><div style={{display:'grid',gap:6,minWidth:155,paddingTop:8}}><Select value={String(draft.confirmationMode??'close-through')} onChange={event=>setDrafts(old=>({...old,[trial.id]:{...draft,confirmationMode:event.target.value}}))}><option value="close-through">Touch + engulf</option><option value="touch-entry">Immediate touch</option></Select><label>Touches <Field style={{minWidth:55,width:55}} type="number" min={0} max={3} value={Number(tweaks.maximumPriorTouches??3)} onChange={event=>setDrafts(old=>({...old,[trial.id]:{...draft,strategyTweaks:{...tweaks,maximumPriorTouches:Number(event.target.value)}}}))}/></label><label>Distance <Field style={{minWidth:55,width:55}} type="number" min={0} max={2} step={0.1} value={Number(tweaks.maxEntryDistanceZoneFraction??0.5)} onChange={event=>setDrafts(old=>({...old,[trial.id]:{...draft,strategyTweaks:{...tweaks,maxEntryDistanceZoneFraction:Number(event.target.value)}}}))}/></label><Select value={gates.entryProximity===false?'off':'on'} onChange={event=>setDrafts(old=>({...old,[trial.id]:{...draft,gateSettings:{...gates,entryProximity:event.target.value==='on'}}}))}><option value="on">Proximity on</option><option value="off">Proximity off</option></Select></div></details></td>
            <td>{isActive?<QueueStatus $tone="live">Running {activeProgress.toFixed(0)}%</QueueStatus>:<div style={{display:'flex',gap:6,flexWrap:'wrap'}}><Button disabled={busy||(!currentTrial&&index===0)} onClick={()=>void queueAction(trial,'up')}>↑</Button><Button disabled={busy||queuedTrials.length===1} onClick={()=>void queueAction(trial,'down')}>↓</Button><Button disabled={busy} onClick={()=>void queueAction(trial,'save')}>Save</Button><DangerButton disabled={busy} onClick={()=>void queueAction(trial,'remove')}>Remove</DangerButton></div>}</td>
          </QueueRow>})}
        </tbody></table></TableWrap></QueueShell>:<Empty>No configurations are waiting. Completed evidence remains ranked below.</Empty>}
        {queuedTrials.length>5&&<Small style={{display:'block',marginTop:10}}>Showing only the next 5 of {queuedTrials.length} queued trials.</Small>}
      </div>
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
      <SectionHead><div><h2>All-time top 3 records</h2><p>Global records across every campaign, each backed by at least 100 trades. Net result is the full result for that configuration; expectancy determines rank and drawdown breaks ties.</p></div><div style={{color:'#718093',fontSize:11}}>Showing {(data?.allTimeRecords??[]).length} record{(data?.allTimeRecords??[]).length===1?'':'s'}</div></SectionHead>
      {data?.allTimeRecords?.length?<TableWrap><table><thead><tr><th>Rank</th><th>Configuration</th><th>Stack</th><th>Score</th><th>Trades</th><th>Net result</th><th>Profit factor</th><th>Max DD</th><th>Trade manager</th><th>Pi status</th></tr></thead><tbody>
        {data.allTimeRecords.slice(0,3).map((record,index)=>{const metric=record.metrics?.official;const synced=Boolean(record.runUid&&data.appliedStrategy?.sourceRunUid===record.runUid);const manager=GOLDILOCKS_BACKTEST_MANAGERS.find(item=>item.id===record.config.tradeManager)?.label.replace(' (default)','')??record.config.tradeManager??'—';return <tr key={record.id} style={{background:synced?'#123b3126':'transparent'}}>
          <td><Link href={`/research/trials/${record.id}`} style={{color:'#8beeff',fontWeight:900,textDecoration:'none'}}>#{index+1}</Link></td><td><Link href={`/research/trials/${record.id}`} style={{color:'#dce8f4',textDecoration:'none'}}>{record.config.label??record.id.slice(0,8)}</Link></td><td>{getGoldilocksTimeframeProfile(record.config.timeframeProfile).label}</td><td>{record.config.minimumScore}/20</td><td>{metric?.sampleTrades??0}</td>
          <td className={Number(metric?.netR??0)>=0?'good':'bad'}>{formatR(metric?.netR,true)}</td><td>{formatFactor(metric?.profitFactor)}</td><td>{formatR(metric?.maxDrawdownR)}</td><td>{manager}</td><td>{index===0?<Button title={!record.compatibility.compatible?record.compatibility.blockers.join(' '):synced?'This record is already the approved Pi configuration.':'Approval requires stopped automation and no open trade.'} disabled={sendingLeader||synced||!record.compatibility.compatible} onClick={()=>void sendGlobalLeaderToPi()}>{synced?'Active on Pi':sendingLeader?'Sending…':'Send #1 to Pi'}</Button>:synced?<QueueStatus $tone="live">Active on Pi</QueueStatus>:'—'}</td>
        </tr>})}
      </tbody></table></TableWrap>:<Empty>The all-time table will populate after a configuration completes at least 100 trades.</Empty>}
    </Section>

    <Section>
      <SectionHead><div><h2>Recent research log</h2><p>Newest campaign events first. Active backtest detail appears above.</p></div></SectionHead>
      {data?.events?.length?<EventList>{data.events.slice(0,20).map(event=><Event key={event.id}><time>{formatTime(event.createdAt)}</time><span>{event.message}</span></Event>)}</EventList>:<Empty>No research events recorded yet.</Empty>}
    </Section>
  </Page>;
}
