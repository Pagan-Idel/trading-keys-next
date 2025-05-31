// src/startRunner.ts
import { isForexMarketOpen } from '../utils/shared.js';
import { startAllWorkers } from './threadManager.js';

const args = process.argv.slice(2);
const modeArg = args.find(arg => arg.startsWith('--mode='));
export const loginMode = modeArg?.split('=')[1] ?? 'demo'; // fallback to demo
// make to change this back to !
const start = () => {
  if (isForexMarketOpen()) {
    console.log("🛑 Market is closed. Will not start trading.");
    return;
  }

  console.log("✅ Market is open. Starting all strategy threads...");
  startAllWorkers();
};

start();
