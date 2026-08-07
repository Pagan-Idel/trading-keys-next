export const GOLDILOCKS_COMPARISON_YEAR = 2025;
export const GOLDILOCKS_COMPARISON_START_TIME =
  Date.UTC(GOLDILOCKS_COMPARISON_YEAR, 0, 1) / 1000;
export const GOLDILOCKS_COMPARISON_END_TIME =
  Date.UTC(GOLDILOCKS_COMPARISON_YEAR + 1, 0, 1) / 1000;
export const GOLDILOCKS_COMPARISON_LOOKBACK_DAYS = 365;
export const GOLDILOCKS_COMPARISON_DATASET_PREFIX =
  "goldilocks-2025-utc-v1";

export const isGoldilocksComparisonCandleTime = (epochSeconds: number) =>
  epochSeconds >= GOLDILOCKS_COMPARISON_START_TIME &&
  epochSeconds < GOLDILOCKS_COMPARISON_END_TIME;

export const isGoldilocksComparisonDataset = (config: {
  datasetStartTime?: unknown;
  datasetEndTime?: unknown;
  lookbackDays?: unknown;
  datasetKey?: unknown;
}) =>
  Number(config.datasetStartTime) === GOLDILOCKS_COMPARISON_START_TIME &&
  Number(config.datasetEndTime) === GOLDILOCKS_COMPARISON_END_TIME &&
  Number(config.lookbackDays) === GOLDILOCKS_COMPARISON_LOOKBACK_DAYS &&
  String(config.datasetKey ?? "").startsWith(
    GOLDILOCKS_COMPARISON_DATASET_PREFIX,
  );

export const goldilocksComparisonDatasetFields = (datasetKey?: unknown) => ({
  lookbackDays: GOLDILOCKS_COMPARISON_LOOKBACK_DAYS,
  archiveOnly: true,
  datasetStartTime: GOLDILOCKS_COMPARISON_START_TIME,
  datasetEndTime: GOLDILOCKS_COMPARISON_END_TIME,
  datasetKey: String(datasetKey ?? "").startsWith(
    GOLDILOCKS_COMPARISON_DATASET_PREFIX,
  )
    ? String(datasetKey)
    : GOLDILOCKS_COMPARISON_DATASET_PREFIX,
});

export const GOLDILOCKS_COMPARISON_WINDOW_LABEL =
  "2025 UTC · Jan 1 inclusive–Jan 1, 2026 exclusive";
