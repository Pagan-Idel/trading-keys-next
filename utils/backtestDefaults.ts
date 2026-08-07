import type {BacktestRunConfig} from './backtestStore.ts';
import {goldilocksComparisonDatasetFields} from './comparisonDataset.ts';

export const manualBacktestDefaultsFromLeader=(leader?:BacktestRunConfig|null):Partial<BacktestRunConfig>=>{
  if(!leader)return {};
  return {
    ...leader,
    label:undefined,
    ...goldilocksComparisonDatasetFields(),
    researchManifest:undefined,
  };
};
