import { createHash } from 'crypto';
import type { BacktestRunConfig } from './backtestStore';
import type { AppliedAutomationStrategy } from './automationStore';

export const AUTOMATION_STRATEGY_ARTIFACT_SCHEMA=1;

const stable=(value:unknown):string=>{
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value as Record<string,unknown>)
    .filter(([,item])=>item!==undefined).sort(([left],[right])=>left.localeCompare(right))
    .map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
};

export const automationStrategyContentHash=(config:BacktestRunConfig)=>
  `sha256:${createHash('sha256').update(stable(config)).digest('hex')}`;

export type AutomationStrategyArtifact={
  schemaVersion:number;
  versionId:string;
  sourceRunUid:string;
  createdAt:string;
  approvedAt:string;
  contentHash:string;
  config:BacktestRunConfig;
};

export const createAutomationStrategyArtifact=(strategy:AppliedAutomationStrategy):AutomationStrategyArtifact=>({
  schemaVersion:AUTOMATION_STRATEGY_ARTIFACT_SCHEMA,
  versionId:strategy.id,
  sourceRunUid:strategy.sourceRunUid,
  createdAt:strategy.appliedAt,
  approvedAt:strategy.appliedAt,
  contentHash:automationStrategyContentHash(strategy.config),
  config:strategy.config,
});

export const validateAutomationStrategyArtifact=(value:unknown):AutomationStrategyArtifact=>{
  const artifact=value as Partial<AutomationStrategyArtifact>;
  if(artifact.schemaVersion!==AUTOMATION_STRATEGY_ARTIFACT_SCHEMA)
    throw new Error(`Unsupported automation strategy artifact schema ${String(artifact.schemaVersion)}.`);
  if(!artifact.versionId||!artifact.sourceRunUid||!artifact.createdAt||!artifact.approvedAt||!artifact.config)
    throw new Error('Automation strategy artifact is missing required approval metadata.');
  const expected=automationStrategyContentHash(artifact.config);
  if(artifact.contentHash!==expected)throw new Error('Automation strategy artifact content hash is invalid.');
  return artifact as AutomationStrategyArtifact;
};
