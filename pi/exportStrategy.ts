import { getAppliedAutomationStrategy } from '../utils/automationStore.ts';
import { createAutomationStrategyArtifact } from '../utils/automationStrategyArtifact.ts';
const applied=getAppliedAutomationStrategy();
console.log(JSON.stringify(createAutomationStrategyArtifact(applied),null,2));
