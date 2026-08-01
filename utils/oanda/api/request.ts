import { logMessage } from '../../automationLogger.ts';
import { getOandaCredentials, type OandaEnvironment } from '../../oandaCredentials.ts';

export type OandaReadDiagnostic = {
  operation:string; endpointTemplate:string; mode:OandaEnvironment; method:'GET'; attempt:number;
  status?:number; requestId?:string; pid:number; pair?:string;
  credentialSources:{accountId:string;token:string}; retryScheduled:boolean; retrySucceeded:boolean;
  retryExhausted:boolean; timeout:boolean; abort:boolean;
};

export class OandaReadError extends Error {
  constructor(message:string,readonly diagnostic:OandaReadDiagnostic){super(message);this.name='OandaReadError'}
}

type Dependencies={
  fetch?:typeof fetch; random?:()=>number; sleep?:(milliseconds:number,signal:AbortSignal)=>Promise<void>;
  credentials?:typeof getOandaCredentials; diagnostic?:(value:OandaReadDiagnostic)=>void;
};
export type OandaReadOptions={
  operation:string;endpointTemplate:string;mode:OandaEnvironment;pair?:string;signal?:AbortSignal;
  timeoutMs?:number;retryJitterMinMs?:number;retryJitterMaxMs?:number;
  buildPath:(credentials:{accountId:string})=>string;dependencies?:Dependencies;
};

const credentialSources=(mode:OandaEnvironment)=>({
  accountId:`OANDA_${mode==='live'?'LIVE':'DEMO'}_ACCOUNT_ID`,
  token:`OANDA_${mode==='live'?'LIVE':'DEMO'}_ACCOUNT_TOKEN`,
});
const configuredNumber=(name:string,fallback:number)=>{
  const value=Number(process.env[name]);
  return Number.isFinite(value)&&value>=0?value:fallback;
};
const defaultSleep=(milliseconds:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  if(signal.aborted){reject(signal.reason??new DOMException('Aborted','AbortError'));return}
  const timer=setTimeout(resolve,milliseconds);
  signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason??new DOMException('Aborted','AbortError'))},{once:true});
});
const emit=(diagnostic:OandaReadDiagnostic,custom?:Dependencies['diagnostic'])=>{
  custom?.(diagnostic);
  if(!custom&&diagnostic.abort)return;
  if(!custom&&!(diagnostic.attempt===1&&diagnostic.status!==undefined&&diagnostic.status>=200&&diagnostic.status<300))logMessage(`OANDA read ${diagnostic.operation} attempt ${diagnostic.attempt} ${diagnostic.status??(diagnostic.timeout?'timed out':diagnostic.abort?'aborted':'failed')}.`,diagnostic,
    {level:diagnostic.status&&diagnostic.status<400?'info':'warn',fileName:'oandaReadRequest',pair:diagnostic.pair,step:'oanda_read_request'});
};

export const oandaReadRequest=async(options:OandaReadOptions):Promise<Response>=>{
  const deps=options.dependencies??{},fetcher=deps.fetch??fetch,readCredentials=deps.credentials??getOandaCredentials;
  const random=deps.random??Math.random,sleep=deps.sleep??defaultSleep;
  const timeoutMs=Math.max(1,options.timeoutMs??configuredNumber('OANDA_READ_TIMEOUT_MS',10_000));
  const min=Math.max(0,options.retryJitterMinMs??configuredNumber('OANDA_READ_RETRY_JITTER_MIN_MS',100));
  const max=Math.max(min,options.retryJitterMaxMs??configuredNumber('OANDA_READ_RETRY_JITTER_MAX_MS',500));
  const sources=credentialSources(options.mode);
  for(let attempt=1;attempt<=2;attempt++){
    let credentials;
    try{credentials=readCredentials(options.mode)}catch(error){
      const diagnostic:OandaReadDiagnostic={operation:options.operation,endpointTemplate:options.endpointTemplate,mode:options.mode,
        method:'GET',attempt,pid:process.pid,pair:options.pair,credentialSources:sources,retryScheduled:false,retrySucceeded:false,
        retryExhausted:false,timeout:false,abort:false};
      emit(diagnostic,deps.diagnostic);throw new OandaReadError((error as Error).message,diagnostic);
    }
    const controller=new AbortController();
    const onAbort=()=>controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort',onAbort,{once:true});
    const timer=setTimeout(()=>controller.abort(new DOMException('OANDA read timed out','TimeoutError')),timeoutMs);
    try{
      const response=await fetcher(`${credentials.baseUrl}${options.buildPath({accountId:credentials.accountId})}`,{
        method:'GET',signal:controller.signal,headers:{Authorization:`Bearer ${credentials.token}`,Accept:'application/json'},
      });
      const requestId=response.headers.get('RequestID')??response.headers.get('request-id')??undefined;
      const retry=response.status===401&&attempt===1;
      const diagnostic:OandaReadDiagnostic={operation:options.operation,endpointTemplate:options.endpointTemplate,mode:options.mode,
        method:'GET',attempt,status:response.status,requestId,pid:process.pid,pair:options.pair,credentialSources:sources,
        retryScheduled:retry,retrySucceeded:attempt===2&&response.ok,retryExhausted:attempt===2&&response.status===401,timeout:false,abort:false};
      emit(diagnostic,deps.diagnostic);
      if(!retry){if(!response.ok)throw new OandaReadError(`OANDA ${options.operation} failed with HTTP ${response.status}.`,diagnostic);return response}
      const jitter=Math.round(min+Math.min(1,Math.max(0,random()))*(max-min));
      await sleep(jitter,options.signal??new AbortController().signal);
    }catch(error){
      if(error instanceof OandaReadError)throw error;
      const aborted=Boolean(options.signal?.aborted),timeout=!aborted&&controller.signal.aborted;
      const diagnostic:OandaReadDiagnostic={operation:options.operation,endpointTemplate:options.endpointTemplate,mode:options.mode,
        method:'GET',attempt,pid:process.pid,pair:options.pair,credentialSources:sources,retryScheduled:false,retrySucceeded:false,
        retryExhausted:false,timeout,abort:aborted};
      emit(diagnostic,deps.diagnostic);
      throw new OandaReadError(`OANDA ${options.operation} ${aborted?'aborted':timeout?'timed out':'failed'}.`,diagnostic);
    }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort)}
  }
  throw new Error('Unreachable OANDA read state.');
};
