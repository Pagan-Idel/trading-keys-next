# Goldilocks Strategy and Code Guide

## Purpose and authority

This document explains the Goldilocks strategy as it is currently implemented. It is
the human-readable strategy contract for maintainers and AI agents. When prose and
behavior disagree, inspect the cited implementation, add a regression test, and then
update both the code and this guide together.

The original source reference is
[`20-point-scoring-sheet.pdf`](reference/20-point-scoring-sheet.pdf). The code has
deliberate adaptations agreed during development, including a four-point trend maximum,
an eight-point departure-quality category, and a three-point multi-timeframe confluence
category, while preserving a 20-point total.

The objective is not maximum raw profit. The research objective is higher
out-of-sample expectancy and stability under bounded risk, drawdown, spread, and
execution constraints.

## Current demo timeframe stack

| Role | Timeframe | Use |
| --- | --- | --- |
| Context | H1 | Swing trend and premium/discount range alignment |
| Zone | M15 | Base and continuation demand/supply zones |
| Zone lifecycle/purity | M15 | First outside candle and subsequent prior-touch ledger |
| Trigger | M5 | Trade touch and later close-through confirmation |
| Execution resolution | M1 | Post-entry stop, +1R, break-even, and target ordering only |
| Confluence | M5/M15/H1 | Same-side overlapping zone count |

These are intentionally small for rapid practice testing. Keep them centralized in
`utils/goldilocksConfig.ts` when moving to higher timeframes.

The historical research runner also exposes a separate, non-live
`d1-h4-h1-research-v1` profile. It mirrors the contract as D1 trend/range, H4 zones,
first-outside and prior-touch purity, H1 first touch plus a distinct later H1
close-through confirmation, and M5 post-entry ordering. Confluence is H1/H4/D1.
Selecting this profile on Backtesting does not change the live/demo worker, which
remains locked to H1/M15/M5/M1.

## Market structure and trend

The swing labeler produces HH, HL, LH, and LL points. The scanner converts adjacent
compatible swing points into bullish and bearish legs. The most recent structure
label determines H1 trend:

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
2. Once the structural break identifies the zone, scan forward from its M15 base: the first completed M15 candle fully outside is the originating departure and arms touch counting, even when it predates `availableAt`.
3. Every later completed M15 candle whose wick intersects the zone counts as a qualifying prior touch only while it completes before the first M5 trade-trigger touch.
4. Equality with the proximal boundary counts as a touch.
5. Penetration depth is stored as a fraction of zone width.
6. The first M5 candle whose wick intersects the zone is frozen as the trade-trigger touch. Later touching M5 candles cannot replace it while the strategy waits for close-through confirmation.
7. The M15 candle containing that first M5 trigger, and all M15 candles after the trigger, are excluded from prior-touch count and penetration. They belong to the pending trade trigger, not the pre-trigger purity ledger.
8. A fourth qualifying touch invalidates the zone; three remains the maximum allowed.
9. Demand invalidates when a wick trades below its distal low. Supply invalidates when
   a wick trades above its distal high.
10. A continuation also invalidates if price reaches its same-side base.
11. An otherwise active zone expires after two calendar years.

Invalid and expired zones remain historical records but cannot create new entries.
Charts normally show only the nearest active demand and supply zones, plus historical
zones that explain a drawn trade. Strategy Lab highlights an oversized rejected M5
first-touch candle in orange with the compact label `FAILED 1ST TOUCH` only while its
source zone remains usable at the displayed historical time and that source zone is
actually drawn. An unrelated or hidden zone cannot leave an orphan marker on a stored
trade replay.

## Touch and confirmation

M15 owns the first outside candle and prior-touch purity ledger. M5 supplies the first
trade touch and later confirmation. M1 never creates a setup; it is retained only to resolve
post-entry ordering inside completed M5 candles.

For a demand setup:

1. After a completed M15 outside candle arms the zone, the first M5 candle that touches demand is frozen as the trigger.
2. A later bullish M5 candle must close above the touched candle's high wick.
3. Entry is the executable ask after that confirming candle completes.

For a supply setup:

1. After a completed M15 outside candle arms the zone, the first M5 candle that touches supply is frozen as the trigger.
2. A later bearish M5 candle must close below the touched candle's low wick.
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

The order-placement boundary fetches its own fresh bid/ask. That exact second quote is
checked again against the 50%-of-zone entry-proximity limit and the 2R runway before
the market order is submitted. This closes the gap between the worker's initial quote
and the quote used to calculate the submitted 2R target. Broker slippage after a market
order is submitted remains an execution risk.

The available RRR scoring measurement is the distance from entry to the nearest edge
of the stored opposing zone divided by risk to the selected entry zone's stop. The 2R
gate and RRR score are related but separate: less than 2R is a hard rejection; larger
clearance can earn quality points.

## Hard gates

All gates must pass before scoring and again where volatility can change the result:

| Gate | Current rule |
| --- | --- |
| Market | Forex market open and configured holiday rules allow trading |
| Weekly close/reopen | Reject entries from Friday 16:00 through Sunday 18:00 America/New_York; this includes the final hour before Friday close and first hour after Sunday reopen |
| Weekend liquidation | At Friday 16:00 America/New_York, close every managed Goldilocks position and retry broker failures until the 17:00 close |
| Holiday | Reject during configured holiday windows |
| Session | At least one currency's local trading session is active |
| News | Reject high-impact events for either currency from one hour before through one hour after; fail closed if news status is unavailable |
| Existing trade | Only one open broker trade per pair |
| Zone | Active, under two years old, no more than three touches, not broken |
| Confirmation | Latest completed M5 close-through after a distinct M5 touch candle |
| Entry proximity | First M5 touch range must be no more than 50% of M15 zone width; the M5 close-through and final executable entry must each remain no more than 50% of one zone width beyond the proximal edge |
| Departure quality | Reject a zone when its wick-extreme M15 departure candle is at least 3x prior ATR(14), has at least a 50% rejection wick against the departure direction, and closes less than one zone width away |
| Spread | Valid quote and no more than 3 pips |
| Runway | Clear 2R at confirmation and current executable entry |

Gates receive no points. A failed gate prevents scoring and order submission.

## The implemented 20-point score

The default threshold is 14/20. A score below the configured threshold is explicitly
logged and skipped. Equal to the threshold passes.

| Component | Maximum | Current rule |
| --- | ---: | --- |
| H1 range | 0 | Recorded as a diagnostic; zone selection already supplies the range location and it does not add points |
| H1 trend | 4 | Trade direction aligned with current H1 swing trend |
| M15 departure quality | 8 | Base compactness: 1 candle = 3, 2 = 2, 3 = 1, 4+ = 0. Immediacy: no lingering in-zone M15 candle before the first outside candle = 2, one = 1, two or more = 0. Sustained close displacement over 2 zone widths = 1. Structural opposite-leg break = 2. |
| M15 purity | 4 | No prior M15 touch = 4; one prior touch under 50% depth = 2; otherwise 0 |
| Available RRR | 1 | At least 3R available = 1; below 3R = 0 |
| Zone inside zone (MTF confluence) | 3 | Same-side overlap: one timeframe = 0; two = 1; all three = 3. Chart label: `ZIZ n/3 · timeframes`. |

The departure-quality score deliberately gives five of its eight points to formation
compactness and immediacy. A one-candle base followed immediately by the first fully
outside M15 candle earns all five formation points. A lingering candle is any completed
M15 candle after the selected base candle and before that first outside candle whose
wick still overlaps the zone. Too many base or lingering candles therefore carry the
largest quality penalty. Wick-only excursion never earns the displacement point.

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
3. At Friday 16:00 America/New_York, submit a full close so no Goldilocks position is
   deliberately carried into the weekend. Failed close requests retry while the market remains open.
4. Once +1R has been achieved, classify a later break-even stop as a protected win,
   even when realized P/L is zero or slightly negative from execution costs.
5. Persist the final outcome and realized P/L.
6. Recover and resume management of an existing OANDA trade after worker restart.

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
- Completed OANDA midpoint candles are persisted in the separate indexed SQLite archive
  `data/candle-history.sqlite`, keyed by demo/live mode, pair, timeframe, and UTC candle
  time. Explicit historical ranges are served locally once their coverage has been
  recorded; OANDA is queried only for uncovered or newer ranges. Backtests, Strategy Lab,
  and replay confluence share this archive. Existing `data/candle-history/*.json.gz`
  caches are imported once and retained as recoverable source files rather than rewritten.
- The worker loads its M5 signal context once, then requests only candles after the newest
  stored completion using `includeFirst=false`. Scans align to the next M5 boundary plus
  a 350 ms grace period and retry briefly if OANDA has not finalized the candle.
- Daily alignment is explicitly 17:00 America/New_York on every machine.
- The shared hub reconnects as one unit with exponential backoff. Workers fall back to
  short-timeout OANDA REST pricing if the localhost hub is temporarily unavailable.

## Backtesting contract

The manual dashboard at `/backtesting` stores a label for every strategy tweak,
minimum score, lookback, selected pairs, aggregate outcomes, per-pair results, trades,
and progress events. The detached worker publishes stage-level heartbeats and overall
progress and can be cancelled from the dashboard without stopping live/demo workers.
The new-run label is derived from the current strategy version and relevant configured
research weights, so it advances with those settings instead of retaining a stale
baseline name. A restored historical run keeps its stored label when prepared for a rerun.
Dashboard edge reporting is calculated from each trade's final realized R. It leads
with expectancy per trade and profit factor, and also reports average positive R,
average absolute loss R, payoff ratio, profitable-trade rate, break-even trades, net R,
maximum drawdown in R, and longest losing streak. A protected break-even remains a
reached-1R diagnostic but contributes 0R and is not counted as a profitable trade.
Pair/tweak rows rank by realized-R expectancy rather than win rate and flag samples
below 50 trades as early evidence; 100 or more is the preferred initial review size.
Every stored trade also receives a deterministic `GL-PAIR-YYYYMMDD-HHMM-HASH` ID that
survives progress rewrites and can be searched globally from the dashboard.
New backtest and live/demo trade records store zone age as exact seconds from the
originating M15 base candle to M5 entry eligibility; dashboards display the same value in days.
Approach pressure is also recorded as a causal research diagnostic. It uses only completed
M5 candles available by confirmation and keeps four measurements separate: reclaimed
liquidity sweeps against the later approach, recovery displacement in pre-touch ATRs,
compression into the M15 zone, and confirmation-candle strength. Supply and demand use
exactly mirrored definitions. A provisional `adversePressureScore` counts the four research
flags from zero to four, but neither that count nor any component changes eligibility,
risk, stops, targets, the minimum threshold, or the 20-point score. New backtest trades
persist the structured measurement; live/demo workers emit `approach_pressure_measured`
and retain the same object in the trade journal. Existing records display `Legacy`.
New runs also persist a causal M5/M15/H1 supply-demand corridor snapshot and a shared
M1 market-path summary. Each stored setup receives separate versioned research outcomes
for a 22-policy research grid: set-and-forget targets from 1R to 5R, +1R break-even
targets from 1.5R to 5R, and 25%, 50%, or 75% runners from 2R toward 3R, 4R, or 5R. These
counterfactual rows are training data only: they do not replace the official backtest
outcome or change live execution. Live/demo manager actions are additionally copied to
the append-only `trade_management_events` ledger with broker responses and quote-path
milestones; unlike display automation events, this ledger is not pruned after three days.
Chart images are intentionally deferred.
Long replay ranges are split into bounded OANDA requests so a delayed stored exit does
not exceed the broker's per-request candle limit.
Stored-trade replays begin before the recorded M15 zone base and initially frame that
source candle together with the entry and exit, even when the first touch occurs months later.
When the replay also projects contextual M15 zones onto M5, M15, or H1, its visible
start expands to include the earliest displayed zone's originating base candle. A zone
must not be clamped to the first chart candle and appear as a floating rectangle without
its price source. The selected entry zone is labeled `HISTORY TRADE ZONE`; other zones
drawn from the same historical snapshot are labeled `HISTORY CONTEXT ZONE`. The selected
trade zone's ZIZ count comes from its stored entry-time backtest score, because a bounded
visual replay may not contain the older source zones needed to reconstruct that count.

Historical simulation currently:

- Uses archived H1/M15/M5 signal candles and M1 post-entry execution candles
- Reconstructs zones without future eligibility at the setup timestamp
- Applies zone validity, close-through confirmation, 2R runway, scoring, and one open
  simulated trade per pair
- Freezes the first M5 zone overlap as the trigger, excludes its containing M15 candle
  from prior-touch purity, and applies the 50%-of-zone-width entry-proximity gate
- Applies the DST-aware weekly entry blackout and closes unresolved simulated trades
  at the first M1 open at or after Friday 16:00 America/New_York
- Applies the shared DST-aware pair-session helper at historical entry eligibility;
  at least one currency's configured local session must be open
- Evaluates configured U.S. no-trade holidays using the historical America/New_York
  market date, including EST/EDT boundaries, with the same pure calendar helper used
  by live/demo safety checks
- Rejects shock/rejection departures using the same shared M15 quality measurement as
  live/demo workers. Replays expose range/ATR, rejection-wick percentage, close-based
  displacement, wick excursion, and available M1 concentration diagnostics.
- Imports Forex Factory high-impact calendar events into SQLite with their original
  currency, source-local date/time, exact UTC timestamp, and inclusive one-hour block
  window on each side. A confirmed setup for either currency in the pair is rejected
  inside that window. Missing calendar coverage fails closed instead of being treated
  as a news-free day.
- Tracks the trade beyond +1R and stores one final realized-R result for money simulation
- Fails closed when the first available M1 execution candle is more than 60 seconds
  after entry eligibility; later candles are never substituted for missing entry-time data
- Caps a modeled weekend liquidation at the active stop level: -1R before protection,
  0R after break-even protection, or the protected runner floor after a partial target
- Conservatively records a loss if one M1 execution candle touches both the original stop and
  +1R, because intrabar ordering is unknown
- Does not yet reconstruct historical bid/ask spreads, slippage, latency, partial
  fills, or daily/triple-rollover financing charges. The
  forced Friday exit prevents simulated weekend holding but does not model financing already accrued.

Historical news is stored in `historical_news_events`; explicit day-level coverage,
including days with zero high-impact events, is stored in
`historical_news_coverage`. Backtest runs reuse this immutable local cache so repeated
research does not depend on a later website response. The source and fetch timestamp
remain attached to every row.

Therefore backtest win rate is a research metric, not live expected performance.
Compare tweaks on identical data windows, include walk-forward tests, and retain losing
and abandoned runs to reduce selection bias.

## Automatic research campaigns

The Backtesting dashboard can start a detached, resumable research campaign stored in
`data/goldilocks-research.sqlite`. The initial search enumerates minimum scores 10-18
for both timeframe profiles and records all 22 management-policy outcomes
for every stored trade. Each unique configuration and dataset manifest is hashed, so
an interrupted worker can resume without treating an identical trial as new evidence.

Continuous mode waits for the candle-archive manifest to advance before enqueuing the
same versioned matrix on new data. It never changes the Automation risk profile,
strategy configuration, or live workers. Results rank realized-R expectancy before
win rate and retain failed trials. Candle acquisition stops safely at the configured
5 GiB archive ceiling without deleting older data.

The dedicated `/research` status page polls every five seconds and distinguishes the
campaign queue from the currently active deterministic backtest. It reports worker
process health, campaign and backtest progress, the latest heartbeat and stage, candle
storage, completed-trial leaders, and recent research events. It can start, pause,
resume, or stop a campaign, but it cannot change live/demo risk or strategy settings.

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
| Dashboards | `pages/automation.tsx`, `pages/strategy-lab.tsx`, `pages/backtesting.tsx`, `pages/research.tsx` |
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
