import {
  fetchAndStageApprovedStrategy,type StrategySyncResult,
} from './approvedStrategySync';

export type ApprovedStrategyPollEvent=
  'check_started'|'no_update'|'update_detected'|'downloaded'|'validated'|'staged'|'rejected'|'activation_pending';

export type ApprovedStrategyPollerOptions={
  endpoint:string;
  token:string;
  intervalMs:number;
  timeoutMs?:number;
  dataDirectory?:string;
  fetcher?:typeof fetch;
  getCurrent:()=>{id:string;approvedAt:string};
  onEvent:(event:ApprovedStrategyPollEvent,data?:Record<string,unknown>)=>void;
  setTimer?:(callback:()=>void,delay:number)=>ReturnType<typeof setTimeout>;
  clearTimer?:(timer:ReturnType<typeof setTimeout>)=>void;
};

export const createApprovedStrategyPoller=(options:ApprovedStrategyPollerOptions)=>{
  const setTimer=options.setTimer??setTimeout;
  const clearTimer=options.clearTimer??clearTimeout;
  const intervalMs=Number.isFinite(options.intervalMs)&&options.intervalMs>=30_000
    ?options.intervalMs:300_000;
  let timer:ReturnType<typeof setTimeout>|null=null;
  let activeRequest:AbortController|null=null;
  let stopped=true;
  let running=false;
  let failures=0;

  const schedule=(delay:number)=>{
    if(stopped)return;
    timer=setTimer(()=>void check(),delay);
    timer.unref?.();
  };
  const check=async():Promise<StrategySyncResult|{status:'unavailable'}>=>{
    if(stopped||running)return {status:'unavailable'};
    running=true;
    activeRequest=new AbortController();
    options.onEvent('check_started');
    try{
      const current=options.getCurrent();
      const result=await fetchAndStageApprovedStrategy({
        endpoint:options.endpoint,token:options.token,currentId:current.id,
        currentApprovedAt:current.approvedAt,dataDirectory:options.dataDirectory,
        fetcher:options.fetcher,timeoutMs:options.timeoutMs,signal:activeRequest.signal,
      });
      failures=0;
      if(result.status==='current')options.onEvent('no_update',{configurationId:result.configurationId});
      else{
        options.onEvent('update_detected',{configurationId:result.configurationId});
        options.onEvent('downloaded',{configurationId:result.configurationId});
        options.onEvent('validated',{configurationId:result.configurationId});
        options.onEvent('staged',{configurationId:result.configurationId});
        options.onEvent('activation_pending',{configurationId:result.configurationId});
      }
      return result;
    }catch(error){
      failures++;
      if(!stopped){
        const raw=error instanceof Error?error.message:String(error);
        const redacted=options.token?raw.replaceAll(options.token,'[REDACTED]'):raw;
        options.onEvent('rejected',{error:redacted});
      }
      return {status:'unavailable'};
    }finally{
      running=false;
      activeRequest=null;
      const backoff=Math.min(intervalMs*Math.max(1,2**Math.min(failures,4)),60*60*1000);
      schedule(backoff);
    }
  };
  return {
    start(){if(!stopped)return;stopped=false;schedule(0)},
    stop(){stopped=true;if(timer)clearTimer(timer);timer=null;activeRequest?.abort()},
    check,
    get running(){return running},
  };
};
