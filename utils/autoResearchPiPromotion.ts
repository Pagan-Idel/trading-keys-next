import type {BacktestRunConfig} from './backtestStore.ts';
import {getBacktestDashboard} from './backtestStore.ts';
import {getBestAutoResearchResult} from './autoResearchStore.ts';
import {applyAutomationStrategy,getAppliedAutomationStrategy} from './automationStore.ts';
import {getAutomationCompatibility} from './automationStrategyCompatibility.ts';

type PiStatus={runtime?:{running?:boolean};dashboard?:{activeTrades?:unknown[];appliedStrategy?:{sourceRunUid?:string}}};
type Fetcher=typeof fetch;

const request=async(fetcher:Fetcher,url:string,token:string,method:'GET'|'POST')=>{
  const response=await fetcher(url,{method,headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15_000)});
  const payload=await response.json();
  if(!response.ok)throw new Error(String(payload?.error??`${method} ${url} failed.`));
  return payload;
};

export const restartPiWithApprovedStrategy=async(input:{
  expectedRunUid:string;baseUrl:string;token:string;fetcher?:Fetcher;
})=>{
  const fetcher=input.fetcher??fetch;
  const base=input.baseUrl.replace(/\/$/,'');
  const before=await request(fetcher,`${base}/api/status`,input.token,'GET') as PiStatus;
  if(before.dashboard?.appliedStrategy?.sourceRunUid===input.expectedRunUid)return {status:'already-active' as const,activeRunUid:input.expectedRunUid};
  if((before.dashboard?.activeTrades??[]).length)return {status:'deferred-open-trade' as const};
  await request(fetcher,`${base}/api/config-sync`,input.token,'POST');
  if(before.runtime?.running){
    try{await request(fetcher,`${base}/api/stop`,input.token,'POST')}
    catch(stopError){
      let stopped=false;
      for(let attempt=0;attempt<10&&!stopped;attempt+=1){
        await new Promise(resolve=>setTimeout(resolve,1_000));
        const status=await request(fetcher,`${base}/api/status`,input.token,'GET') as PiStatus;
        stopped=!status.runtime?.running;
      }
      if(!stopped)throw stopError;
    }
  }
  await request(fetcher,`${base}/api/start`,input.token,'POST');
  const after=await request(fetcher,`${base}/api/status`,input.token,'GET') as PiStatus;
  const activeRunUid=after.dashboard?.appliedStrategy?.sourceRunUid;
  if(activeRunUid!==input.expectedRunUid)throw new Error(`Pi restarted with ${activeRunUid??'no strategy'} instead of ${input.expectedRunUid}.`);
  return {status:'activated' as const,activeRunUid};
};

const leaderRunUid=(backtestRunId:string)=>{
  const dashboard=getBacktestDashboard(backtestRunId) as any;
  return dashboard.runs?.find((run:any)=>run.id===backtestRunId)?.runUid as string|undefined;
};

export const autoPromoteResearchLeaderToPi=async()=>{
  const leader=getBestAutoResearchResult();
  if(!leader)return {status:'no-eligible-leader' as const};
  const compatibility=getAutomationCompatibility(leader.config);
  if(!compatibility.compatible)return {status:'incompatible' as const,blockers:compatibility.blockers};
  const runUid=leaderRunUid(leader.backtestRunId);
  if(!runUid)throw new Error('The research leader has no immutable run ID.');
  const baseUrl=process.env.PI_PULSE_URL??'http://127.0.0.1:4080';
  const token=process.env.PI_PULSE_CONTROL_TOKEN??process.env.PULSE_CONTROL_TOKEN;
  if(!token)return {status:'missing-pi-credentials' as const,runUid};
  const applied=getAppliedAutomationStrategy();
  if(applied.sourceRunUid!==runUid)applyAutomationStrategy(runUid,leader.config as BacktestRunConfig);
  const result=await restartPiWithApprovedStrategy({expectedRunUid:runUid,baseUrl,token});
  return {...result,runUid,trialId:leader.id};
};
