import { fetchCandles } from '../utils/oanda/api/fetchCandles.ts';
import { cancelPriceStreamIdleStop, fetchPriceOnce, isStreamInitialized, schedulePriceStreamIdleStop, setMarketDataInterest, startPriceStream, stopPriceStream, waitForFreshPrice } from '../utils/oanda/api/priceStreamManager.ts';
import { openNow, type Trade } from '../utils/oanda/api/openNow.ts';
import { getTradeDetailsById } from '../utils/oanda/api/getTradeDetails.ts';
import { modifyTrade, replaceTradeProtection } from '../utils/oanda/api/modifyTrade.ts';
import { closeTrade } from '../utils/oanda/api/closeTrade.ts';
import { closeTradePartial } from '../utils/oanda/api/close-partial.ts';
import { ACTION } from '../utils/oanda/orderTypes.ts';
import { placeTrade } from '../utils/placeTrade.ts';
import { annotateConfluenceAt, buildGoldilocksHistory, buildGoldilocksHistoryChunked, findFreshGoldilocksConfirmations, getGoldilocksTrend, toStrategyCandles } from '../utils/goldilocksScanner.ts';
import { getGoldilocksZoneFormationWindow, validateFinalEntryAfterEngulf, validateGoldilocksEntryProximity, validateGoldilocksFinalExecutableEntry } from '../utils/goldilocksStrategy.ts';
import { getHistoricalNewsGateForRange } from '../utils/historicalNewsStore.ts';
import { evaluateSpread } from '../utils/spreadGuard.ts';
import { isTradeSessionOpen } from '../utils/sessionUtils.ts';
import { isInHighImpactNewsWindow, getActiveNewsEvent, getNewsGuardError } from '../utils/newsGuard.ts';
import { getPrecision, isForexMarketOpen, normalizePairKeyUnderscore, wait } from '../utils/shared.ts';
import { isHolidayCloseWindow, isWeekendCloseWindow, isWeekendLiquidationWindow } from '../utils/marketCloseGuard.ts';
import { clearActiveTrade, getActiveTrade, getAppliedAutomationStrategy, getAutomationZoneSnapshot, getRiskProfile, getZoneLifecycle, persistZoneLifecycle, recordTradeManagementEvent, saveAutomationZoneSnapshot, setActiveTrade, updateWorkerStatus } from '../utils/automationStore.ts';
import { logMessage } from '../utils/automationLogger.ts';
import { classifyTradeOutcome, saveTradeRecord, type JournalData } from '../utils/tradeHistory.ts';
import { GOLDILOCKS_DEMO_TIMEFRAMES, GOLDILOCKS_LIVE_CANDLE_LIMITS, GOLDILOCKS_TIMEFRAME_SECONDS, getGoldilocksMinimumScore } from '../utils/goldilocksConfig.ts';
import { scoreGoldilocksSetup, type GoldilocksScoreResult } from '../utils/goldilocksScoring.ts';
import { calculateScoreRisk, type RiskProfile } from '../utils/dynamicRisk.ts';
import { formatGoldilocksZoneAge, getGoldilocksZoneAgeDays, getGoldilocksZoneAgeSeconds } from '../utils/zoneAge.ts';
import { measureGoldilocksApproachPressure, type GoldilocksApproachPressure } from '../utils/approachPressure.ts';
import { measureZoneCorridor, type ZoneCorridorMeasurement } from '../utils/zoneCorridor.ts';
import type { TradePathSummary } from '../utils/tradeManagementResearch.ts';
import { getHeapStatistics } from 'v8';
import { pruneOldestSetEntries,workerScanJitterMs } from '../utils/workerRuntime.ts';
import { getArchivedCandleBounds, readArchivedCandles } from '../utils/candleArchive.ts';
import { transitionZoneLifecycle,type ZoneLifecycleRecord } from '../utils/zoneLifecycle.ts';
import {
  GOLDILOCKS_DEFAULT_MANAGEMENT,
  calculateAtr,
  getGoldilocksAtrTrailingStop,
  getGoldilocksPartialClosePlan,
} from '../utils/goldilocksTradeManagement.ts';

const TREND_TIMEFRAME = GOLDILOCKS_DEMO_TIMEFRAMES.trend;
const ZONE_TIMEFRAME = GOLDILOCKS_DEMO_TIMEFRAMES.zone;
const CONFIRMATION_TIMEFRAME = GOLDILOCKS_DEMO_TIMEFRAMES.confirmation;
const CONFIRMATION_SECONDS = GOLDILOCKS_TIMEFRAME_SECONDS[CONFIRMATION_TIMEFRAME];
const CANDLE_CLOSE_GRACE_MS = 350;
const ZONE_CANDLE_COUNT = 5_000;
const CONFIRMATION_CANDLE_COUNT = 500;

const pair = process.argv[2] ?? '';
const modeArg = process.argv.find(argument => argument.startsWith('--mode='));
const mode: 'live' | 'demo' = modeArg?.split('=')[1] === 'live' ? 'live' : 'demo';
const usesSharedMarketDataHub = Boolean(process.env.OANDA_MARKET_DATA_HUB_URL);
const marketDataOwner=`worker-${process.pid}-${pair}`;
const appliedStrategy=getAppliedAutomationStrategy();
const minimumScore = Number(appliedStrategy.config.minimumScore??getGoldilocksMinimumScore());

let killed = false;
const shutdownController=new AbortController();
let cachedHistory: ReturnType<typeof buildGoldilocksHistory> | null = null;
let cachedPrimaryTime = '';
let cachedConfirmationCandles: Awaited<ReturnType<typeof fetchCandles>> | null = null;
const attemptedConfirmations = new Set<string>();
const ATTEMPTED_CONFIRMATION_LIMIT=2_000;
const MEMORY_TELEMETRY_INTERVAL_MS=15*60*1000;
let lastMemoryTelemetryAt=0;
const readWorkingCandles=(timeframe:string,count=GOLDILOCKS_LIVE_CANDLE_LIMITS[timeframe])=>{
  const bounds=getArchivedCandleBounds({pair,timeframe,mode});
  if(bounds.endTime===null)return [];
  const seconds=GOLDILOCKS_TIMEFRAME_SECONDS[timeframe];
  return readArchivedCandles({pair,timeframe,mode},Math.max(0,bounds.endTime-seconds*Math.max(1,count-1)),bounds.endTime+seconds);
};

const rememberAttemptedConfirmation=(key:string)=>{
  attemptedConfirmations.add(key);
  pruneOldestSetEntries(attemptedConfirmations,ATTEMPTED_CONFIRMATION_LIMIT);
};

const logMemoryTelemetry=()=>{
  const now=Date.now();
  if(now-lastMemoryTelemetryAt<MEMORY_TELEMETRY_INTERVAL_MS)return;
  lastMemoryTelemetryAt=now;
  const memory=process.memoryUsage(),heap=getHeapStatistics();
  logMessage(`WORKER MEMORY | ${pair} | RSS ${(memory.rss/1024/1024).toFixed(1)} MiB | heap ${(memory.heapUsed/1024/1024).toFixed(1)} MiB.`,{
    rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,heapTotalBytes:memory.heapTotal,
    externalBytes:memory.external,arrayBuffersBytes:memory.arrayBuffers,
    heapSizeLimitBytes:heap.heap_size_limit,attemptedConfirmationCount:attemptedConfirmations.size,
  },{pair,fileName:'goldilocksWorker',step:'worker_memory'});
};

const stop = () => {
  killed = true;
  shutdownController.abort(new DOMException('Worker shutting down','AbortError'));
  if (!usesSharedMarketDataHub) void stopPriceStream(pair, mode);
  else void setMarketDataInterest(pair,false,marketDataOwner);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

export const millisecondsUntilNextConfirmationClose = (now = Date.now()) => {
  const intervalMs = CONFIRMATION_SECONDS * 1_000;
  return (Math.floor(now / intervalMs) + 1) * intervalMs - now + CANDLE_CLOSE_GRACE_MS+
    workerScanJitterMs(pair);
};

const loadConfirmationCandles = async () => {
  cachedConfirmationCandles=readWorkingCandles(CONFIRMATION_TIMEFRAME,CONFIRMATION_CANDLE_COUNT);
  return cachedConfirmationCandles;
};

const hasPairTrade = (trades: Trade[]) => trades.some(trade =>
  normalizePairKeyUnderscore(trade.instrument ?? '') === normalizePairKeyUnderscore(pair),
);

const tradeManagerLog = (
  step: string,
  message: string,
  data?: unknown,
  level: 'info' | 'warn' | 'error' = 'info',
) => {
  logMessage(message, data, { pair, level, fileName: 'goldilocksTradeManager', step });
  if(data&&typeof data==='object'&&'tradeId' in data&&typeof (data as {tradeId?:unknown}).tradeId==='string'){
    recordTradeManagementEvent({tradeId:(data as {tradeId:string}).tradeId,pair,mode,step,policyId:GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,data:{message,level,...data}});
  }
};

const journalFor = (
  direction: 'BUY' | 'SELL',
  spread: ReturnType<typeof evaluateSpread>,
  zone: { id: string; kind: string; side: string; low: number; high: number; touches: number; candleTime: number },
  confirmationTime: number,
  score?: GoldilocksScoreResult,
  risk?: { profile: RiskProfile; riskPercentage: number },
  approachPressure?: GoldilocksApproachPressure,
  zoneCorridors?: ZoneCorridorMeasurement[],
): JournalData => {
  const zoneAgeSeconds=getGoldilocksZoneAgeSeconds(zone.candleTime,confirmationTime+CONFIRMATION_SECONDS);
  return ({
  direction,
  rrZone: { low: zone.low, high: zone.high },
  spread: {
    bid: String(spread.bid), ask: String(spread.ask), raw: spread.rawSpread,
    buffer: 0, pipSize: spread.pipSize,
  },
  tf: `${TREND_TIMEFRAME}/${ZONE_TIMEFRAME}/${CONFIRMATION_TIMEFRAME}/${GOLDILOCKS_DEMO_TIMEFRAMES.execution}`,
  timestamp: new Date().toISOString(),
  goldilocks: {
    zoneId: zone.id, kind: zone.kind, side: zone.side, touches: zone.touches,
    candleTime: zone.candleTime, confirmationTime, zoneAgeSeconds, score,
    riskProfile: risk?.profile, riskPercentage: risk?.riskPercentage,
    approachPressure,zoneCorridors,
  },
  } as JournalData);
};

const recordClosedTrade = async (trade: Trade, journal: JournalData, breakEvenActivated: boolean) => {
  if (!trade.id) return;
  let details = null;
  for (let attempt = 1; attempt <= 5 && !details; attempt += 1) {
    details = await getTradeDetailsById(trade.id, mode);
    if (!details && attempt < 5) await wait(2_000);
  }
  const realizedPL = details?.realizedPL;
  const outcome = classifyTradeOutcome(realizedPL, breakEvenActivated);
  await saveTradeRecord(
    trade.id,
    pair,
    Number(trade.price ?? 0),
    Number(trade.stopLossOrder?.price ?? 0),
    Number(trade.takeProfitOrder?.price ?? 0),
    Number(trade.currentUnits ?? 0) > 0 ? 'BUY' : 'SELL',
    journal,
    outcome,
    realizedPL,
    mode,
    breakEvenActivated,
  );
  if (breakEvenActivated && Number(realizedPL ?? 0) <= 0) {
    tradeManagerLog('trade_manager_protected_win', `PROTECTED WIN · ${pair} reached +1R, moved to break-even, and later closed without a profit.`, { tradeId: trade.id, realizedPL, breakEvenActivated });
  }
  tradeManagerLog(
    outcome === 'WIN' ? 'trade_manager_win' : 'trade_manager_loss',
    `${outcome === 'WIN' ? 'WIN BANKED' : 'TRADE CLOSED'} · ${pair} ${Number(trade.currentUnits ?? 0) > 0 ? 'BUY' : 'SELL'} · realized P/L ${realizedPL ?? 'unavailable'} · saved to history.`,
    { tradeId: trade.id, outcome, realizedPL, breakEvenActivated, brokerTrade: details },
    outcome === 'WIN' ? 'info' : 'warn',
  );
  return { outcome, realizedPL };
};

const monitorTrade = async (trade: Trade, journal: JournalData) => {
  if (!trade.id) return;
  if(usesSharedMarketDataHub)await setMarketDataInterest(pair,true,marketDataOwner);
  const direction: 'BUY' | 'SELL' = Number(trade.currentUnits ?? 0) > 0 ? 'BUY' : 'SELL';
  const entry = Number(trade.price ?? 0);
  const stopLoss = Number(trade.stopLossOrder?.price ?? 0);
  const takeProfit = Number(trade.takeProfitOrder?.price ?? 0);
  const storedTrade = getActiveTrade(pair);
  const precision = getPrecision(pair);
  const priceTolerance = 0.5 * 10 ** -precision;
  let managedStopLoss = stopLoss;
  let breakEvenActivated = Math.abs(stopLoss - entry) <= priceTolerance;
  const initialPartialPlan = getGoldilocksPartialClosePlan(
    trade.initialUnits,
    trade.currentUnits,
  );
  let partialProfitTaken = initialPartialPlan.completed;
  let partialUnitsClosed = partialProfitTaken
    ? Math.max(
        0,
        initialPartialPlan.initialUnits - initialPartialPlan.currentUnits,
      )
    : 0;
  const originalStopRisk = Math.abs(entry - stopLoss);
  const retainedTarget = takeProfit || Number(storedTrade?.takeProfit ?? 0);
  const targetDerivedRisk = Math.abs(retainedTarget - entry) / 2;
  const riskDistance = breakEvenActivated ? targetDerivedRisk : originalStopRisk;
  let lastBreakEvenAttempt = 0;
  let lastPartialCloseAttempt = 0;
  let partialUnsupportedLogged = false;
  let takeProfitRemoved = !trade.takeProfitOrder;
  let favorableExtreme = entry;
  let trailingAtr: number | null = null;
  let lastAtrRefresh = 0;
  let lastTrailingAttempt = 0;
  const price = (value: number) => Number.isFinite(value) ? value.toFixed(precision) : 'unavailable';
  journal.tradeManagement = {
    breakEvenAtOneR: true,
    policyId:GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,
    breakEvenActivated,
    breakEvenPrice: entry,
    partialProfitAtOneR: true,
    partialCloseFraction: GOLDILOCKS_DEFAULT_MANAGEMENT.partialCloseFraction,
    partialProfitTaken,
    partialUnitsClosed,
    ...(partialProfitTaken
      ? { partialProfitTakenAt: new Date().toISOString() }
      : {}),
    ...(breakEvenActivated ? { breakEvenActivatedAt: new Date().toISOString() } : {}),
  };
  setActiveTrade({
    tradeId: trade.id, pair,
    direction,
    entry,
    stopLoss: stopLoss || undefined,
    takeProfit: retainedTarget || undefined,
    mode,
    score: journal.goldilocks?.score?.total,
    riskProfile: journal.goldilocks?.riskProfile,
    riskPercentage: journal.goldilocks?.riskPercentage,
  });
  tradeManagerLog(
    'trade_manager_armed',
    `MANAGER ARMED · ${direction} ${pair} · entry ${price(entry)} · at +1R bank 50%, remove TP, and trail the remainder with 2x ATR(14).`,
    { tradeId: trade.id, direction, entry, stopLoss: managedStopLoss, retainedTarget, riskDistance, currentUnits:trade.currentUnits, breakEvenActivated, partialProfitTaken, mode },
  );
  tradeManagerLog(
    breakEvenActivated ? 'trade_manager_break_even' : 'trade_manager_break_even_armed',
    breakEvenActivated
      ? `PROFIT PROTECTION ACTIVE · broker stop is at entry ${price(entry)}${partialProfitTaken ? ' and the 50% partial is already banked' : ''}.`
      : `PROFIT PROTECTION ARMED · at +1.00R the broker stop moves to entry ${price(entry)} before 50% is closed.`,
    { tradeId: trade.id, entry, stopLoss, riskDistance, breakEvenActivated, partialProfitTaken },
  );
  updateWorkerStatus(pair, 'in_trade', 'monitoring_trade', `Monitoring Goldilocks trade ${trade.id}. New entries are disabled.`, mode);
  const reachedProfitMilestones = new Set<number>();
  const reachedRiskMilestones = new Set<number>();
  const profitMilestones = [0.25, 0.5, 1, 1.5];
  const riskMilestones = [0.25, 0.5, 0.75];
  let brokerUnavailable = false;
  let lastHeartbeat = Date.now();
  let lastWeekendCloseAttempt = 0;
  let coverageStartTime:number|null=null;
  let coverageEndTime:number|null=null;
  let quoteCount=0;
  let mfeR=Number.NEGATIVE_INFINITY;
  let maeR=Number.POSITIVE_INFINITY;
  let endingR=0;
  const firstReachedAt:Record<string,number>={};
  while (!killed) {
    if(usesSharedMarketDataHub)await setMarketDataInterest(pair,true,marketDataOwner);
    if(isWeekendLiquidationWindow()&&Date.now()-lastWeekendCloseAttempt>=60_000){
      lastWeekendCloseAttempt=Date.now();
      tradeManagerLog('trade_manager_weekend_liquidation', `WEEKEND LIQUIDATION · closing ${pair} before the Friday market close to avoid carrying the position over the weekend.`, {tradeId:trade.id,cutoffTimeZone:'America/New_York',cutoffHour:16}, 'warn');
      const closed=await closeTrade({action:ACTION.CLOSE,pair},pair,undefined,mode);
      if(closed){
        journal.tradeManagement={
          ...journal.tradeManagement,
          breakEvenAtOneR:true,
          policyId:GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,
          breakEvenActivated,
          partialProfitAtOneR:true,
          partialCloseFraction:GOLDILOCKS_DEFAULT_MANAGEMENT.partialCloseFraction,
          partialProfitTaken,
          partialUnitsClosed,
          weekendLiquidation:true,
          weekendLiquidatedAt:new Date().toISOString(),
        };
        tradeManagerLog('trade_manager_weekend_closed', `WEEKEND EXIT SUBMITTED · ${pair} was closed before the weekly market shutdown.`, {tradeId:trade.id,mode,brokerResponse:closed});
        break;
      }
      tradeManagerLog('trade_manager_weekend_close_retry', `WEEKEND EXIT DELAYED · broker did not accept the ${pair} close request; retrying while the market remains open.`, {tradeId:trade.id,mode}, 'error');
    }
    const open = await openNow(pair, mode,shutdownController.signal);
    if (!open) {
      if (!brokerUnavailable) {
        brokerUnavailable = true;
        tradeManagerLog('trade_manager_connection', 'BROKER CHECK DELAYED · keeping the trade ledger intact and retrying safely.', { tradeId: trade.id }, 'warn');
      }
      await wait(15_000);
      continue;
    }
    if (brokerUnavailable) {
      brokerUnavailable = false;
      tradeManagerLog('trade_manager_connection', 'BROKER CONNECTION RESTORED · trade monitoring resumed.', { tradeId: trade.id });
    }
    const managedTrade = open.trades.find(
      (item) =>
        item.id === trade.id ||
        normalizePairKeyUnderscore(item.instrument ?? '') ===
          normalizePairKeyUnderscore(pair),
    );
    if (!managedTrade) {
      tradeManagerLog('trade_manager_closing', 'BROKER REPORTS TRADE CLOSED · resolving the final result and realized P/L.', { tradeId: trade.id });
      break;
    }
    const brokerPartialPlan = getGoldilocksPartialClosePlan(
      managedTrade.initialUnits ?? trade.initialUnits,
      managedTrade.currentUnits,
    );
    if (brokerPartialPlan.completed && !partialProfitTaken) {
      partialProfitTaken = true;
      partialUnitsClosed = Math.max(
        0,
        brokerPartialPlan.initialUnits - brokerPartialPlan.currentUnits,
      );
      journal.tradeManagement = {
        ...journal.tradeManagement!,
        partialProfitTaken: true,
        partialProfitTakenAt: new Date().toISOString(),
        partialUnitsClosed,
      };
      tradeManagerLog(
        'trade_manager_partial_recovered',
        `PARTIAL PROFIT CONFIRMED · broker position is already reduced to ${brokerPartialPlan.currentUnits} units.`,
        { tradeId: trade.id, partialPlan: brokerPartialPlan },
      );
    }
    const quote = await fetchPriceOnce(pair, mode);
    if (quote && riskDistance > 0) {
      const currentPrice = direction === 'BUY' ? Number(quote.bid) : Number(quote.ask);
      const favorableMove = direction === 'BUY' ? currentPrice - entry : entry - currentPrice;
      const progressR = favorableMove / riskDistance;
      const quoteTime=Math.floor(Date.now()/1000);
      coverageStartTime??=quoteTime;coverageEndTime=quoteTime;quoteCount+=1;endingR=progressR;
      mfeR=Math.max(mfeR,progressR);maeR=Math.min(maeR,progressR);
      for(const milestone of [-.75,-.5,-.25,.25,.5,1,1.5,2,3,4]){
        const key=`${milestone>=0?'+':''}${milestone}R`;
        if((milestone>=0?progressR>=milestone:progressR<=milestone)&&firstReachedAt[key]===undefined)firstReachedAt[key]=quoteTime;
      }
      if (
        !breakEvenActivated &&
        (partialProfitTaken ||
          progressR >= GOLDILOCKS_DEFAULT_MANAGEMENT.breakEvenAtR) &&
        Date.now() - lastBreakEvenAttempt >= 60_000
      ) {
        lastBreakEvenAttempt = Date.now();
        const result = await modifyTrade({ action: ACTION.SLatEntry, pair }, trade.id, mode);
        if (result.success) {
          breakEvenActivated = true;
          managedStopLoss = entry;
          journal.tradeManagement = {
            breakEvenAtOneR: true,
            policyId:GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,
            breakEvenActivated: true,
            breakEvenActivatedAt: new Date().toISOString(),
            breakEvenPrice: entry,
            partialProfitAtOneR:true,
            partialCloseFraction:GOLDILOCKS_DEFAULT_MANAGEMENT.partialCloseFraction,
            partialProfitTaken,
            partialUnitsClosed,
          };
          setActiveTrade({ tradeId: trade.id, pair, direction, entry, stopLoss: entry, takeProfit: retainedTarget || undefined, mode });
          tradeManagerLog('trade_manager_break_even', `BREAK-EVEN LOCKED · ${pair} reached +1.00R · broker stop moved to entry ${price(entry)} before the partial close.`, { tradeId: trade.id, entry, currentPrice, progressR, brokerResponse:result.raw });
        } else {
          tradeManagerLog('trade_manager_break_even_retry', `BREAK-EVEN MOVE DELAYED · ${pair} reached +1.00R but the broker did not accept the stop update; retrying safely.`, { tradeId: trade.id, reason: result.reason }, 'warn');
        }
      }
      if (
        breakEvenActivated &&
        !partialProfitTaken &&
        progressR >= GOLDILOCKS_DEFAULT_MANAGEMENT.partialAtR &&
        Date.now() - lastPartialCloseAttempt >= 60_000
      ) {
        lastPartialCloseAttempt = Date.now();
        const partialPlan = getGoldilocksPartialClosePlan(
          managedTrade.initialUnits ?? trade.initialUnits,
          managedTrade.currentUnits,
        );
        if (!partialPlan.supported || partialPlan.unitsToClose < 1) {
          if (!partialUnsupportedLogged) {
            partialUnsupportedLogged = true;
            tradeManagerLog(
              'trade_manager_partial_unsupported',
              `PARTIAL CLOSE UNAVAILABLE · ${pair} position is too small to split safely; the full position remains protected at break-even.`,
              { tradeId: trade.id, partialPlan },
              'warn',
            );
          }
        } else {
          const partialResult = await closeTradePartial(
            trade.id,
            partialPlan.unitsToClose,
            mode,
          );
          if ('errorMessage' in partialResult) {
            tradeManagerLog(
              'trade_manager_partial_retry',
              `PARTIAL CLOSE DELAYED · ${pair} reached +1.00R but the broker did not accept the 50% close; break-even remains active and the partial will retry at or above +1R.`,
              { tradeId: trade.id, partialPlan, reason: partialResult.errorMessage },
              'warn',
            );
          } else {
            partialProfitTaken = true;
            partialUnitsClosed += partialPlan.unitsToClose;
            journal.tradeManagement = {
              ...journal.tradeManagement!,
              partialProfitTaken: true,
              partialProfitTakenAt: new Date().toISOString(),
              partialUnitsClosed,
            };
            tradeManagerLog(
              'trade_manager_partial_profit',
              `PROFIT BANKED · ${pair} closed ${partialPlan.unitsToClose} units at approximately +1.00R · the remainder has no take-profit and will trail with ATR(14).`,
              { tradeId: trade.id, currentPrice, progressR, partialPlan, brokerResponse: partialResult },
            );
          }
        }
      }
      if (partialProfitTaken && breakEvenActivated) {
        favorableExtreme = direction === 'BUY'
          ? Math.max(favorableExtreme, currentPrice)
          : Math.min(favorableExtreme, currentPrice);
        if (Date.now() - lastAtrRefresh >= 5 * 60_000 || trailingAtr === null) {
          lastAtrRefresh = Date.now();
          try {
            trailingAtr = calculateAtr(await fetchCandles(
              pair,
              CONFIRMATION_TIMEFRAME,
              GOLDILOCKS_DEFAULT_MANAGEMENT.trailingAtrPeriod + 1,
              undefined,
              undefined,
              mode,
              shutdownController.signal,
            ));
          } catch (error) {
            tradeManagerLog('trade_manager_atr_retry', `ATR refresh delayed; ${pair} keeps its current protected stop.`, {
              tradeId: trade.id,
              error: error instanceof Error ? error.message : String(error),
            }, 'warn');
          }
        }
        if (trailingAtr && Date.now() - lastTrailingAttempt >= 60_000) {
          const proposedStop = getGoldilocksAtrTrailingStop({
            direction,
            entry,
            currentStop: managedStopLoss,
            favorableExtreme,
            atr: trailingAtr,
          });
          const minimumImprovement = 10 ** -precision;
          const improves = direction === 'BUY'
            ? proposedStop >= managedStopLoss + minimumImprovement
            : proposedStop <= managedStopLoss - minimumImprovement;
          if (improves || !takeProfitRemoved) {
            lastTrailingAttempt = Date.now();
            const result = await replaceTradeProtection(
              trade.id,
              improves ? proposedStop : managedStopLoss,
              true,
              mode,
            );
            if (result.success) {
              managedStopLoss = improves ? proposedStop : managedStopLoss;
              takeProfitRemoved = true;
              setActiveTrade({
                tradeId: trade.id, pair, direction, entry,
                stopLoss: managedStopLoss,
                takeProfit: retainedTarget || undefined,
                mode,
              });
              tradeManagerLog('trade_manager_atr_trail', `RUNNER TRAIL UPDATED · ${pair} stop ${price(managedStopLoss)} · ATR(14) ${price(trailingAtr)} · broker TP removed.`, {
                tradeId: trade.id, managedStopLoss, trailingAtr,
                favorableExtreme, currentPrice, progressR,
              });
            } else {
              tradeManagerLog('trade_manager_atr_trail_retry', `Runner update delayed; ${pair} keeps its existing protected stop.`, {
                tradeId: trade.id, reason: result.reason,
              }, 'warn');
            }
          }
        }
      }
      const newProfit = profitMilestones.filter(value => progressR >= value && !reachedProfitMilestones.has(value)).at(-1);
      if (newProfit !== undefined) {
        profitMilestones.filter(value => value <= newProfit).forEach(value => reachedProfitMilestones.add(value));
        tradeManagerLog('trade_manager_progress', `PROGRESS UNLOCKED · ${pair} reached +${newProfit.toFixed(2)}R · current ${price(currentPrice)}${partialProfitTaken ? ` · runner stop ${price(managedStopLoss)}` : ''}.`, { tradeId: trade.id, currentPrice, progressR });
      }
      const drawdownR = Math.max(0, -progressR);
      const newRisk = riskMilestones.filter(value => drawdownR >= value && !reachedRiskMilestones.has(value)).at(-1);
      if (newRisk !== undefined) {
        riskMilestones.filter(value => value <= newRisk).forEach(value => reachedRiskMilestones.add(value));
        tradeManagerLog('trade_manager_risk', `RISK WATCH · ${pair} reached -${newRisk.toFixed(2)}R · current ${price(currentPrice)} · protected stop ${price(stopLoss)}.`, { tradeId: trade.id, currentPrice, progressR }, 'warn');
      }
      if (Date.now() - lastHeartbeat >= 5 * 60 * 1000) {
        lastHeartbeat = Date.now();
        tradeManagerLog('trade_manager_heartbeat', `MANAGER CHECK-IN · ${pair} is still open at ${price(currentPrice)} · ${progressR >= 0 ? '+' : ''}${progressR.toFixed(2)}R progress.`, { tradeId: trade.id, currentPrice, progressR });
      }
    }
    await wait(15_000);
  }
  const path:TradePathSummary={coverageStartTime,coverageEndTime,candleCount:quoteCount,mfeR:Number.isFinite(mfeR)?mfeR:0,maeR:Number.isFinite(maeR)?maeR:0,endingR,firstReachedAt,ambiguousCandles:[]};
  journal.tradeManagement={...journal.tradeManagement!,policyId:GOLDILOCKS_DEFAULT_MANAGEMENT.policyId,partialProfitTaken,partialUnitsClosed,path};
  tradeManagerLog('trade_manager_path_summary',`MANAGEMENT PATH SAVED · ${pair} sampled ${quoteCount} executable quotes · MFE ${path.mfeR.toFixed(2)}R · MAE ${path.maeR.toFixed(2)}R.`,{tradeId:trade.id,path});
  if (!killed) {
    await recordClosedTrade(trade, journal, breakEvenActivated);
    clearActiveTrade(pair);
    updateWorkerStatus(pair, 'scanning', 'trade_closed', 'Trade closed and was added to Goldilocks history.', mode);
  } else {
    tradeManagerLog('trade_manager_paused', 'MANAGER HANDOFF · service is stopping; the broker-side stop and target remain active and will be recovered on restart.', { tradeId: trade.id }, 'warn');
  }
  if(usesSharedMarketDataHub)await setMarketDataInterest(pair,false,marketDataOwner);
};

const recoverOpenTrade = async () => {
  const open = await openNow(pair, mode,shutdownController.signal);
  const trade = open?.trades.find(item => hasPairTrade([item]));
  if (!trade) {
    clearActiveTrade(pair);
    return false;
  }
  const emptySpread = evaluateSpread(pair, 1, 1.00001);
  const journal: JournalData = {
    direction: Number(trade.currentUnits ?? 0) > 0 ? 'BUY' : 'SELL',
    rrZone: {
      low: Number(trade.stopLossOrder?.price ?? 0),
      high: Number(trade.takeProfitOrder?.price ?? 0),
    },
    spread: { bid: '', ask: '', raw: 0, buffer: 0, pipSize: emptySpread.pipSize },
    tf: `${TREND_TIMEFRAME}/${ZONE_TIMEFRAME}/${CONFIRMATION_TIMEFRAME}/${GOLDILOCKS_DEMO_TIMEFRAMES.execution}`,
    timestamp: trade.openTime ?? new Date().toISOString(),
  };
  tradeManagerLog('trade_manager_recovered', `TRADE RECOVERED · found open broker trade ${trade.id}; restoring the dashboard ledger and manager.`, { tradeId: trade.id, openedAt: trade.openTime });
  await monitorTrade(trade, journal);
  return true;
};

const loadZoneHistory = async () => {
  const primaryTime=getArchivedCandleBounds({pair,timeframe:ZONE_TIMEFRAME,mode}).endTime?.toString()??'';
  if (cachedHistory && primaryTime === cachedPrimaryTime) return cachedHistory;
  const candles=readWorkingCandles(ZONE_TIMEFRAME);
  const history = buildGoldilocksHistoryChunked(candles, 1_000, 200, { trackTouches:false });
  cachedHistory = { candles: toStrategyCandles(candles), legs: [], history };
  cachedPrimaryTime = primaryTime;
  return cachedHistory;
};

const loadScoringContext = async (zone: Parameters<typeof annotateConfluenceAt>[0], time: number, entry:number, direction:'BUY'|'SELL',stopLoss:number,takeProfit:number) => {
  const snapshots = await Promise.all(GOLDILOCKS_DEMO_TIMEFRAMES.confluence.map(async timeframe => {
    if (timeframe === ZONE_TIMEFRAME && cachedHistory) return { timeframe, history: cachedHistory.history, candles: [],strategyCandles:cachedHistory.candles };
    const candles=readWorkingCandles(timeframe);
    return { timeframe, history: buildGoldilocksHistoryChunked(candles, 1_000, 200), candles,strategyCandles:toStrategyCandles(candles) };
  }));
  const trendCandles = snapshots.find(snapshot => snapshot.timeframe === TREND_TIMEFRAME)?.candles ?? [];
  return {
    zone: annotateConfluenceAt(zone, ZONE_TIMEFRAME, time, snapshots),
    trend: getGoldilocksTrend(trendCandles.slice(-5_000), time),
    zoneCorridors:snapshots.map(snapshot=>measureZoneCorridor({pair,timeframe:snapshot.timeframe,measuredAt:time+CONFIRMATION_SECONDS,entry,stopLoss,takeProfit,zones:snapshot.history.zones,candles:snapshot.strategyCandles})),
  };
};

const safetyBlockReason = async (): Promise<string | null> => {
  if (!isForexMarketOpen()) return 'Forex market is closed or today is configured as a no-trade holiday.';
  if (isWeekendCloseWindow()) return 'Weekly close/reopen safety window is active: entries stop Friday 16:00 New York and resume Sunday 18:00 New York.';
  if (isHolidayCloseWindow()) return 'Holiday safety window is active.';
  if (!isTradeSessionOpen(pair)) return 'Neither currency is in an active trading session.';
  if (await isInHighImpactNewsWindow(pair)) {
    const event = getActiveNewsEvent(pair);
    return event
      ? `High-impact news safety window: ${event.currency} ${event.title}.`
      : `News safety status is unavailable${getNewsGuardError() ? `: ${getNewsGuardError()}` : '.'}`;
  }
  return null;
};

const scan = async () => {
  logMemoryTelemetry();
  updateWorkerStatus(pair, 'scanning', 'loading_zones', `Scanning ${ZONE_TIMEFRAME} Goldilocks zones and ${CONFIRMATION_TIMEFRAME} confirmation candles.`, mode);
  const snapshot = await loadZoneHistory();
  for(const zone of snapshot.history.zones){
    let lifecycle=getZoneLifecycle(pair,zone.id)??{zoneId:zone.id,pair,state:'DISCOVERED',updatedAt:Date.now()} as ZoneLifecycleRecord;
    lifecycle=zone.state==='expired'
      ?transitionZoneLifecycle(lifecycle,{type:'expire',reason:'Zone age exceeded the executable lifecycle limit.'})
      :zone.state==='invalidated'
        ?transitionZoneLifecycle(lifecycle,{type:'invalidate',reason:'Completed price invalidated the zone.'})
        :transitionZoneLifecycle(lifecycle,{type:'departure_confirmed'});
    persistZoneLifecycle(lifecycle);
  }
  const confirmationRaw = await loadConfirmationCandles();
  const confirmationCandles = toStrategyCandles(confirmationRaw);
  const confirmations = findFreshGoldilocksConfirmations(snapshot.history, confirmationCandles, CONFIRMATION_SECONDS,Date.now(),snapshot.candles,GOLDILOCKS_TIMEFRAME_SECONDS[ZONE_TIMEFRAME]);
  const setups=confirmations.map(confirmation=>{
    const touchIndex=confirmationCandles.findIndex(candle=>candle.time===confirmation.touchCandle.time);
    const confirmationIndex=confirmationCandles.findIndex(candle=>candle.time===confirmation.confirmationCandle.time);
    return {zone:confirmation.zone,touchCandle:confirmation.touchCandle,confirmationCandle:confirmation.confirmationCandle,
      approachPressure:touchIndex>=0&&confirmationIndex>touchIndex?measureGoldilocksApproachPressure(confirmation.zone,confirmationCandles,touchIndex,confirmationIndex):undefined};
  });
  const trendCandles=readWorkingCandles(TREND_TIMEFRAME);
  const executionCandles=readWorkingCandles(GOLDILOCKS_DEMO_TIMEFRAMES.execution,500);
  const snapshotSetups=setups.length?setups:getActiveTrade(pair)
    ?((getAutomationZoneSnapshot(pair)?.setups??[]) as typeof setups):[];
  saveAutomationZoneSnapshot({
    pair,mode,scannedAt:new Date().toISOString(),trend:getGoldilocksTrend(trendCandles.slice(-5_000)),
    zoneTimeframe:ZONE_TIMEFRAME,confirmationTimeframe:CONFIRMATION_TIMEFRAME,
    zones:snapshot.history.activeZones.filter(zone=>zone.kind==='base'),
    candles:{[ZONE_TIMEFRAME]:snapshot.candles.slice(-400),[CONFIRMATION_TIMEFRAME]:confirmationCandles.slice(-500),
      [TREND_TIMEFRAME]:toStrategyCandles(trendCandles).slice(-400),[GOLDILOCKS_DEMO_TIMEFRAMES.execution]:toStrategyCandles(executionCandles).slice(-500)},
    confirmationCount:confirmations.length,setups:snapshotSetups,
  });
  const blocked = await safetyBlockReason();
  if (blocked) {
    updateWorkerStatus(pair, 'paused', 'safety_guard', blocked, mode);
    return;
  }
  if (!confirmations.length) {
    if(!usesSharedMarketDataHub)schedulePriceStreamIdleStop(pair,mode);
    else await setMarketDataInterest(pair,false,marketDataOwner);
    updateWorkerStatus(pair, 'waiting', 'waiting_for_confirmation', `No fresh ${CONFIRMATION_TIMEFRAME} close-through confirmation is ready.`, mode);
    return;
  }
  const open = await openNow(pair, mode,shutdownController.signal);
  if(!open){updateWorkerStatus(pair,'waiting','broker_unavailable','Could not verify whether a trade is already open.',mode);return}
  if(hasPairTrade(open.trades)){await recoverOpenTrade();return}

  for (const confirmation of confirmations) {
    if(usesSharedMarketDataHub)await setMarketDataInterest(pair,true,marketDataOwner);
    if(!usesSharedMarketDataHub){
      cancelPriceStreamIdleStop(pair,mode);
      if(!isStreamInitialized(pair,mode))startPriceStream(pair,mode);
      if(!await waitForFreshPrice(pair,mode,5_000)){updateWorkerStatus(pair,'waiting','stream_unavailable','Fresh pricing stream is unavailable near entry.',mode);return}
    }
    const key = `${confirmation.zone.id}:${confirmation.confirmationCandle.time}`;
    let lifecycle=getZoneLifecycle(pair,confirmation.zone.id)??{zoneId:confirmation.zone.id,pair,state:'ACTIVE_FAR',updatedAt:Date.now()} as ZoneLifecycleRecord;
    if(['EXECUTED','INVALIDATED','EXPIRED'].includes(lifecycle.state)||lifecycle.touchKey===key)continue;
    lifecycle=transitionZoneLifecycle(lifecycle,{type:'approach'});lifecycle=transitionZoneLifecycle(lifecycle,{type:'arm'});
    lifecycle=transitionZoneLifecycle(lifecycle,{type:'touch',touchKey:key});persistZoneLifecycle(lifecycle);
    if (attemptedConfirmations.has(key)) continue;
    const formationWindow=getGoldilocksZoneFormationWindow(confirmation.zone,GOLDILOCKS_TIMEFRAME_SECONDS[ZONE_TIMEFRAME]);
    const formationNewsGate=getHistoricalNewsGateForRange(pair,formationWindow.start,formationWindow.end);
    if(!formationNewsGate.allowed){
      rememberAttemptedConfirmation(key);
      logMessage(`ZONE FORMATION NEWS REJECTED · ${pair} · ${formationNewsGate.reason}`,{zoneId:confirmation.zone.id,formationWindow,event:formationNewsGate.event},{pair,level:'warn',fileName:'goldilocksWorker',step:'zone_formation_news_rejected'});
      updateWorkerStatus(pair,'waiting','zone_formation_news_rejected',formationNewsGate.reason,mode);
      continue;
    }
    if (!confirmation.proximity.allowed) {
      rememberAttemptedConfirmation(key);
      logMessage(`ENTRY PROXIMITY REJECTED · ${pair} · ${confirmation.proximity.reason}`, {
        zoneId:confirmation.zone.id,
        touchTime:confirmation.touchCandle.time,
        confirmationTime:confirmation.confirmationCandle.time,
        proximity:confirmation.proximity,
      }, { pair, level:'warn', fileName:'goldilocksWorker', step:'entry_proximity_rejected' });
      updateWorkerStatus(pair, 'waiting', 'entry_proximity_rejected', confirmation.proximity.reason, mode);
      continue;
    }
    const quote = await fetchPriceOnce(pair, mode);
    if (!quote?.bid || !quote?.ask) {
      updateWorkerStatus(pair, 'waiting', 'quote_unavailable', 'Fresh executable bid/ask quote is unavailable.', mode);
      return;
    }
    const spread = evaluateSpread(pair, Number(quote.bid), Number(quote.ask));
    if (!spread.allowed) {
      updateWorkerStatus(pair, 'waiting', 'spread_rejected', spread.reason, mode);
      return;
    }
    const direction = confirmation.zone.side === 'demand' ? ACTION.BUY : ACTION.SELL;
    const liveEntry = direction === ACTION.BUY ? spread.ask : spread.bid;
    const liveProximity=validateGoldilocksEntryProximity(
      confirmation.zone,
      confirmation.touchCandle,
      confirmation.confirmationCandle.close,
      liveEntry,
    );
    if(!liveProximity.allowed){
      rememberAttemptedConfirmation(key);
      logMessage(`ENTRY PROXIMITY REJECTED · ${pair} · ${liveProximity.reason}`, {
        zoneId:confirmation.zone.id,
        touchTime:confirmation.touchCandle.time,
        confirmationTime:confirmation.confirmationCandle.time,
        liveEntry,
        proximity:liveProximity,
      }, { pair, level:'warn', fileName:'goldilocksWorker', step:'entry_proximity_rejected' });
      updateWorkerStatus(pair, 'waiting', 'entry_proximity_rejected', liveProximity.reason, mode);
      continue;
    }
    const finalCheck = validateFinalEntryAfterEngulf(
      confirmation.zone,
      snapshot.history.activeZones,
      confirmation.confirmationCandle.close,
      liveEntry,
    );
    if (!finalCheck.allowed) {
      rememberAttemptedConfirmation(key);
      updateWorkerStatus(pair, 'waiting', 'runway_rejected', finalCheck.reason, mode);
      continue;
    }

    const scoringContext = await loadScoringContext(confirmation.zone, confirmation.confirmationCandle.time,finalCheck.entry,direction,finalCheck.stopLoss,finalCheck.takeProfit);
    const entryEligibilityTime=confirmation.confirmationCandle.time+CONFIRMATION_SECONDS;
    const zoneAgeSeconds=getGoldilocksZoneAgeSeconds(scoringContext.zone.candleTime,entryEligibilityTime);
    const touchIndex=confirmationCandles.findIndex(candle=>candle.time===confirmation.touchCandle.time);
    const confirmationIndex=confirmationCandles.findIndex(candle=>candle.time===confirmation.confirmationCandle.time);
    const approachPressure=touchIndex>=0&&confirmationIndex>touchIndex
      ?measureGoldilocksApproachPressure(
        scoringContext.zone,
        confirmationCandles,
        touchIndex,
        confirmationIndex,
      )
      :undefined;
    const score = scoreGoldilocksSetup({
      zone: scoringContext.zone,
      tradeDirection: direction,
      trend: scoringContext.trend,
      minimumScore,
      purityTouches:confirmation.priorTouches,
      adverseWarningCount:approachPressure?.adversePressureScore??0,
      gates: [
        { name: 'Zone validity', passed: true, reason: 'Zone is active, unbroken, unexpired, and within the touch limit.' },
        { name: 'Confirmation freshness', passed: true, reason: `${CONFIRMATION_TIMEFRAME} confirmation is the latest completed candle.` },
        { name: 'Entry proximity', passed: true, reason: liveProximity.reason },
        { name: 'Zone formation news', passed: true, reason: formationNewsGate.reason },
        { name: '2:1 runway', passed: true, reason: finalCheck.reason },
        { name: 'Spread', passed: true, reason: spread.reason },
        { name: 'Session and news', passed: true, reason: 'Session is active and no news/market safety window is blocking.' },
        { name: 'One trade per pair', passed: true, reason: 'Broker confirms no open trade for this pair.' },
      ],
    });
    logMessage(`PURITY CHECK · ${pair} · ${scoringContext.zone.touches} qualifying prior touch candle(s).`, { zoneId:scoringContext.zone.id,touches:scoringContext.zone.touches }, { pair, fileName:'goldilocksWorker', step:'purity_measured' });
    logMessage(`ZONE AGE · ${pair} · ${formatGoldilocksZoneAge(zoneAgeSeconds)} from M15 base to entry eligibility.`, { zoneId:scoringContext.zone.id,zoneCandleTime:scoringContext.zone.candleTime,confirmationTime:confirmation.confirmationCandle.time,entryEligibilityTime,zoneAgeSeconds,zoneAgeDays:getGoldilocksZoneAgeDays(zoneAgeSeconds) }, { pair, fileName:'goldilocksWorker', step:'zone_age_measured' });
    logMessage(`AVAILABLE RRR · ${pair} · ${Number.isFinite(finalCheck.availableRatio)?finalCheck.availableRatio.toFixed(2):'unlimited'}R before the stored opposing zone.`, { zoneId:scoringContext.zone.id,availableReward:finalCheck.availableReward,availableRatio:finalCheck.availableRatio,entry:finalCheck.entry,stopLoss:finalCheck.stopLoss }, { pair, fileName:'goldilocksWorker', step:'available_rrr_measured' });
    logMessage(`POINT CHECK · ${pair} scored ${score.total}/${score.minimumScore} · ZIZ ${scoringContext.zone.timeframeConfluence?.timeframeCount ?? 1}/3 · ${TREND_TIMEFRAME} trend ${scoringContext.trend}.`, score, { pair, fileName: 'goldilocksWorker', step: 'score_complete' });
    if(approachPressure)logMessage(
      `APPROACH PRESSURE · ${pair} · ${approachPressure.adversePressureScore}/2 adverse signals · confirmation ${approachPressure.weakConfirmation?'FAIL':'PASS'} at ${(approachPressure.confirmationStrengthScore*100).toFixed(1)}% · ${approachPressure.adversePressureFlags.join(', ')||'none'}.`,
      {zoneId:scoringContext.zone.id,touchTime:confirmation.touchCandle.time,confirmationTime:confirmation.confirmationCandle.time,approachPressure},
      {pair,fileName:'goldilocksWorker',step:'approach_pressure_measured'},
    );
    logMessage(
      `ZONE CORRIDOR · ${pair} · normalized demand-to-supply space captured for ${GOLDILOCKS_DEMO_TIMEFRAMES.confluence.join('/')}.`,
      {zoneId:scoringContext.zone.id,confirmationTime:confirmation.confirmationCandle.time,zoneCorridors:scoringContext.zoneCorridors},
      {pair,fileName:'goldilocksWorker',step:'zone_corridor_measured'},
    );
    if (!score.eligible) {
      rememberAttemptedConfirmation(key);
      logMessage(
        `TRADE SKIPPED · ${pair} scored ${score.total}/20; minimum ${score.minimumScore}/20 required. No order was placed.`,
        {
          score: score.total,
          minimumScore: score.minimumScore,
          components: score.components,
          zoneId: scoringContext.zone.id,
          confirmationTime: confirmation.confirmationCandle.time,
        },
        { pair, level: 'warn', fileName: 'goldilocksWorker', step: 'score_rejected' },
      );
      updateWorkerStatus(pair, 'waiting', 'score_rejected', score.reason, mode);
      continue;
    }

    const riskDecision = calculateScoreRisk(score.total, score.minimumScore, getRiskProfile());
    logMessage(
      `DYNAMIC RISK | ${pair} | ${score.total}/20 uses ${riskDecision.riskPercentage.toFixed(3)}% account equity (${riskDecision.profile} profile).`,
      riskDecision,
      { pair, fileName: 'goldilocksWorker', step: 'dynamic_risk_sized' },
    );

    // Recheck all volatile guards directly before broker submission.
    const finalBlock = await safetyBlockReason();
    const finalOpen = await openNow(pair, mode,shutdownController.signal);
    if (finalBlock || !finalOpen || hasPairTrade(finalOpen.trades)) {
      updateWorkerStatus(pair, 'waiting', 'final_safety_rejected', finalBlock ?? 'A trade opened before submission.', mode);
      return;
    }
    rememberAttemptedConfirmation(key);
    updateWorkerStatus(pair, 'scanning', 'placing_trade', `Submitting ${direction} at ${riskDecision.riskPercentage}% account-equity risk with an exact live 2R target.`, mode);
    const tradeInfo = await placeTrade({
      pair,
      action: direction,
      stopLoss: finalCheck.stopLoss,
      takeProfit: finalCheck.takeProfit,
      exactRewardRisk: 2,
      risk: riskDecision.riskPercentage,
      executableEntryGuard:({executableEntry})=>{
        const executionCheck=validateGoldilocksFinalExecutableEntry(
          confirmation.zone,
          snapshot.history.activeZones,
          confirmation.touchCandle,
          confirmation.confirmationCandle.close,
          executableEntry,
        );
        return {allowed:executionCheck.allowed,reason:executionCheck.reason};
      },
    }, mode);
    if (!tradeInfo) {
      updateWorkerStatus(pair, 'waiting', 'order_rejected', 'The final execution guard or broker rejected the order.', mode);
      return;
    }
    persistZoneLifecycle(transitionZoneLifecycle(lifecycle,{type:'execute'}));
    const journal = journalFor(direction, tradeInfo.spread, scoringContext.zone, confirmation.confirmationCandle.time, score, riskDecision, approachPressure,scoringContext.zoneCorridors);
    await monitorTrade({
      id: tradeInfo.tradeId,
      instrument: normalizePairKeyUnderscore(pair),
      currentUnits: tradeInfo.currentUnits,
      price: String(tradeInfo.openPrice),
      stopLossOrder: { price: String(tradeInfo.slPrice) },
      takeProfitOrder: { price: String(tradeInfo.tpPrice) },
      openTime: journal.timestamp,
    }, journal);
    return;
  }
};

const run = async () => {
  if (!pair) throw new Error('No pair was provided to the Goldilocks worker.');
  updateWorkerStatus(pair, 'starting', 'goldilocks_starting', `Goldilocks demo worker starting: ${TREND_TIMEFRAME} trend → ${ZONE_TIMEFRAME} zones → ${CONFIRMATION_TIMEFRAME} departure/touch/confirmation → ${GOLDILOCKS_DEMO_TIMEFRAMES.execution} trade management · dynamic ${getRiskProfile()} risk · minimum score ${minimumScore} · config ${appliedStrategy.sourceRunUid}.`, mode);
  await recoverOpenTrade();
  while (!killed) {
    try {
      await scan();
    } catch (error) {
      updateWorkerStatus(pair, 'error', 'strategy_error', (error as Error).message, mode);
    }
    if (!killed) await wait(millisecondsUntilNextConfirmationClose());
  }
  if (!usesSharedMarketDataHub) await stopPriceStream(pair, mode);
  updateWorkerStatus(pair, 'stopped', 'worker_stopped', 'Goldilocks worker stopped.', mode);
};

run().catch(error => {
  if (pair) updateWorkerStatus(pair, 'error', 'worker_crashed', (error as Error).message, mode);
  console.error(error);
  process.exit(1);
});
