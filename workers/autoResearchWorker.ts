import { executeAutoResearchCampaign } from '../utils/autoResearchRunner.ts';

const campaignId=process.argv[2];
if(!campaignId)throw new Error('Auto research worker requires a campaign ID.');

await executeAutoResearchCampaign(campaignId);
