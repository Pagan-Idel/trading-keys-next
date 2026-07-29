import fs from 'fs';
import { applyAutomationStrategy,getAppliedAutomationStrategy,getAutomationDashboard } from '../utils/automationStore.ts';
import { getAutomationCompatibility } from '../utils/automationStrategyPromotion.ts';
import { getAutomationRuntime } from '../utils/automationProcessManager.ts';
import { validateAutomationStrategyArtifact } from '../utils/automationStrategyArtifact.ts';

const file=process.argv[2];
if(!file)throw new Error('Usage: npm run pi:import-strategy -- /path/to/automation-strategy.json');
const payload=validateAutomationStrategyArtifact(JSON.parse(fs.readFileSync(file,'utf8')));
const compatibility=getAutomationCompatibility(payload.config);
if(!compatibility.compatible)throw new Error(compatibility.blockers.join(' '));
const current=getAppliedAutomationStrategy();
if(current.id===payload.versionId||current.sourceRunUid===payload.sourceRunUid){
  console.log(JSON.stringify({status:'already-active',strategy:current},null,2));
  process.exit(0);
}
if(Date.parse(payload.approvedAt)<=Date.parse(current.appliedAt))
  throw new Error(`Refusing strategy downgrade from ${current.appliedAt} to ${payload.approvedAt}.`);
if(getAutomationRuntime().running)throw new Error('Stop automation before activating an approved strategy artifact.');
if(getAutomationDashboard(1).activeTrades.length)
  throw new Error('An approved strategy artifact cannot activate while the automation ledger has an open trade.');
console.log(JSON.stringify(applyAutomationStrategy(payload.sourceRunUid,payload.config),null,2));
