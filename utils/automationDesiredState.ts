import fs from 'node:fs';
import path from 'node:path';

export type AutomationDesiredState = {
  desiredState: 'running' | 'stopped';
  mode: 'demo';
  updatedAt: string;
  requestedBy: string;
  revision: number;
};

const dataDirectory = () => path.resolve(process.env.TRADING_KEYS_DATA_DIRECTORY ?? path.join(process.cwd(), 'data'));
export const desiredStatePath = () => path.join(dataDirectory(), 'automation-desired-state.json');
const desiredStateLockPath = () => path.join(dataDirectory(), 'automation-desired-state.lock');
const bootId=()=>{
  if(process.env.TRADING_KEYS_TEST_BOOT_ID)return process.env.TRADING_KEYS_TEST_BOOT_ID;
  try{return fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()}catch{return `platform:${process.platform}`}
};

const valid = (value: unknown): value is AutomationDesiredState => {
  const row = value as Partial<AutomationDesiredState> | null;
  return Boolean(row && (row.desiredState === 'running' || row.desiredState === 'stopped') &&
    row.mode === 'demo' && typeof row.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt)) &&
    typeof row.requestedBy === 'string' && row.requestedBy.length > 0 &&
    Number.isSafeInteger(row.revision) && Number(row.revision) > 0);
};

export const readAutomationDesiredState = (): AutomationDesiredState => {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(desiredStatePath(), 'utf8'));
    if (valid(parsed)) return parsed;
  } catch {
    // Missing and malformed state both fail closed.
  }
  return {
    desiredState: 'stopped', mode: 'demo', updatedAt: new Date(0).toISOString(),
    requestedBy: 'fail-closed-default', revision: 0,
  };
};

export const writeAutomationDesiredState = (
  desiredState: 'running' | 'stopped',
  requestedBy: string,
): AutomationDesiredState => {
  const target = desiredStatePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const lock=desiredStateLockPath();
  const acquire=()=>{
    try{
      fs.mkdirSync(lock,{mode:0o700});
      fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,bootId:bootId()}),{mode:0o600});
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      let active=false;
      try{
        const owner=JSON.parse(fs.readFileSync(path.join(lock,'owner.json'),'utf8')) as {pid?:number;bootId?:string};
        if(owner.bootId===bootId()&&Number.isSafeInteger(owner.pid)){
          try{process.kill(owner.pid!,0);active=true}catch{/* stale owner */}
        }
      }catch{
        try{active=Date.now()-fs.statSync(lock).mtimeMs<5_000}catch{/* removed concurrently */}
      }
      if(active)throw new Error('Another desired-state update is already in progress.');
      fs.rmSync(lock,{recursive:true,force:true});
      acquire();
    }
  };
  acquire();
  let temporary='';
  try{
    const previous = readAutomationDesiredState();
    const next: AutomationDesiredState = {
      desiredState, mode: 'demo', updatedAt: new Date().toISOString(), requestedBy,
      revision: previous.revision + 1,
    };
    if(process.env.TRADING_KEYS_TEST_DESIRED_STATE_WRITE_FAILURE==='true')
      throw new Error('Injected desired-state persistence failure.');
    temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, target);
    return next;
  }finally{
    if(temporary)fs.rmSync(temporary,{force:true});
    fs.rmSync(lock,{recursive:true,force:true});
  }
};
