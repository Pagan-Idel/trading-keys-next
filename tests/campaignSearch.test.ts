import assert from 'node:assert/strict';
import test from 'node:test';
import {includeRequestedCampaignRun,selectCampaignRun} from '../utils/campaignSearch';

test('campaign search prefers the specifically matched research trial',()=>{
  const runs=[
    {trialId:'first',status:'completed',backtestRunId:'run-1'},
    {trialId:'second',status:'completed',backtestRunId:'run-2'},
  ];
  assert.equal(selectCampaignRun(runs,'second')?.backtestRunId,'run-2');
});

test('campaign search prefers a linked running run then falls back to completed evidence',()=>{
  const runs=[
    {trialId:'queued',status:'queued',backtestRunId:null},
    {trialId:'complete',status:'completed',backtestRunId:'run-1'},
    {trialId:'active',status:'running',backtestRunId:'run-2'},
  ];
  assert.equal(selectCampaignRun(runs)?.backtestRunId,'run-2');
});

test('an older searched campaign is retained beside the bounded recent history',()=>{
  const recent=Array.from({length:30},(_,index)=>({id:`recent-${index}`}));
  const rows=includeRequestedCampaignRun(recent,{id:'searched'},30);
  assert.equal(rows.length,30);
  assert.equal(rows[0].id,'searched');
  assert.equal(rows.some(row=>row.id==='recent-29'),false);
});
