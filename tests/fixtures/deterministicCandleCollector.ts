import fs from 'node:fs';
import path from 'node:path';
import { upsertArchivedCandles } from '../../utils/candleArchive.ts';

if(process.env.TRADING_KEYS_AUTOMATION_E2E!=='true')throw new Error('Collector fixture requires automation E2E mode.');
globalThis.fetch=(async()=>{throw new Error('Real HTTP is forbidden in combined lifecycle E2E mode.')}) as typeof fetch;
const pair=process.argv[2]??'';
const directory=path.join(path.resolve(process.env.TRADING_KEYS_DATA_DIRECTORY!),'combined-collectors');
const file=path.join(directory,`${pair.replace('/','_')}.json`);
fs.mkdirSync(directory,{recursive:true});
const previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')) as {runs?:number}:{};
let rowsWritten=0;
for(const [timeframe,seconds] of [['M5',300],['M15',900],['H1',3600]] as const){
  rowsWritten+=upsertArchivedCandles({pair,timeframe,mode:'demo'},[0,1].map(index=>({
    time:new Date(index*seconds*1000).toISOString(),candleIndex:index,open:1,high:1.1,low:.9,close:1,
  })));
}
const state={pair,pid:process.pid,runs:Number(previous.runs??0)+1,rowsWritten,stopped:false};
fs.writeFileSync(file,JSON.stringify(state,null,2));
const stop=()=>{state.stopped=true;fs.writeFileSync(file,JSON.stringify(state,null,2));process.exit(0)};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
setInterval(()=>undefined,60_000);
