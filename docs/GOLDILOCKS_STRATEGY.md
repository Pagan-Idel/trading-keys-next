# Goldilocks Strategy and Code Guide

## Purpose and authority

This document explains the Goldilocks strategy as it is currently implemented. It is
the human-readable strategy contract for maintainers and AI agents. When prose and
behavior disagree, inspect the cited implementation, add a regression test, and then
update both the code and this guide together.

The original source reference is
[`20-point-scoring-sheet.pdf`](reference/20-point-scoring-sheet.pdf). The code has
deliberate adaptations agreed during development, including a two-point trend maximum
and a two-point multi-timeframe confluence category, while preserving a 20-point total.

The objective is not maximum raw profit. The research objective is higher
out-of-sample expectancy and stability under bounded risk, drawdown, spread, and
execution constraints.

## Current demo timeframe stack

| Role | Timeframe | Use |
| --- | --- | --- |
| Context | M15 | Swing trend and premium/discount range alignment |
| Zone | M5 | Base and continuation demand/supply zones |
| Trigger | M1 | Touch candle and later close-through confirmation |
| Confluence | M1/M5/M15 | Same-side overlapping zone count |

These are intentionally small for rapid practice testing. Keep them centralized in
`utils/goldilocksConfig.ts` when moving to higher timeframes.

## Market structure and trend

The swing labeler produces HH, HL, LH, and LL points. The scanner converts adjacent
compatible swing points into bullish and bearish legs. The most recent structure
label determines M15 trend:

- HH or HL: bullish
- LH or LL: bearish
- no usable structure: unknown

The chart displays arrows without verbose swing text, while the structure remains
stored internally. A reversal-strength condition is recorded when a leg changes from
LL to HH or from HH to LL rather than merely continuing the existing structure.

## Zone construction

### Base zone

Each completed leg should have a base. Search backward from the leg start for the
nearest candle opposite the leg direction. If consecutive opposite-direction candles
have overlapping bodies, form a base cluster and select the largest opposite candle.

For bullish demand:

- Proximal/body boundary: selected bearish candle open
- Distal boundary: true lowest wick of the entire bullish leg

For bearish supply:

- Proximal/body boundary: selected bullish candle open
- Distal boundary: true highest wick of the entire bearish leg

The distal wick may belong to a different candle. The detector rejects a zone wider
than 25% of its swing leg; the previously discussed half-zone fallback is not active.

### Continuation zone

A continuation is optional but deterministic; there is no subjective "choppy" veto.
Search the leg after its base for opposite-direction candles. Consecutive candles with
overlapping bodies may form a sideways cluster, and the largest opposite-direction
candle represents the cluster.

A continuation must:

- Be demand in a bullish leg or supply in a bearish leg
- Have its midpoint in the 25%-49% discount band for demand, or mirrored 51%-75%
  premium band for supply
- Be fully on the correct side of the leg midpoint
- Not overlap the base
- Be separated from the base by at least 5% of leg range
- Be no wider than 25% of leg range
- Be at least the greater of 50% of ATR(14) or 2% of leg range
- Remain unbroken and not trade back into its same-side base

If several candidates qualify, select the most discounted demand candidate or the
most premium supply candidate. At most one base and one continuation are retained per
leg.

## Zone lifecycle

A zone can be fresh, touched, invalidated, or expired.

1. The originating leg must complete before the zone is available.
2. Price must place at least one full candle outside the zone before retouches count.
3. Every later in-zone candle after an exit counts as a qualifying touch.
4. Equality with the proximal boundary counts as a touch.
5. Penetration depth is stored as a fraction of zone width.
6. The triggering touch is excluded from historical purity scoring.
7. A fourth qualifying touch invalidates the zone; three remains the maximum allowed.
8. Demand invalidates when a wick trades below its distal low. Supply invalidates when
   a wick trades above its distal high.
9. A continuation also invalidates if price reaches its same-side base.
10. An otherwise active zone expires after two calendar years.

Invalid and expired zones remain historical records but cannot create new entries.
Charts normally show only the nearest active demand and supply zones, plus historical
zones that explain a drawn trade.

## Touch and confirmation

The trigger timeframe is M1 in the current demo configuration.

For a demand setup:

1. An M1 candle touches the demand zone.
2. A later bullish M1 candle must close above the touched candle's high wick.
3. Entry is the executable ask after that confirming candle completes.

For a supply setup:

1. An M1 candle touches the supply zone.
2. A later bearish M1 candle must close below the touched candle's low wick.
3. Entry is the executable bid after that confirming candle completes.

Only the latest completed confirmation is accepted. A stale confirmation is not
chased. The same zone/confirmation pair is attempted only once per worker process.

## Entry, stop, target, and runway

- Demand stop: zone distal low
- Supply stop: zone distal high
- Target: exactly 2R from the executable entry
- Entry: live ask for buys and live bid for sells

Before confirmation, and again at the current executable price immediately before
submission, the strategy checks the most recent active opposing base or continuation
zone. If that opposing zone intersects the path to the 2R target, the setup is
rejected. If price moved far enough that risk or runway is no longer valid, the trade
is marked missed and is not chased.

The available RRR scoring measurement is the distance from entry to the nearest edge
of the stored opposing zone divided by risk to the selected entry zone's stop. The 2R
gate and RRR score are related but separate: less than 2R is a hard rejection; larger
clearance can earn quality points.

## Hard gates

All gates must pass before scoring and again where volatility can change the result:

| Gate | Current rule |
| --- | --- |
| Market | Forex market open and configured holiday rules allow trading |
| Weekend/holiday | Reject near Friday close and during configured holiday windows |
| Session | At least one currency's local trading session is active |
| News | Reject high-impact events for either currency from one hour before through one hour after; fail closed if news status is unavailable |
| Existing trade | Only one open broker trade per pair |
| Zone | Active, under two years old, no more than three touches, not broken |
| Confirmation | Latest completed M1 close-through after a touch |
| Spread | Valid quote and no more than 3 pips |
| Runway | Clear 2R at confirmation and current executable entry |

Gates receive no points. A failed gate prevents scoring and order submission.

## The implemented 20-point score

The default threshold is 14/20. A score below the configured threshold is explicitly
logged and skipped. Equal to the threshold passes.

| Component | Maximum | Current rule |
| --- | ---: | --- |
| M15 range | 2 | Entry in the correct half of the active M15 leg |
| M15 trend | 2 | Trade direction aligned with current M15 swing trend |
| M5 base time | 2 | 1-3 base candles = 2; 4-6 = 1; 7+ = 0 |
| M5 purity | 4 | No prior touch = 4; one prior touch under 50% depth = 2; otherwise 0 |
| M5 strength | 4 | Departure over 2 zone widths = 2; structural opposite-leg break = 2 |
| Available RRR | 4 | Over 5R available = 4; 3R-5R = 2; below 3R = 0 |
| MTF confluence | 2 | One timeframe = 0; two = 1; all three = 2 |

There is no neutral trend score. An unknown or counter-trend setup receives zero trend
points but may still qualify if its total meets the threshold and every gate passes.

Configuration:

- `GOLDILOCKS_MIN_SCORE`, default 14 and clamped to 0-20
- Dynamic risk profile, selected from the Automation dashboard and stored in SQLite

### Score-powered fixed-fractional risk

Position size uses current OANDA account equity (NAV), the selected zone stop distance,
and a score-derived risk percentage. Scores between the eligible threshold and 20 are
linearly interpolated:

| Profile | Risk at 14/20 | Risk at 20/20 |
| --- | ---: | ---: |
| Easy | 0.10% | 0.25% |
| Default | 0.25% | 0.50% |
| Aggressive | 0.50% | 1.00% |

If the configured minimum score changes, that minimum becomes the lower endpoint of
the curve. The profile can be changed without restarting workers. Every new trade
stores its score, profile, and exact risk percentage. Existing trades retain their
original sizing metadata.

## Position sizing and trade management

The live/demo worker delegates risk-based position sizing and broker placement to
`utils/placeTrade.ts`. It stores the selected zone, score breakdown, spread, entry,
stop, target, and confirmation time in the trade journal.

After entry:

1. Monitor the broker trade and current quote.
2. At +1R, move the stop to the entry price.
3. Once +1R has been achieved, classify a later break-even stop as a protected win,
   even when realized P/L is zero or slightly negative from execution costs.
4. Persist the final outcome and realized P/L.
5. Recover and resume management of an existing OANDA trade after worker restart.

## Live OANDA market-data contract

OANDA is the sole live price source. Do not substitute TradingView or another broker's
quotes because broker feeds, spreads, candle components, and candle boundaries can
differ.

- One account-specific OANDA pricing stream subscribes to all configured instruments.
  A localhost-only market-data hub shares its cache with every pair worker, so nine
  workers still consume only one broker stream. The cache stores best bid/ask, OANDA
  server time, local receipt time, and tradeable state.
- A streamed quote is executable only while it is tradeable and no more than two
  seconds old. If unavailable, the worker makes one short-timeout OANDA REST pricing
  request instead of using stale data.
- Heartbeats establish connection health; an unchanged market price does not by itself
  make the connection stale. Missing stream messages for 15 seconds causes a reconnect
  with exponential backoff and jitter.
- The stream parser buffers partial newline-delimited JSON across network chunks.
- Official completed midpoint candles remain authoritative for strategy OHLC. A stream
  is sampled by OANDA and must not be treated as a lossless tick feed or used to invent
  an official completed candle.
- The worker loads its M1 context once, then requests only candles after the newest
  stored completion using `includeFirst=false`. Scans align to the next M1 boundary plus
  a 350 ms grace period and retry briefly if OANDA has not finalized the candle.
- Daily alignment is explicitly 17:00 America/New_York on every machine.
- The shared hub reconnects as one unit with exponential backoff. Workers fall back to
  short-timeout OANDA REST pricing if the localhost hub is temporarily unavailable.

## Backtesting contract

The manual dashboard at `/backtesting` stores a label for every strategy tweak,
minimum score, lookback, selected pairs, aggregate outcomes, per-pair results, trades,
and progress events. The detached worker publishes stage-level heartbeats and overall
progress and can be cancelled from the dashboard without stopping live/demo workers.

Historical simulation currently:

- Uses archived M15/M5/M1 candles and progressively backfills more history
- Reconstructs zones without future eligibility at the setup timestamp
- Applies zone validity, close-through confirmation, 2R runway, scoring, and one open
  simulated trade per pair
- Records +1R immediately as a protected win
- Conservatively records a loss if one M1 candle touches both the original stop and
  +1R, because intrabar ordering is unknown
- Does not yet reconstruct historical bid/ask spreads, session availability, news,
  slippage, latency, partial fills, or financing

Therefore backtest win rate is a research metric, not live expected performance.
Compare tweaks on identical data windows, include walk-forward tests, and retain losing
and abandoned runs to reduce selection bias.

## Code map

| Area | Primary files |
| --- | --- |
| Strategy configuration | `utils/goldilocksConfig.ts` |
| Zone lifecycle and runway | `utils/goldilocksStrategy.ts` |
| Swing conversion, trend, range, confluence | `utils/goldilocksScanner.ts` |
| 20-point calculation | `utils/goldilocksScoring.ts` |
| Live/demo orchestration | `workers/goldilocksWorker.ts`, `runner/startRunner.ts`, `runner/strategyRunner.ts` |
| Spread/session/news/market gates | `utils/spreadGuard.ts`, `utils/sessionUtils.ts`, `utils/newsGuard.ts`, `utils/marketCloseGuard.ts` |
| Position sizing and broker order | `utils/placeTrade.ts`, `utils/oanda/api/` |
| Persistent logs and trades | `utils/automationLogger.ts`, `utils/automationStore.ts`, `utils/tradeHistory.ts` |
| Historical simulation | `utils/goldilocksBacktest.ts`, `utils/backtestRunner.ts`, `utils/backtestStore.ts`, `workers/backtestWorker.ts` |
| Dashboards | `pages/automation.tsx`, `pages/strategy-lab.tsx`, `pages/backtesting.tsx` |
| Regression specification | `tests/goldilocksStrategy.test.ts` |

## Safe change procedure

1. State the proposed rule in price/time terms without visual ambiguity.
2. Identify whether it is a detector rule, score, hard gate, execution rule, or display
   rule. Do not mix these categories.
3. Add a small deterministic regression fixture reproducing the scenario.
4. Change the narrowest shared implementation; avoid duplicating chart and worker logic.
5. Run `npm run test:strategy`, `npx tsc --noEmit`, and `npm run build:threads`.
6. Compare a labeled backtest against the unchanged baseline on identical periods.
7. Inspect per-pair sample counts, expectancy, drawdown, and stability - not win rate
   alone.
8. Practice-test before live use and update this guide if the behavior changed.

## Known research priorities

- Add historical spread, news, and session reconstruction to backtests.
- Record R-multiple and equity curves, not only win/loss.
- Add maximum drawdown, profit factor, expectancy, and confidence intervals.
- Add walk-forward train/validation/test partitions.
- Add controlled exports for AI research with dataset/version hashes.
- Authenticate dashboard mutation APIs before remote Raspberry Pi access.
