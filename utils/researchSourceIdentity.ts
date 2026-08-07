import {execFileSync} from 'child_process';

export type ResearchSourceIdentity={
  codeRevision:string;
  sourceState:'clean'|'dirty'|'unknown';
};

const environmentRevision=()=>
  process.env.GIT_COMMIT_SHA?.trim()
  ||process.env.VERCEL_GIT_COMMIT_SHA?.trim()
  ||process.env.GITHUB_SHA?.trim()
  ||'';

export const getResearchSourceIdentity=():ResearchSourceIdentity=>{
  try{
    const codeRevision=environmentRevision()||execFileSync('git',['rev-parse','HEAD'],{
      cwd:process.cwd(),encoding:'utf8',stdio:['ignore','pipe','ignore'],
    }).trim();
    if(!codeRevision)return {codeRevision:'unknown',sourceState:'unknown'};
    try{
      const status=execFileSync('git',['status','--porcelain','--untracked-files=normal'],{
        cwd:process.cwd(),encoding:'utf8',stdio:['ignore','pipe','ignore'],
      }).trim();
      return {codeRevision,sourceState:status?'dirty':'clean'};
    }catch{
      return {codeRevision,sourceState:'unknown'};
    }
  }catch{
    const codeRevision=environmentRevision();
    return {codeRevision:codeRevision||'unknown',sourceState:'unknown'};
  }
};
