// src/index.ts
import { isForexMarketOpen } from '../utils/shared.ts';
import { isTradeSessionOpen } from '../utils/sessionUtils.ts';
import { forexPairs } from '../utils/constants.ts';
import { exec } from 'child_process';
import {
  startAllWorkers,
  stopAllWorkers,
  refreshWorkers
} from './strategyRunner.ts';
import { logMessage } from '../utils/automationLogger.ts';
import { startMarketDataHub, stopMarketDataHub } from '../utils/oanda/api/marketDataHub.ts';
import { closeAllTrades, isHolidayCloseWindow, isWeekendCloseWindow } from '../utils/marketCloseGuard.ts';

let marketOpen = false;
let forcedCloseWindow: 'weekend' | 'holiday' | null = null;
const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const mode = modeArg?.split('=')[1] === 'live' ? 'live' : 'demo';

const monitorMarket = async () => {
  const currentlyOpen = isForexMarketOpen();

  const closeWindow = isWeekendCloseWindow() ? 'weekend' : isHolidayCloseWindow() ? 'holiday' : null;
  if (closeWindow && forcedCloseWindow !== closeWindow) {
    await closeAllTrades(
      closeWindow === 'weekend' ? 'five-minute weekend close safety window' : 'holiday safety window',
      mode,
    );
    await stopAllWorkers();
    forcedCloseWindow = closeWindow;
  } else if (!closeWindow) {
    forcedCloseWindow = null;
  }
  if (closeWindow) {
    marketOpen = false;
    return;
  }
  
  if (currentlyOpen && !marketOpen) {
    logMessage("âœ… Market opened. Starting all strategy threads...");
    await startAllWorkers(mode);
    marketOpen = true;
  } else if (!currentlyOpen && marketOpen) {
    logMessage("ðŸ›‘ Market closed. Stopping all strategy threads...");
    stopAllWorkers();
    marketOpen = false;
  } else if (currentlyOpen && marketOpen) {
    const activePairs = forexPairs.filter(pair => isTradeSessionOpen(pair));
    await refreshWorkers(activePairs, mode);

    const sessionMsg = activePairs.length > 0
      ? `ðŸ” Active trading sessions: ${activePairs.join(', ')}`
      : "âš ï¸ No active trading sessions for any pairs right now.";

    logMessage(sessionMsg);
  } else if (!currentlyOpen && !marketOpen) {
    logMessage("â³ Market is still closed. Waiting to recheck in 1 minute...");
  }
};

const start = async () => {
  await startMarketDataHub(mode);
  logMessage(`Shared OANDA market-data hub ready for ${forexPairs.length} pairs on localhost.`);
  logMessage("ðŸ•“ Monitoring market open/close + session status...");
  await monitorMarket(); // initial immediate check
  setInterval(monitorMarket, 60_000); // check every 60 seconds
};

const shutdown = async () => {
  logMessage('ðŸ›‘ Caught SIGINT. Stopping all workers and exiting...');

  try {
    await stopMarketDataHub();
    await stopAllWorkers();
  } catch (err) {
    logMessage('âš ï¸ Error during cleanup:', err);
  }

  const isWindows = process.platform === 'win32';

  const killCommand = isWindows
    ? `powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*goldilocksWorker.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`
    : `pkill -f goldilocksWorker.ts`;

  exec(killCommand, (error, stdout, stderr) => {
    if (error) {
      logMessage(`âš ï¸ Kill command failed: ${error.message}`);
    } else {
      logMessage(`Successfully stopped Goldilocks worker subprocesses.`);
    }
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (process.argv.includes('--check')) {
  logMessage(`Automation modules loaded successfully in ${mode.toUpperCase()} mode.`);
} else {
  start().catch(error => {
    logMessage(`Failed to start shared OANDA market-data hub: ${(error as Error).message}`);
    process.exit(1);
  });
}
