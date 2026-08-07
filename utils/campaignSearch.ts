export type CampaignRunSearchRow={
  trialId?:string;
  status:string;
  backtestRunId:string|null;
};

export const selectCampaignRun=<T extends CampaignRunSearchRow>(runs:T[],matchedTrialId?:string)=>
  runs.find(run=>run.trialId===matchedTrialId&&Boolean(run.backtestRunId))
  ??runs.find(run=>run.status==='running'&&Boolean(run.backtestRunId))
  ??runs.find(run=>Boolean(run.backtestRunId));

export const includeRequestedCampaignRun=<T extends {id:unknown}>(recent:T[],requested:T|undefined,limit=30)=>
  requested&&!recent.some(item=>item.id===requested.id)
    ?[requested,...recent.slice(0,Math.max(0,limit-1))]
    :recent.slice(0,Math.max(0,limit));
