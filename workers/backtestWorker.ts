import { executeBacktestRun } from '../utils/backtestRunner.ts';
import type { BacktestRunConfig } from '../utils/backtestStore.ts';

const id=process.argv[2];
const encoded=process.argv[3];
if(!id||!encoded)throw new Error('Backtest worker requires a run id and encoded configuration.');
const config=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')) as BacktestRunConfig;
await executeBacktestRun(id,config);
