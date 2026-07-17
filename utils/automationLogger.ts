import { recordAutomationEvent, type AutomationLevel } from './automationStore';
import { fixMojibake } from './textEncoding';

type PreparedEvent = { message: string; step?: string; pair?: string; persist: boolean };

const prepareEvent = (message: string, source?: string, explicitStep?: string): PreparedEvent => {
  const clean = fixMojibake(message);
  const inferredPair = clean.match(/[A-Z]{3}\/[A-Z]{3}/)?.[0];
  if (explicitStep) return { message: clean, step: explicitStep, persist: true };

  const rules: Array<[RegExp, string, string | ((match: RegExpMatchArray) => string)]> = [
    [/Market opened/i, 'market_open', 'Forex market is open. Checking news and eligible trading sessions.'],
    [/Market is still closed/i, 'market_closed', 'Forex market is closed. The automation will check again in one minute.'],
    [/Market closed\. Stopping/i, 'market_closed', 'Forex market closed. Stopping all pair workers.'],
    [/Starting worker for (.+)/i, 'worker_starting', (match) => `Starting the ${match[1]} strategy worker.`],
    [/Price ready for (.+), starting worker/i, 'worker_eligible', (match) => `${match[1]} passed the news safety check and is eligible to scan.`],
    [/Skipping (.+) at startup.+News:/i, 'news_blocked', (match) => `${match[1]} is paused because of a high-impact news window.`],
    [/Stopping (.+).+High Impact News/i, 'news_blocked', (match) => `${match[1]} was paused because a high-impact news window began.`],
    [/Initial Outer Swing: (.+)/i, 'structure_detected', (match) => `Initial M1 market structure ends with ${match[1]}.`],
    [/New Outer Swing Detected: (.+)/i, 'structure_detected', (match) => `New M1 market structure detected: ${match[1]}.`],
    [/Skipping swing\. Range (.+) is outside/i, 'swing_rejected', 'Swing structure rejected because its range is smaller than the strategy threshold.'],
    [/Higher TF Bias Check.+Expected 1M: (BUY|SELL).+Got: (BUY|SELL).+true/i, 'bias_confirmed', (match) => `H1 bias confirmed the ${match[2]} setup.`],
    [/Engulfing candle:/i, 'engulfing_confirmed', 'Engulfing confirmation found. Performing the final live-price check.'],
    [/Live price .+ not in RR zone/i, 'entry_rejected', 'Confirmation was valid, but live price left the entry zone. No order was placed.'],
    [/Executing (BUY|SELL) on (.+?) \|/i, 'order_submitting', (match) => `Submitting a ${match[1]} market order for ${match[2]}.`],
    [/Trade placed successfully for (.+)/i, 'order_filled', (match) => `${match[1]} order was accepted. Resolving the broker trade ID.`],
    [/Could not resolve trade info/i, 'order_tracking_error', 'The broker accepted the order, but its trade details could not be resolved after three attempts.'],
    [/Trade already open/i, 'managing_trade', 'An open trade already exists for this pair; new entries are disabled.'],
    [/Resuming trade from OANDA/i, 'resuming_trade', 'Found an existing broker trade and resumed automated management.'],
    [/Error: (.+)/i, 'strategy_error', (match) => `Strategy error: ${match[1]}`],
  ];

  for (const [pattern, step, replacement] of rules) {
    const match = clean.match(pattern);
    if (match) return { message: typeof replacement === 'function' ? replacement(match) : replacement, step, pair: inferredPair, persist: true };
  }

  const noisy =
    source === 'isEngulfed' ||
    /Now time|swing [ab] =|RR Zone|Range =|Outer Swing unchanged|ALL EVENTS|Base candle updated|Skipping invalid candle|Checking TP|Checking SL|Live TP value|Live SL value|status check|Initializing strategy for pair|TradeManager instance created|No open trades found|exited with code 0|exited cleanly|Session closed|No valid outer swing|Rejected by Higher TF Bias|Waiting for .+ trade to close|trade closed/i.test(clean);
  return { message: clean, pair: inferredPair, persist: !noisy };
};

export const logMessage = (
  message: string,
  data?: unknown,
  options?: {
    level?: AutomationLevel;
    fileName?: string;
    pair?: string;
    step?: string;
  },
): void => {
  const level = options?.level ?? 'info';
  const prepared = prepareEvent(message, options?.fileName, options?.step);
  if (!prepared.persist) return;
  const cleanMessage = prepared.message;
  if (data !== undefined) {
    console.log(`[${level}] ${cleanMessage}`, data);
  } else {
    console.log(`[${level}] ${cleanMessage}`);
  }

  try {
    recordAutomationEvent({
      level,
      message: cleanMessage,
      data,
      pair: options?.pair ?? prepared.pair,
      source: options?.fileName,
      step: prepared.step,
    });
  } catch (error) {
    console.error('[automationLogger] Failed to persist event', error);
  }
};
