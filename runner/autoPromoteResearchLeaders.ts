import fs from 'fs';
import path from 'path';
import {autoPromoteResearchLeaderToPi} from '../utils/autoResearchPiPromotion.ts';

const dataDirectory=path.resolve(process.env.TRADING_KEYS_DATA_DIRECTORY??path.join(process.cwd(),'data'));
fs.mkdirSync(dataDirectory,{recursive:true});
const lockPath=path.join(dataDirectory,'auto-research-promotion.pid');
const processAlive=(pid:number)=>{try{process.kill(pid,0);return true}catch{return false}};
if(fs.existsSync(lockPath)){
  const pid=Number(fs.readFileSync(lockPath,'utf8'));
  if(Number.isInteger(pid)&&processAlive(pid))process.exit(0);
  fs.rmSync(lockPath,{force:true});
}
fs.writeFileSync(lockPath,String(process.pid),{flag:'wx'});
const cleanup=()=>{try{if(fs.readFileSync(lockPath,'utf8')===String(process.pid))fs.rmSync(lockPath,{force:true})}catch{}};
process.once('exit',cleanup);process.once('SIGINT',()=>process.exit(0));process.once('SIGTERM',()=>process.exit(0));

while(true){
  try{await autoPromoteResearchLeaderToPi()}catch(error){console.error(`[auto-research-promotion] ${error instanceof Error?error.message:String(error)}`)}
  await new Promise(resolve=>setTimeout(resolve,30_000));
}
