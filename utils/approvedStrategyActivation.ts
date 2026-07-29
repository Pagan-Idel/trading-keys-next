import { applyAutomationStrategy,getAppliedAutomationStrategy,getAutomationDashboard,recordAutomationEvent } from './automationStore';
import { getAutomationRuntime } from './automationProcessManager';
import { createAutomationStrategyArtifact } from './automationStrategyArtifact';
import { clearStagedApprovedStrategy,preserveLastKnownGood,readStagedApprovedStrategy } from './approvedStrategySync';

export const activateStagedApprovedStrategy=(dataDirectory?:string)=>{
  const staged=readStagedApprovedStrategy(dataDirectory);
  if(!staged)return {status:'none' as const,strategy:getAppliedAutomationStrategy()};
  const current=getAppliedAutomationStrategy();
  if(staged.versionId===current.id||staged.sourceRunUid===current.sourceRunUid){
    clearStagedApprovedStrategy(dataDirectory);
    return {status:'current' as const,strategy:current};
  }
  if(getAutomationRuntime().running)throw new Error('Approved strategy activation requires a stopped automation lifecycle.');
  if(getAutomationDashboard(1).activeTrades.length)throw new Error('Approved strategy activation is blocked by an open trade.');
  if(Date.parse(staged.approvedAt)<=Date.parse(current.appliedAt))throw new Error('Approved strategy activation refused a downgrade.');
  preserveLastKnownGood(createAutomationStrategyArtifact(current),dataDirectory);
  const strategy=applyAutomationStrategy(staged.sourceRunUid,staged.config);
  clearStagedApprovedStrategy(dataDirectory);
  recordAutomationEvent({source:'strategy-sync',step:'strategy_sync_activated',
    message:`Approved strategy ${staged.sourceRunUid} activated at the stopped-worker lifecycle boundary.`,
    data:{remoteVersionId:staged.versionId,localVersionId:strategy.id}});
  return {status:'activated' as const,strategy};
};
