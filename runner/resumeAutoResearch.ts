import { recoverOrStartAutoResearch } from '../utils/autoResearchRunner.ts';
import { assertResearchAllowed } from '../utils/piRuntimeGuard.ts';

assertResearchAllowed();
const result=recoverOrStartAutoResearch({continuous:true});
process.stdout.write(`${JSON.stringify(result)}\n`);
