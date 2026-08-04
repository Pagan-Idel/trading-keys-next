import fs from 'node:fs';
import { isForexMarketOpen } from '../utils/shared.ts';
import { forexPairs } from '../utils/constants.ts';
import { getEligibleWorkerPairs, refreshWorkers, startAllWorkers, startCandleCollectors, stopAllWorkers, stopCandleCollectors } from './strategyRunner.ts';
import { logMessage } from '../utils/automationLogger.ts';
import { startMarketDataHub, stopMarketDataHub } from '../utils/oanda/api/marketDataHub.ts';
import { closeAllTrades, isHolidayCloseWindow, isWeekendCloseWindow } from '../utils/marketCloseGuard.ts';
import { ensureHistoricalNewsCoverage } from '../utils/historicalNewsStore.ts';
import { getAppliedAutomationStrategy } from '../utils/automationStore.ts';

let marketOpen = false;
let forcedCloseWindow: 'weekend' | 'holiday' | null = null;
let monitorTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;
let newsCoverageWeek='';
let newsCoverageRefresh:Promise<void>|null=null;
const modeArg = process.argv.find(argument => argument.startsWith('--mode='));
const mode = modeArg?.split('=')[1] === 'live' ? 'live' : 'demo';
const fixtureMode = process.env.TRADING_KEYS_AUTOMATION_E2E === 'true';

const writeReady = () => {
  const target = process.env.TRADING_KEYS_RUNNER_READY_PATH;
  if (!target) return;
  fs.writeFileSync(target, JSON.stringify({ pid: process.pid, mode, readyAt: new Date().toISOString() }));
};
const monitorMarket = async () => {
  const nowDate=new Date();
  const weekStart=new Date(Date.UTC(nowDate.getUTCFullYear(),nowDate.getUTCMonth(),nowDate.getUTCDate()-nowDate.getUTCDay())).toISOString().slice(0,10);
  if(newsCoverageWeek!==weekStart&&!newsCoverageRefresh){
    newsCoverageRefresh=(async()=>{
      try{
      const now=Math.floor(Date.now()/1000);
      await ensureHistoricalNewsCoverage(now-35*86400,now+7*86400);
      newsCoverageWeek=weekStart;
      logMessage(`Historical news safety coverage checked for the current trading week; stored dates were reused.`);
      }catch(error){
        logMessage(`Historical news coverage refresh failed; affected setups remain paused: ${(error as Error).message}`);
      }finally{newsCoverageRefresh=null}
    })();
  }
  const currentlyOpen = isForexMarketOpen();
  const closeWindow = isWeekendCloseWindow() ? 'weekend' : isHolidayCloseWindow() ? 'holiday' : null;
  if (closeWindow && forcedCloseWindow !== closeWindow) {
    const closeWeekend=getAppliedAutomationStrategy().config.closeTradesBeforeWeekend!==false;
    if(closeWindow!=='weekend'||closeWeekend)
      await closeAllTrades(closeWindow === 'weekend' ? 'five-minute weekend close safety window' : 'holiday safety window', mode);
    await stopAllWorkers();
    await stopCandleCollectors();
    forcedCloseWindow = closeWindow;
  } else if (!closeWindow) forcedCloseWindow = null;
  if (closeWindow) { marketOpen = false; return {failed:[] as string[]}; }
  if (currentlyOpen) {
    const eligiblePairs = await getEligibleWorkerPairs();
    const enabledPairs=process.env.TRADING_KEYS_E2E_PAIRS?.split(',').map(value=>value.trim()).filter(Boolean)??forexPairs;
    await startCandleCollectors(mode,enabledPairs);
    const result=await refreshWorkers(eligiblePairs, mode);
    marketOpen = true;
    logMessage(`Active eligible trading sessions: ${eligiblePairs.join(', ') || 'none'}.`);
    return result;
  } else if (marketOpen) {
    await stopAllWorkers();
    await stopCandleCollectors();
    marketOpen = false;
  }
  return {failed:[] as string[]};
};
const start = async () => {
  if (fixtureMode) {
    const fixturePairs = process.env.TRADING_KEYS_E2E_PAIRS?.split(',').map(value => value.trim()).filter(Boolean) ?? forexPairs;
    if(process.env.TRADING_KEYS_COLLECTOR_ENTRY)await startCandleCollectors('demo',fixturePairs);
    const result=await startAllWorkers('demo', fixturePairs);
    if(result.failed.length)throw new Error(`Eligible fixture workers failed to start: ${result.failed.join(', ')}`);
    writeReady();
    monitorTimer = setInterval(() => undefined, 60_000);
    return;
  }
  await startMarketDataHub(mode);
  const initial=await monitorMarket();
  if(initial.failed.length)throw new Error(`Eligible workers failed to start: ${initial.failed.join(', ')}`);
  writeReady();
  monitorTimer = setInterval(() => void monitorMarket().catch(error =>
    logMessage(`Eligibility refresh failed closed: ${(error as Error).message}`)), 60_000);
};
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (monitorTimer) clearInterval(monitorTimer);
  try {
    if (!fixtureMode) await stopMarketDataHub();
    await stopAllWorkers();
    await stopCandleCollectors();
  } finally {
    const ready = process.env.TRADING_KEYS_RUNNER_READY_PATH;
    if (ready) fs.rmSync(ready, { force: true });
    process.exit(0);
  }
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

if (process.argv.includes('--check')) logMessage(`Automation modules loaded successfully in ${mode.toUpperCase()} mode.`);
else start().catch(error => {
  logMessage(`Failed to start demo automation safely: ${(error as Error).message}`);
  process.exit(1);
});
