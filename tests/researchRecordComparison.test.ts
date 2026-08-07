import assert from 'node:assert/strict';
import test from 'node:test';
import {compareResearchRecords} from '../utils/researchRecordComparison';

const record=(overrides:Record<string,unknown>={})=>({config:{
  label:'Leader control',minimumScore:12,datasetKey:'data-a',datasetEndTime:100,
  strategyTweaks:{maximumPriorTouches:3},
  researchManifest:{capturedAt:'first',versions:{strategy:'v4',codeRevision:'abc',sourceState:'clean'}},
  ...overrides,
}});

test('research comparison separates dataset changes from strategy settings',()=>{
  const comparison=compareResearchRecords(record(),record({datasetKey:'data-b',datasetEndTime:175,researchManifest:{capturedAt:'second',versions:{strategy:'v4',codeRevision:'abc',sourceState:'clean'}}}));
  assert.equal(comparison.settingsMatch,true);
  assert.equal(comparison.datasetChanged,true);
  assert.equal(comparison.cutoffDeltaSeconds,75);
  assert.equal(comparison.codeComparison,'same');
});

test('research comparison reports setting and source changes',()=>{
  const comparison=compareResearchRecords(record(),record({minimumScore:14,researchManifest:{capturedAt:'second',versions:{strategy:'v4',codeRevision:'def',sourceState:'dirty'}}}));
  assert.deepEqual(comparison.changedSettings,['minimumScore']);
  assert.equal(comparison.settingsMatch,false);
  assert.equal(comparison.codeComparison,'different');
});

test('historical records without a captured revision remain explicitly unknown',()=>{
  const comparison=compareResearchRecords(record({researchManifest:{capturedAt:'first',versions:{strategy:'v4'}}}),record({researchManifest:{capturedAt:'second',versions:{strategy:'v4'}}}));
  assert.equal(comparison.settingsMatch,true);
  assert.equal(comparison.codeComparison,'unknown');
});
