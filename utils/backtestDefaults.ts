import type {BacktestRunConfig} from './backtestStore.ts';

export const manualBacktestDefaultsFromLeader=(leader?:BacktestRunConfig|null):Partial<BacktestRunConfig>=>{
  if(!leader)return {};
  return {
    ...leader,
    label:undefined,
    lookbackDays:365,
    archiveOnly:false,
    datasetEndTime:undefined,
    datasetKey:undefined,
    researchManifest:undefined,
  };
};
