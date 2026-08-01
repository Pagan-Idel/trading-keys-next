import fs from 'node:fs';
import path from 'node:path';
import { getAppliedAutomationStrategy } from '../../utils/automationStore.ts';

if(process.env.TRADING_KEYS_AUTOMATION_E2E!=='true')throw new Error('Lifecycle fixture requires automation E2E mode.');
globalThis.fetch=(async()=>{throw new Error('Real HTTP is forbidden in combined lifecycle E2E mode.')}) as typeof fetch;
const pair=process.argv[2]??'';
const directory=path.join(path.resolve(process.env.TRADING_KEYS_DATA_DIRECTORY!),'combined-workers');
const file=path.join(directory,`${pair.replace('/','_')}.json`);
fs.mkdirSync(directory,{recursive:true});
const previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')) as {runs?:number}:{};
const strategy=getAppliedAutomationStrategy();
const state={pair,pid:process.pid,runs:Number(previous.runs??0)+1,sourceRunUid:strategy.sourceRunUid,
  strategyId:strategy.id,orderAttempts:0,stopped:false};
fs.writeFileSync(file,JSON.stringify(state,null,2));
const stop=()=>{state.stopped=true;fs.writeFileSync(file,JSON.stringify(state,null,2));process.exit(0)};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
setInterval(()=>undefined,60_000);
