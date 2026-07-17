# Goldilocks code map

Read the complete contracts in `docs/GOLDILOCKS_STRATEGY.md` and
`docs/AI_TRAINING_AND_RESEARCH.md` first.

- Configuration: `utils/goldilocksConfig.ts`
- Detector/lifecycle/runway: `utils/goldilocksStrategy.ts`
- Structure/trend/range/confluence: `utils/goldilocksScanner.ts`
- Score: `utils/goldilocksScoring.ts`
- Live worker: `workers/goldilocksWorker.ts`
- Runner: `runner/startRunner.ts`, `runner/strategyRunner.ts`
- Guards: `utils/spreadGuard.ts`, `utils/sessionUtils.ts`, `utils/newsGuard.ts`,
  `utils/marketCloseGuard.ts`
- Execution: `utils/placeTrade.ts`, `utils/oanda/api/`
- Persistence: `utils/automationStore.ts`, `utils/backtestStore.ts`
- Backtest: `utils/goldilocksBacktest.ts`, `utils/backtestRunner.ts`
- UI: `pages/automation.tsx`, `pages/strategy-lab.tsx`, `pages/backtesting.tsx`
- Tests: `tests/goldilocksStrategy.test.ts`
