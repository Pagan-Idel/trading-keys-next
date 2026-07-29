export const pruneOldestSetEntries=(values:Set<string>,maximum:number)=>{
  const limit=Math.max(1,Math.floor(maximum));
  while(values.size>limit){
    const oldest=values.values().next().value as string|undefined;
    if(oldest===undefined)break;
    values.delete(oldest);
  }
  return values.size;
};

export const workerScanJitterMs=(pair:string,maximumMs=1_500)=>{
  const limit=Math.max(0,Math.floor(maximumMs));
  if(!limit)return 0;
  let hash=0;
  for(const character of pair)hash=(hash*31+character.charCodeAt(0))>>>0;
  return hash%(limit+1);
};

export type WorkerStatusSnapshot={
  state:string;step:string;message:string|null;mode:string;pid:number|null;updatedAt:string;
};

export const shouldPersistWorkerStatus=(
  previous:WorkerStatusSnapshot|undefined,
  next:{state:string;step:string;message:string;mode:string;pid:number},
  now=Date.now(),
  heartbeatMs=5*60*1000,
)=>!previous||previous.state!==next.state||previous.step!==next.step||
  previous.message!==next.message||previous.mode!==next.mode||previous.pid!==next.pid||
  now-Date.parse(previous.updatedAt)>=heartbeatMs;
