import fs from 'fs';
import path from 'path';
import { validateAutomationStrategyArtifact,type AutomationStrategyArtifact } from './automationStrategyArtifact';
import { getAutomationCompatibility } from './automationStrategyPromotion';

export type ApprovedStrategyManifest={
  schemaVersion:number;configurationId:string;createdAt:string;activatedAt:string;
  contentHash:string;artifact:AutomationStrategyArtifact;
};
export type StrategySyncResult={status:'current'|'staged';configurationId:string;stagedPath?:string};

const strategyDirectory=(dataDirectory=process.env.TRADING_KEYS_DATA_DIRECTORY??path.join(process.cwd(),'data'))=>
  path.resolve(dataDirectory,'approved-strategy');
export const stagedStrategyPath=(dataDirectory?:string)=>path.join(strategyDirectory(dataDirectory),'staged.json');
export const lastKnownGoodStrategyPath=(dataDirectory?:string)=>path.join(strategyDirectory(dataDirectory),'last-known-good.json');

const writeAtomic=(filePath:string,contents:string)=>{
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  const temporary=`${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary,contents,{encoding:'utf8',mode:0o600});
  fs.renameSync(temporary,filePath);
};

export const validateApprovedStrategyManifest=(value:unknown)=>{
  const manifest=value as Partial<ApprovedStrategyManifest>;
  if(manifest.schemaVersion!==1||!manifest.configurationId||!manifest.createdAt||!manifest.activatedAt||
    !manifest.contentHash||!manifest.artifact)throw new Error('Approved strategy manifest is malformed.');
  const artifact=validateAutomationStrategyArtifact(manifest.artifact);
  if(manifest.configurationId!==artifact.versionId||manifest.contentHash!==artifact.contentHash||
    manifest.createdAt!==artifact.createdAt||
    manifest.activatedAt!==artifact.approvedAt)throw new Error('Approved strategy manifest metadata does not match its artifact.');
  const createdAt=Date.parse(manifest.createdAt),activatedAt=Date.parse(manifest.activatedAt);
  if(!Number.isFinite(createdAt)||!Number.isFinite(activatedAt)||activatedAt<createdAt)
    throw new Error('Approved strategy manifest timestamps are invalid.');
  const compatibility=getAutomationCompatibility(artifact.config);
  if(!compatibility.compatible)throw new Error(compatibility.blockers.join(' '));
  return manifest as ApprovedStrategyManifest;
};

export const fetchAndStageApprovedStrategy=async(input:{
  endpoint:string;token:string;currentId:string;currentApprovedAt:string;dataDirectory?:string;
  fetcher?:typeof fetch;timeoutMs?:number;signal?:AbortSignal;
}):Promise<StrategySyncResult>=>{
  if(!input.token)throw new Error('Approved strategy synchronization requires a read-only bearer token.');
  const endpoint=new URL(input.endpoint);
  if(endpoint.protocol!=='https:')throw new Error('Approved strategy synchronization requires HTTPS.');
  const timeout=AbortSignal.timeout(input.timeoutMs??15_000);
  const signal=input.signal?AbortSignal.any([timeout,input.signal]):timeout;
  const response=await (input.fetcher??fetch)(endpoint,{headers:{Authorization:`Bearer ${input.token}`},signal});
  if(!response.ok)throw new Error(`Approved strategy synchronization failed with HTTP ${response.status}.`);
  const manifest=validateApprovedStrategyManifest(await response.json());
  if(manifest.configurationId===input.currentId)return {status:'current',configurationId:input.currentId};
  const staged=readStagedApprovedStrategy(input.dataDirectory);
  if(staged?.versionId===manifest.configurationId)
    return {status:'current',configurationId:manifest.configurationId};
  const newestKnownApproval=Math.max(Date.parse(input.currentApprovedAt),
    staged?Date.parse(staged.approvedAt):Number.NEGATIVE_INFINITY);
  if(Date.parse(manifest.activatedAt)<=newestKnownApproval)
    throw new Error('Approved strategy synchronization refused a downgrade.');
  const destination=stagedStrategyPath(input.dataDirectory);
  writeAtomic(destination,JSON.stringify(manifest.artifact,null,2));
  return {status:'staged',configurationId:manifest.configurationId,stagedPath:destination};
};

export const readStagedApprovedStrategy=(dataDirectory?:string)=>{
  const file=stagedStrategyPath(dataDirectory);
  if(!fs.existsSync(file))return null;
  return validateAutomationStrategyArtifact(JSON.parse(fs.readFileSync(file,'utf8')));
};

export const preserveLastKnownGood=(artifact:AutomationStrategyArtifact,dataDirectory?:string)=>
  writeAtomic(lastKnownGoodStrategyPath(dataDirectory),JSON.stringify(artifact,null,2));

export const clearStagedApprovedStrategy=(dataDirectory?:string)=>fs.rmSync(stagedStrategyPath(dataDirectory),{force:true});
