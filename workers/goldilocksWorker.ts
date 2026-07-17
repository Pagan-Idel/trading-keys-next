import { fetchCandles, fetchCompletedCandlesSince } from '../utils/oanda/api/fetchCandles.ts';
import { fetchPriceOnce, startPriceStream, stopPriceStream, waitForFreshPrice } from '../utils/oanda/api/priceStreamManager.ts';
import { openNow, type Trade } from '../utils/oanda/api/openNow.ts';
import { getTradeDetailsById } from '../utils/oanda/api/getTradeDetails.ts';
import { modifyTrade } from '../utils/oanda/api/modifyTrade.ts';
import { ACTION } from '../utils/oanda/api/order.ts';
import { placeTrade } from '../utils/placeTrade.ts';
import { annotateConfluenceAt, buildGoldilocksHistory, buildGoldilocksHistoryChunked, findFreshGoldilocksConfirmations, getGoldilocksRangeAssessment, getGoldilocksTrend, toStrategyCandles } from '../utils/goldilocksScanner.ts';
import { validateFinalEntryAfterEngulf } from '../utils/goldilocksStrategy.ts';
import { evaluateSpread } from '../utils/spreadGuard.ts';
import { isTradeSessionOpen } from '../utils/sessionUtils.ts';
import { isInHighImpactNewsWindow, getActiveNewsEvent, getNewsGuardError } from '../utils/newsGuard.ts';
import { getPrecision, isForexMarketOpen, normalizePairKeyUnderscore, wait } from '../utils/shared.ts';
import { isHolidayCloseWindow, isWeekendCloseWindow } from '../utils/marketCloseGuard.ts';
import { clearActiveTrade, getRiskProfile, setActiveTrade, updateWorkerStatus } from '../utils/automationStore.ts';
import { logMessage } from '../utils/automationLogger.ts';
import { classifyTradeOutcome, saveTradeRecord, type JournalData } from '../utils/tradeHistory.ts';
import { GOLDILOCKS_DEMO_TIMEFRAMES, GOLDILOCKS_LIVE_CANDLE_LIMITS, GOLDILOCKS_TIMEFRAME_SECONDS, getGoldilocksMinimumScore } from '../utils/goldilocksConfig.ts';
import { fetchCandleHistory } from '../utils/oanda/api/fetchCandleHistory.ts';
import { scoreGoldilocksSetup, type GoldilocksScoreResult } from '../utils/goldilocksScoring.ts';
import { calculateScoreRisk, type RiskProfile } from '../utils/dynamicRisk.ts';

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
const minimumScore = getGoldilocksMinimumScore();

let killed = false;
let cachedHistory: ReturnType<typeof buildGoldilocksHistory> | null = null;
let cachedPrimaryTime = '';
let cachedConfirmationCandles: Awaited<ReturnType<typeof fetchCandles>> | null = null;
const attemptedConfirmations = new Set<string>();

const stop = () => {
  killed = true;
  if (!usesSharedMarketDataHub) void stopPriceStream(pair, mode);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

export const millisecondsUntilNextConfirmationClose = (now = Date.now()) => {
  const intervalMs = CONFIRMATION_SECONDS * 1_000;
  return (Math.floor(now / intervalMs) + 1) * intervalMs - now + CANDLE_CLOSE_GRACE_MS;
};

const loadConfirmationCandles = async () => {
  if (!cachedConfirmationCandles?.length) {
    cachedConfirmationCandles = await fetchCandles(pair, CONFIRMATION_TIMEFRAME, CONFIRMATION_CANDLE_COUNT, undefined, undefined, mode);
    return cachedConfirmationCandles;
  }
  const last = cachedConfirmationCandles.at(-1)!;
  const intervalMs = CONFIRMATION_SECONDS * 1_000;
  const attempts = Date.now() >= Date.parse(last.time) + intervalMs * 2 ? 12 : 1;
  let additions: typeof cachedConfirmationCandles = [];
  for (let attempt = 0; attempt < attempts && !additions.length; attempt += 1) {
    additions = await fetchCompletedCandlesSince(pair, CONFIRMATION_TIMEFRAME, last.time, mode, 20);
    if (!additions.length && attempt + 1 < attempts) await wait(250);
  }
  if (additions.length) {
    const merged = new Map(cachedConfirmationCandles.map(candle => [candle.time, candle]));
    for (const candle of additions) merged.set(candle.time, candle);
    cachedConfirmationCandles = [...merged.values()]
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
      .slice(-CONFIRMATION_CANDLE_COUNT);
  }
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
) => logMessage(message, data, { pair, level, fileName: 'goldilocksTradeManager', step });

const journalFor = (
  direction: 'BUY' | 'SELL',
  spread: ReturnType<typeof evaluateSpread>,
  zone: { id: string; kind: string; side: string; low: number; high: number; touches: number; candleTime: number },
  confirmationTime: number,
  score?: GoldilocksScoreResult,
  risk?: { profile: RiskProfile; riskPercentage: number },
): JournalData => ({
  direction,
  rrZone: { low: zone.low, high: zone.high },
  spread: {
    bid: String(spread.bid), ask: String(spread.ask), raw: spread.rawSpread,
    buffer: 0, pipSize: spread.pipSize,
  },
  tf: `${TREND_TIMEFRAME}/${ZONE_TIMEFRAME}/${CONFIRMATION_TIMEFRAME}`,
  timestamp: new Date().toISOString(),
  goldilocks: {
    zoneId: zone.id, kind: zone.kind, side: zone.side, touches: zone.touches,
    candleTime: zone.candleTime, confirmationTime, score,
    riskProfile: risk?.profile, riskPercentage: risk?.riskPercentage,
  },
} as JournalData);

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
    { tradeId: trade.id, outcome, realizedPL, breakEvenActivated },
    outcome === 'WIN' ? 'info' : 'warn',
  );
  return { outcome, realizedPL };
};

const monitorTrade = async (trade: Trade, journal: JournalData) => {
  if (!trade.id) return;
  const direction: 'BUY' | 'SELL' = Number(trade.currentUnits ?? 0) > 0 ? 'BUY' : 'SELL';
  const entry = Number(trade.price ?? 0);
  const stopLoss = Number(trade.stopLossOrder?.price ?? 0);
  const takeProfit = Number(trade.takeProfitOrder?.price ?? 0);
  const precision = getPrecision(pair);
  const priceTolerance = 0.5 * 10 ** -precision;
  let managedStopLoss = stopLoss;
  let breakEvenActivated = Math.abs(stopLoss - entry) <= priceTolerance;
  const originalStopRisk = Math.abs(entry - stopLoss);
  const targetDerivedRisk = Math.abs(takeProfit - entry) / 2;
  const riskDistance = breakEvenActivated ? targetDerivedRisk : originalStopRisk;
  let lastBreakEvenAttempt = 0;
  const price = (value: number) => Number.isFinite(value) ? value.toFixed(precision) : 'unavailable';
  journal.tradeManagement = {
    breakEvenAtOneR: true,
    breakEvenActivated,
    breakEvenPrice: entry,
    ...(breakEvenActivated ? { breakEvenActivatedAt: new Date().toISOString() } : {}),
  };
  setActiveTrade({
    tradeId: trade.id, pair,
    direction,
    entry,
    stopLoss: stopLoss || undefined,
    takeProfit: takeProfit || undefined,
    mode,
    score: journal.goldilocks?.score?.total,
    riskProfile: journal.goldilocks?.riskProfile,
    riskPercentage: journal.goldilocks?.riskPercentage,
  });
  tradeManagerLog(
    'trade_manager_armed',
    `MANAGER ARMED · ${direction} ${pair} · entry ${price(entry)} · protected stop ${price(stopLoss)} · 2R target ${price(takeProfit)}.`,
    { tradeId: trade.id, direction, entry, stopLoss: managedStopLoss, takeProfit, riskDistance, breakEvenActivated, mode },
  );
  tradeManagerLog(
    breakEvenActivated ? 'trade_manager_break_even' : 'trade_manager_break_even_armed',
    breakEvenActivated
      ? `BREAK-EVEN ALREADY ACTIVE · broker stop is at entry ${price(entry)} · a stop-out is a protected win.`
      : `BREAK-EVEN ARMED · at +1.00R the broker stop will move from ${price(stopLoss)} to entry ${price(entry)}.`,
    { tradeId: trade.id, entry, stopLoss, riskDistance, breakEvenActivated },
  );
  updateWorkerStatus(pair, 'in_trade', 'monitoring_trade', `Monitoring Goldilocks trade ${trade.id}. New entries are disabled.`, mode);
  const reachedProfitMilestones = new Set<number>();
  const reachedRiskMilestones = new Set<number>();
  const profitMilestones = [0.25, 0.5, 1, 1.5];
  const riskMilestones = [0.25, 0.5, 0.75];
  let brokerUnavailable = false;
  let lastHeartbeat = Date.now();
  while (!killed) {
    const open = await openNow(pair, mode);
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
    if (!hasPairTrade(open.trades)) {
      tradeManagerLog('trade_manager_closing', 'BROKER REPORTS TRADE CLOSED · resolving the final result and realized P/L.', { tradeId: trade.id });
      break;
    }
    const quote = await fetchPriceOnce(pair, mode);
    if (quote && riskDistance > 0) {
      const currentPrice = direction === 'BUY' ? Number(quote.bid) : Number(quote.ask);
      const favorableMove = direction === 'BUY' ? currentPrice - entry : entry - currentPrice;
      const progressR = favorableMove / riskDistance;
      if (!breakEvenActivated && progressR >= 1 && Date.now() - lastBreakEvenAttempt >= 60_000) {
        lastBreakEvenAttempt = Date.now();
        const result = await modifyTrade({ action: ACTION.SLatEntry, pair }, trade.id, mode);
        if (result.success) {
          breakEvenActivated = true;
          managedStopLoss = entry;
          journal.tradeManagement = {
            breakEvenAtOneR: true,
            breakEvenActivated: true,
            breakEvenActivatedAt: new Date().toISOString(),
            breakEvenPrice: entry,
          };
          setActiveTrade({ tradeId: trade.id, pair, direction, entry, stopLoss: entry, takeProfit: takeProfit || undefined, mode });
          tradeManagerLog('trade_manager_break_even', `BREAK-EVEN LOCKED · ${pair} reached +1.00R · broker stop moved to entry ${price(entry)} · a stop-out now counts as a protected win.`, { tradeId: trade.id, entry, currentPrice, progressR });
        } else {
          tradeManagerLog('trade_manager_break_even_retry', `BREAK-EVEN MOVE DELAYED · ${pair} reached +1.00R but the broker did not accept the stop update; retrying safely.`, { tradeId: trade.id, reason: result.reason }, 'warn');
        }
      }
      const newProfit = profitMilestones.filter(value => progressR >= value && !reachedProfitMilestones.has(value)).at(-1);
      if (newProfit !== undefined) {
        profitMilestones.filter(value => value <= newProfit).forEach(value => reachedProfitMilestones.add(value));
        tradeManagerLog('trade_manager_progress', `PROGRESS UNLOCKED · ${pair} reached +${newProfit.toFixed(2)}R · current ${price(currentPrice)} · target remains ${price(takeProfit)}.`, { tradeId: trade.id, currentPrice, progressR });
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
  if (!killed) {
    await recordClosedTrade(trade, journal, breakEvenActivated);
    clearActiveTrade(pair);
    updateWorkerStatus(pair, 'scanning', 'trade_closed', 'Trade closed and was added to Goldilocks history.', mode);
  } else {
    tradeManagerLog('trade_manager_paused', 'MANAGER HANDOFF · service is stopping; the broker-side stop and target remain active and will be recovered on restart.', { tradeId: trade.id }, 'warn');
  }
};

const recoverOpenTrade = async () => {
  const open = await openNow(pair, mode);
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
    tf: `${TREND_TIMEFRAME}/${ZONE_TIMEFRAME}/${CONFIRMATION_TIMEFRAME}`,
    timestamp: trade.openTime ?? new Date().toISOString(),
  };
  tradeManagerLog('trade_manager_recovered', `TRADE RECOVERED · found open broker trade ${trade.id}; restoring the dashboard ledger and manager.`, { tradeId: trade.id, openedAt: trade.openTime });
  await monitorTrade(trade, journal);
  return true;
};

const loadZoneHistory = async () => {
  const latest = await fetchCandles(pair, ZONE_TIMEFRAME, 2, undefined, undefined, mode);
  const primaryTime = latest.at(-1)?.time ?? '';
  if (cachedHistory && primaryTime === cachedPrimaryTime) return cachedHistory;
  const candles = await fetchCandleHistory(pair, ZONE_TIMEFRAME, { lookbackDays: 730, mode, backfillPages: 1, maxCandles: GOLDILOCKS_LIVE_CANDLE_LIMITS[ZONE_TIMEFRAME] });
  const history = buildGoldilocksHistoryChunked(candles, 1_000, 200);
  cachedHistory = { candles: toStrategyCandles(candles), legs: [], history };
  cachedPrimaryTime = candles.at(-1)?.time ?? primaryTime;
  return cachedHistory;
};

const loadScoringContext = async (zone: Parameters<typeof annotateConfluenceAt>[0], time: number, entry:number, direction:'BUY'|'SELL') => {
  const snapshots = await Promise.all(GOLDILOCKS_DEMO_TIMEFRAMES.confluence.map(async timeframe => {
    if (timeframe === ZONE_TIMEFRAME && cachedHistory) return { timeframe, history: cachedHistory.history, candles: [] };
    const candles = await fetchCandleHistory(pair, timeframe, { lookbackDays: 730, mode, backfillPages: 1, maxCandles: GOLDILOCKS_LIVE_CANDLE_LIMITS[timeframe] });
    return { timeframe, history: buildGoldilocksHistoryChunked(candles, 1_000, 200), candles };
  }));
  const trendCandles = snapshots.find(snapshot => snapshot.timeframe === TREND_TIMEFRAME)?.candles ?? [];
  return {
    zone: annotateConfluenceAt(zone, ZONE_TIMEFRAME, time, snapshots),
    trend: getGoldilocksTrend(trendCandles.slice(-5_000), time),
    rangeAssessment:getGoldilocksRangeAssessment(trendCandles.slice(-5_000),time,entry,direction),
  };
};

const safetyBlockReason = async (): Promise<string | null> => {
  if (!isForexMarketOpen()) return 'Forex market is closed or today is configured as a no-trade holiday.';
  if (isWeekendCloseWindow()) return 'Weekend close safety window is active.';
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
  const blocked = await safetyBlockReason();
  if (blocked) {
    updateWorkerStatus(pair, 'paused', 'safety_guard', blocked, mode);
    return;
  }
  const open = await openNow(pair, mode);
  if (!open) {
    updateWorkerStatus(pair, 'waiting', 'broker_unavailable', 'Could not verify whether a trade is already open.', mode);
    return;
  }
  if (hasPairTrade(open.trades)) {
    await recoverOpenTrade();
    return;
  }

  updateWorkerStatus(pair, 'scanning', 'loading_zones', `Scanning ${ZONE_TIMEFRAME} Goldilocks zones and ${CONFIRMATION_TIMEFRAME} confirmation candles.`, mode);
  const snapshot = await loadZoneHistory();
  const confirmationRaw = await loadConfirmationCandles();
  const confirmationCandles = toStrategyCandles(confirmationRaw);
  const confirmations = findFreshGoldilocksConfirmations(snapshot.history, confirmationCandles, CONFIRMATION_SECONDS);
  if (!confirmations.length) {
    updateWorkerStatus(pair, 'waiting', 'waiting_for_confirmation', `No fresh ${CONFIRMATION_TIMEFRAME} close-through confirmation is ready.`, mode);
    return;
  }

  for (const confirmation of confirmations) {
    const key = `${confirmation.zone.id}:${confirmation.confirmationCandle.time}`;
    if (attemptedConfirmations.has(key)) continue;
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
    const finalCheck = validateFinalEntryAfterEngulf(
      confirmation.zone,
      snapshot.history.activeZones,
      confirmation.confirmationCandle.close,
      liveEntry,
    );
    if (!finalCheck.allowed) {
      attemptedConfirmations.add(key);
      updateWorkerStatus(pair, 'waiting', 'runway_rejected', finalCheck.reason, mode);
      continue;
    }

    const scoringContext = await loadScoringContext(confirmation.zone, confirmation.confirmationCandle.time,finalCheck.entry,direction);
    const priorPenetrations=scoringContext.zone.touchPenetrations?.slice(0,-1)??[];
    const score = scoreGoldilocksSetup({
      zone: scoringContext.zone,
      tradeDirection: direction,
      trend: scoringContext.trend,
      minimumScore,
      purityTouches:Math.max(0,scoringContext.zone.touches-1),
      purityMaxPenetration:priorPenetrations.length?Math.max(...priorPenetrations):0,
      availableRewardRisk:finalCheck.availableRatio,
      rangeAssessment:scoringContext.rangeAssessment,
      gates: [
        { name: 'Zone validity', passed: true, reason: 'Zone is active, unbroken, unexpired, and within the touch limit.' },
        { name: 'Confirmation freshness', passed: true, reason: `${CONFIRMATION_TIMEFRAME} confirmation is the latest completed candle.` },
        { name: '2:1 runway', passed: true, reason: finalCheck.reason },
        { name: 'Spread', passed: true, reason: spread.reason },
        { name: 'Session and news', passed: true, reason: 'Session is active and no news/market safety window is blocking.' },
        { name: 'One trade per pair', passed: true, reason: 'Broker confirms no open trade for this pair.' },
      ],
    });
    logMessage(`PURITY CHECK · ${pair} · ${scoringContext.zone.touches} qualifying retouch(es) · deepest penetration ${(scoringContext.zone.maxPenetration*100).toFixed(1)}%.`, { zoneId:scoringContext.zone.id,touches:scoringContext.zone.touches,maxPenetration:scoringContext.zone.maxPenetration }, { pair, fileName:'goldilocksWorker', step:'purity_measured' });
    logMessage(`AVAILABLE RRR · ${pair} · ${Number.isFinite(finalCheck.availableRatio)?finalCheck.availableRatio.toFixed(2):'unlimited'}R before the stored opposing zone.`, { zoneId:scoringContext.zone.id,availableReward:finalCheck.availableReward,availableRatio:finalCheck.availableRatio,entry:finalCheck.entry,stopLoss:finalCheck.stopLoss }, { pair, fileName:'goldilocksWorker', step:'available_rrr_measured' });
    logMessage(`POINT CHECK · ${pair} scored ${score.total}/${score.minimumScore} · MTF ${scoringContext.zone.timeframeConfluence?.timeframeCount ?? 1}/3 · M15 trend ${scoringContext.trend}.`, score, { pair, fileName: 'goldilocksWorker', step: 'score_complete' });
    if (!score.eligible) {
      attemptedConfirmations.add(key);
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
    const finalOpen = await openNow(pair, mode);
    if (finalBlock || !finalOpen || hasPairTrade(finalOpen.trades)) {
      updateWorkerStatus(pair, 'waiting', 'final_safety_rejected', finalBlock ?? 'A trade opened before submission.', mode);
      return;
    }
    attemptedConfirmations.add(key);
    updateWorkerStatus(pair, 'scanning', 'placing_trade', `Submitting ${direction} at ${riskDecision.riskPercentage}% account-equity risk with an exact live 2R target.`, mode);
    const tradeInfo = await placeTrade({
      pair,
      action: direction,
      stopLoss: finalCheck.stopLoss,
      takeProfit: finalCheck.takeProfit,
      exactRewardRisk: 2,
      risk: riskDecision.riskPercentage,
    }, mode);
    if (!tradeInfo) {
      updateWorkerStatus(pair, 'waiting', 'order_rejected', 'The final execution guard or broker rejected the order.', mode);
      return;
    }
    const journal = journalFor(direction, tradeInfo.spread, scoringContext.zone, confirmation.confirmationCandle.time, score, riskDecision);
    await monitorTrade({
      id: tradeInfo.tradeId,
      instrument: normalizePairKeyUnderscore(pair),
      currentUnits: tradeInfo.orderSide === 'BUY' ? '1' : '-1',
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
  if (!usesSharedMarketDataHub) startPriceStream(pair, mode);
  const initialQuote = usesSharedMarketDataHub
    ? await fetchPriceOnce(pair, mode)
    : await waitForFreshPrice(pair, mode, 5_000);
  logMessage(
    initialQuote
      ? `MARKET DATA READY | ${pair} | OANDA stream snapshot received at ${initialQuote.oandaTime}.`
      : `MARKET DATA FALLBACK | ${pair} | Stream snapshot was not ready; REST pricing remains available.`,
    undefined,
    { pair, level: initialQuote ? 'info' : 'warn', fileName: 'goldilocksWorker', step: 'market_data_ready' },
  );
  updateWorkerStatus(pair, 'starting', 'goldilocks_starting', `Goldilocks demo worker starting: ${TREND_TIMEFRAME} trend → ${ZONE_TIMEFRAME} zones → ${CONFIRMATION_TIMEFRAME} touch/confirmation · dynamic ${getRiskProfile()} risk · minimum score ${minimumScore}.`, mode);
  await recoverOpenTrade();
  while (!killed) {
    try {
      await scan();
    } catch (error) {
      logMessage(`Goldilocks scan error for ${pair}: ${(error as Error).message}`, undefined, { level: 'error', pair, fileName: 'goldilocksWorker', step: 'strategy_error' });
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
