import { startAutoResearch } from '../utils/autoResearchRunner.ts';
import { assertResearchAllowed } from '../utils/piRuntimeGuard.ts';

assertResearchAllowed();
const argumentsSet=new Set(process.argv.slice(2));
const timeframeProfiles=argumentsSet.has('--lower-only')
  ?(['lowerTimeframe'] as const)
  :argumentsSet.has('--higher-only')
  ?(['higherTimeframe'] as const)
  :argumentsSet.has('--intraday-only')
    ?(['intraday'] as const)
    :undefined;
const result=startAutoResearch({continuous:true,timeframeProfiles:timeframeProfiles?[...timeframeProfiles]:undefined});
process.stdout.write(`${JSON.stringify({campaignId:result.id,status:result.status,trials:result.trials,datasetMode:'acquire-once-then-sealed-sqlite'},null,2)}\n`);
