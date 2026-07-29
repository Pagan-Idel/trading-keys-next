import { spawn,execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const waitFor=async(url,timeout=15_000)=>{
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    if(await fetch(url).then(response=>response.ok).catch(()=>false))return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error(`Startup timed out for ${url}`);
};
const rssForPid=pid=>{
  if(process.platform==='win32')return Number(execFileSync('powershell',['-NoProfile','-Command',
    `(Get-Process -Id ${pid}).WorkingSet64`],{encoding:'utf8'}).trim());
  return Number(fs.readFileSync(`/proc/${pid}/statm`,'utf8').split(' ')[1])*4096;
};
const measure=async(name,args,port)=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),`trading-keys-${name}-`));
  const started=performance.now();
  const child=spawn(process.execPath,args,{cwd:process.cwd(),stdio:'ignore',
    env:{...process.env,PULSE_HOST:'127.0.0.1',PULSE_PORT:String(port),TRADING_KEYS_DATA_DIRECTORY:data}});
  try{
    await waitFor(`http://127.0.0.1:${port}/api/status`);
    await new Promise(resolve=>setTimeout(resolve,250));
    return {name,startupMs:performance.now()-started,idleRssBytes:rssForPid(child.pid),pid:child.pid};
  }finally{
    child.kill('SIGTERM');
  }
};
if(!fs.existsSync('artifacts/pi-runtime/controlServer.mjs'))
  throw new Error('Run npm run build:pi-runtime first.');
const source=await measure('tsx',['--import','tsx','pi/controlServer.ts'],4681);
const compiled=await measure('compiled',['--enable-source-maps','artifacts/pi-runtime/controlServer.mjs'],4682);
const directorySize=directory=>fs.readdirSync(directory,{withFileTypes:true}).reduce((sum,entry)=>
  sum+(entry.isDirectory()?directorySize(path.join(directory,entry.name)):fs.statSync(path.join(directory,entry.name)).size),0);
console.log(JSON.stringify({source,compiled,compiledCodeBytes:directorySize('artifacts/pi-runtime'),
  deltas:{startupMs:compiled.startupMs-source.startupMs,idleRssBytes:compiled.idleRssBytes-source.idleRssBytes}},null,2));
