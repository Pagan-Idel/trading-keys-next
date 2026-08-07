# AI Training and Strategy Research Guide

## Goal

Use the repository's structured strategy contract, tests, logs, and backtests to help a
personal AI analyze and improve the system without silently changing risk or learning
from future data.

Optimize for out-of-sample expectancy and robustness under explicit risk limits. Do
not optimize raw profit, win rate, or trade count in isolation. Those objectives invite
overfitting, leverage escalation, and unsafe behavior.

## Sources of truth

Use these sources in order:

1. `tests/goldilocksStrategy.test.ts` - executable edge-case contract
2. `docs/GOLDILOCKS_STRATEGY.md` - complete human strategy contract
3. `utils/goldilocksConfig.ts`, `utils/goldilocksStrategy.ts`,
   `utils/goldilocksScanner.ts`, and `utils/goldilocksScoring.ts` - implementation
4. `docs/reference/20-point-scoring-sheet.pdf` - historical source reference
5. Structured SQLite logs and backtests - observed executions and experiments
6. Screenshots and free-text conversation - supporting evidence only

Never let an AI infer a new trading rule solely from a screenshot or a profitable
historical example.
Replay reconstruction failures do not erase immutable stored trade geometry. When the
confirmation candle exists but a newer detector cannot reproduce the old zone, use the
saved entry-time corridor for the explanatory zone and retain the stored entry, stop,
target, and outcome.

## Available data

The primary database is `data/automation.sqlite` in WAL mode.

| Table | Purpose | Retention |
| --- | --- | --- |
| `automation_events` | Structured worker/candylog events and rejection reasons | 3 days |
| `worker_status` | Latest state and reason per pair | Latest row per pair |
| `active_trades` | Restart recovery and dashboard state | Until closed/cleared |
| `trades` | Closed live/demo trades and journal JSON | Persistent |
| `trade_management_events` | Append-only requested/confirmed manager actions, broker responses, quote milestones, and path summaries | Persistent |
| `backtest_runs` | Tweak/version configuration and aggregate results | Persistent |
| `backtest_trades` | Historical simulated entries, scores, outcomes, and context | Persistent |
| `backtest_trade_management_results` | Counterfactual outcomes for each versioned manager on the same M1 path | Persistent |
| `backtest_events` | Backfill, scan, progress, and completion events | Persistent |
| `historical_news_events` | Source-stamped high-impact releases and exact historical block windows | Persistent |
| `historical_news_coverage` | Complete/failed calendar-day coverage, including zero-event days | Persistent |

Candle archives under `data/` are inputs. Treat them as versioned datasets even when
they are not committed to Git. Record pair, timeframe, earliest/latest timestamp,
candle count, data source, and a content hash for reproducible experiments.

Completed OANDA midpoint OHLC is stored separately in `data/candle-history.sqlite`.
`historical_candles` is indexed by mode, pair, timeframe, and UTC candle time;
`candle_archive_coverage` records fetched ranges, including ranges with no candles;
`candle_archive_imports` prevents repeated decompression of legacy gzip caches. This
database contains market data only and is intentionally separate from
`data/automation.sqlite` so large M1 archives do not slow trade/event writes.

Live/demo zone purity is reconstructed from the same confirmation-timeframe touch
utilities used by research and backtests. Each worker reads archived confirmation
candles from the earliest currently active base through the latest completed candle,
then removes fourth-touch or broken zones before confirmation and runway evaluation.
Automation snapshots retain the interval needed to show every active base and carry a
per-zone causal evidence ledger for formation, departure, touches, invalidation, sweeps,
and fast attacks. The payload is still not an algorithm input and cannot erase older
qualifying touches.

Automatic campaign state and trial summaries are stored separately in
`data/goldilocks-research.sqlite`. A campaign configuration hash, dataset-manifest
key, backtest run ID, official realized-R metrics, per-pair metrics, and every
versioned management-policy summary remain attached to each trial. The default
archive ceiling is 5 GiB including the candle SQLite WAL/SHM and retained legacy gzip
sources; acquisition pauses at the high-water mark instead of silently deleting data.
The Campaign Backtester is the shared viewer for manual campaign runs and the
backtest runs created by Research campaigns. Its campaign search resolves public GLR
IDs, internal backtest IDs, Research trial IDs, and parent Research campaign IDs; the
parent view preserves the complete contained-run list. A running Research trial is
linked to its backtest row as soon as that row is created, not only after completion.
Automatic research is continuous by default, but its market-data window never rolls.
Every manual and Research campaign uses candle-open timestamps from
`2025-01-01T00:00:00Z` inclusive through `2026-01-01T00:00:00Z` exclusive. Once the
fixed archive is sealed, later cycles queue distinct configurations against those same
2025 candles. Every trial retains the same window contract and a dataset key derived
only from that bounded archive. The campaign continues until a user explicitly pauses
or stops it; live/demo strategy settings are never promoted automatically.
When workstation startup recovers an interrupted campaign, it also retires the
queued/running backtest row owned by that dead campaign worker before returning the
interrupted trial to the queue. Partial rows remain failed evidence, while the queued
trial receives a clean deterministic rerun. An unrelated manual backtest is never
retired by campaign recovery.
Automatic comparison matrices use the fixed 365-day 2025 UTC calendar window for every
strategy stack. Lookback and cutoff are not editable research or Backtester inputs.
The queue editor identifies trials by their immutable primary key and exposes only
research inputs; labels are generated from the trial ID, stack, and score threshold.
Each continuous cycle contains five trials. The first four stay anchored to the best
eligible stored configuration: an exact control, a one-point score adjustment, a
one-factor touch adjustment, and a fixed-target manager comparison. The fifth is a
seeded wildcard that rotates among manager, target, confirmation, entry-distance,
touch-limit, and score-weight variants. Wildcards remain research-only and never
change live/demo settings automatically. Session availability is not manually editable
from the queue.
Every newly rebased cycle normalizes the anchor to the current profile version, enables
mandatory Friday liquidation, and disables the backtest-only reverse-signal option.
This prevents a historically strong but automation-incompatible weekend-hold artifact
from seeding another nominally promotable cycle.

## Event vocabulary

Important worker steps include:

- `loading_zones`, `waiting_for_confirmation`
- `spread_rejected`, `entry_proximity_rejected`, `final_execution_rejected`, `execution_coverage_rejected`, `weekly_market_hours_rejected`, `runway_rejected`, `score_rejected`
- `historical_holiday_rejected`, `departure_quality_rejected`
- `purity_measured`, `available_rrr_measured`, `approach_pressure_measured`, `score_complete`
- `zone_corridor_measured`
- `placing_trade`, `order_rejected`
- `trade_manager_break_even`, `trade_manager_protected_win`
- `trade_manager_weekend_liquidation`, `trade_manager_weekend_closed`, `trade_manager_weekend_close_retry`
- `trade_manager_win`, `trade_manager_loss`
- `trade_manager_armed`, `trade_manager_progress`, `trade_manager_risk`, `trade_manager_heartbeat`, `trade_manager_path_summary`
- `safety_guard`, `final_safety_rejected`

Prefer `step`, `pair`, `data_json`, and timestamps over parsing display text. Display
messages may change; structured fields are the stable interface.

## Build an analysis dataset

Create one row per candidate setup, not only one row per executed trade. Otherwise the
model cannot learn why a setup was rejected and will suffer selection bias. A future
exporter should include:

- Dataset and strategy version identifiers
- Pair and H1/M15/M5 signal timestamps plus M1 execution timestamps
- Zone ID, side, kind, age in exact seconds from the originating M15 base to M5 entry eligibility, width, ATR ratio, leg ratio, and prior touches
- Departure candle range/ATR, body and rejection-wick fractions, close-based and
  wick-based displacement multiples, and M1 concentration when available
- Every qualifying prior-touch candle observed before the trigger
- Trend, range half, base candle count, M15 candles lingering inside the zone before
  the first outside candle, sustained close-departure multiple, and structural reversal flag
- MTF confluence relationships
- Available opposing-zone distance and RRR
- Pre-touch confirmation-timeframe approach-pressure fields measured from the latest
  opposite extreme back toward the zone: liquidity-sweep count/time/depth, reaction
  displacement in causal ATRs, directional step/close fractions, progress in zone widths,
  compression score, confirmation body/close-through/rejection-wick fractions, confirmation
  strength, and the zero-to-two adverse warning-category count
- Every hard gate and its reason
- Score component vector, total, and configured threshold
- Executable bid/ask spread where available
- Entry, stop, 1R, 2R, outcome time, exit reason, and realized R/P&L
- The entry-time M5/M15/H1 demand-to-supply corridor: raw width, pips, ATR-normalized
  width, entry location percent, initial-risk/target/opposing-room percent, and the
  percentages occupied by 1R, 2R, and 4R. Missing corridor sides remain unavailable.
- A policy-independent M1 path summary: MFE/MAE in R, ending R, coverage bounds/count,
  first time each positive and negative R milestone was reached, and intrabar ambiguity.
- One child row per versioned manager evaluated on that identical path. The 25-policy
  grid covers set-and-forget targets from 1R through 5R, break-even-at-+1R targets from
  1.5R through 5R, and 25%, 50%, or 75% runners after 2R toward 3R, 4R, or 5R.
  Runner stop is +1R.
- For live/demo executions, requested and broker-confirmed manager events, broker
  transaction responses, sampled executable-quote MFE/MAE, and coverage timestamps.
- For secure-half replay visualization, the +1R partial timestamp/price and final
  remainder-exit timestamp/price are distinct events; the final label carries combined
  realized R rather than calling the whole trade break-even.
- Whether the row came from live, demo, or backtest data

Keep rejected candidates. Mark unavailable features as unavailable rather than zero.
The approach-pressure thresholds are research labels only. Do not promote them into a gate,
score component, or risk modifier until chronological out-of-sample expectancy and drawdown
show stable value across pairs and regimes.

The read-only `GET /api/backtests?training=true&runId=<id>` export returns one row per
trade/policy combination. It deliberately reports `imageStatus: "deferred"`; chart-image
capture is not part of the current data contract. The normal stored backtest result remains
unchanged, so counterfactual manager research cannot silently alter strategy behavior.
The read-only `GET /api/automation/trade-management?tradeId=<broker-trade-id>` endpoint
returns the permanent live/demo manager ledger for one broker trade.

The built-in demo automation and automatic research control execute
`secure-half-atr-runner-v3` (`Secure Half + ATR Runner`): at +1R the stop moves to entry first, 50% is closed,
the broker take-profit is removed, and the remaining 50% follows a causal 2x ATR(14)
chandelier stop that never loosens or moves behind entry. An explicitly approved demo
configuration may instead use set-and-forget with its selected fixed-R or opposing-base
target. The research child rows expose all policies side by side for comparison. A manual Backtesting run may explicitly select the prior
`legacy-score-tiered-2r-4r-v1` manager instead; that choice is frozen in the run
configuration and affects official realized-R and portfolio metrics without changing
live/demo automation. Fresh manual runs default to `set-and-forget-2r-v1`, which retains
the original stop and a configurable fixed target without interim management;
mandatory Friday liquidation remains a global safety rule. The initial target selection
is the automatic opposing-base mode. Its optional fixed target-R value
defaults to 2, is bounded from 1 through 20, and becomes both the take-profit multiple
and the minimum opposing-zone runway for that run. Its alternative `opposing-base`
mode fixes take-profit at the proximal edge first touched on the most recent opposing
base that was causally usable at entry. It fails closed when no such base exists ahead
of entry, and it retains the hard minimum runway gate: the opposing-base touch must
offer at least 2.00R from executable entry. A value below 2R rejects the setup before
scoring; exactly 2.00R passes.
Replay preserves that target base ID, target price, and resulting R multiple so a chart
does not substitute a nearer continuation or a hardcoded 2R marker.
Manual runs may additionally select `bank-half-untouched-stop-runner-v1`. It
banks 50% at +1R and removes the take-profit while retaining the original -1R
stop unchanged for the runner. It never moves to break-even or trails; an
original-stop exit after the partial totals 0.00R, and mandatory Friday
liquidation remains active.
`adaptive-attack-scale-out-runner-v1` adds causal +1R/+2R/+3R scale-outs while
retaining the original stop. Each milestone banks 25% of the original position
when the preceding 0.5R completed within 30 minutes, otherwise up to 50%, while
always preserving a final 25% runner. Treat this as a research hypothesis until
same-data and out-of-sample comparisons establish robust expectancy and drawdown.
After a fast-momentum 25% partial, a 0.5R retracement from the prior favorable
extreme banks all exposure above the final 25% runner as a causal risk-off
response. A slow 50% partial does not trigger that redundant reduction.

Manual backtests may opt into the versioned `yolo-reverse-final-signal-v1` execution
assumption. It reverses only the final qualified side and mirrors the original R geometry;
it does not retrain, rescore, or alter live/demo signals. Keep YOLO runs labeled and
separate from official-direction baselines.
Manual backtests may separately disable the default `Close trades before weekend`
assumption. Disabled runs omit simulated Friday liquidation but retain the weekly
entry-hours gate unless that independent gate is also disabled. This setting is
backtest-only and never changes live/demo weekend safety.

Strategy `0.51` applies the same account-wide admission policy to live/demo orders and
the chronological portfolio projection. A candidate must leave at least 50% of NAV as
available margin, keep projected margin-closeout usage at or below 25%, and keep known
plus conservatively estimated open stop risk at or below 2% of NAV. Live/demo workers
coordinate through an atomic, expiring SQLite reservation so two different-pair workers
cannot spend the same account headroom. `marginBlocked` is a portfolio-capacity result,
not a strategy-signal rejection. The historical projection remains conservative and
simplified: it does not continuously mark intratrade equity to market and does not
reconstruct historical broker margin tiers.
Official strategy-edge and research metrics use only chronologically portfolio-admitted
trades. Margin-blocked signals retain their counterfactual outcome for missed-trade
research, but they contribute nothing to realized R, expectancy, profit factor, win
rate, loss streak, drawdown, or projected account P/L.

Immediate-touch research uses the first confirmation-timeframe OHLC intersection and
models entry at the proximal boundary. Demo automation observes the same boundary from
new OANDA executable stream quotes (ask for demand, bid for supply), freezes that exact
quote time, runs all remaining gates, and places a market order from a second fresh
quote. Configuration parity and signal-boundary parity can therefore be tested exactly,
but historical realized R cannot prove fill parity: archived midpoint candles omit
spread, sampled stream timing, decision latency, and slippage. Research runs with
`closeTradesBeforeWeekend=false` are also ineligible for automation because Friday
liquidation is a permanent live/demo safety rule.

## Prevent leakage

- Split data chronologically, never randomly across overlapping candles.
- Keep entire trades and their source swing legs in one partition.
- Fit thresholds and models only on the training period.
- Use a later validation period for selection and a final untouched test period once.
- Run walk-forward windows across different volatility regimes and pairs.
- Compute zones using only candles that were completed and available at that timestamp.
- Never use final zone touch counts, future invalidation, or future opposing zones as
  entry-time features.
- Version every strategy change and retain failed experiments.
- Treat the D1/H4/H1 profile as a separate strategy version; never merge its rows with
  H1/M15/M5 as though the setup detector were unchanged.
- Treat M15/M5/M1 as its own `m15-m5-m1-research-v4` strategy version as well.
  Its confirmation and execution-resolution inputs are both M1, but simulation begins
  only after the confirming M1 candle completes; never reuse that completed candle's
  range as post-entry evidence.

## Metrics

Report at minimum:

- Trade count and exposure time
- Win rate with confidence interval
- Average win/loss in R
- Expectancy per trade in R
- Profit factor
- Maximum drawdown in R and percent
- Longest losing streak
- Results by pair, direction, zone kind, score bucket, and calendar period
- Sensitivity to spread, slippage, and one-candle outcome ambiguity

The backtesting dashboard treats final realized-R expectancy as the primary ranking
metric. Profit factor, average win/loss R, payoff ratio, net R, and drawdown provide
the surrounding economics. Positive-R trade rate is displayed as a consistency
diagnostic only. The chosen manager's realized-R result is authoritative: the default
manager records +0.5R after its +1R partial and later break-even exit, while the prior
manager records 0R when break-even occurs before its 2R target. Pair and
tweak comparisons under 50 realized-R trades are marked early; prefer 100+ before
drawing an initial conclusion and still require chronological out-of-sample validation.

The continuous Research Status all-time table accepts only fixed-2025 configurations
with at least 100 trades: net R leads, except that a result within 3R of the current
net-R leader ranks ahead when its maximum drawdown is more than 5% lower. This rule
also selects the baseline used by the next continuous comparison cycle. It does not
activate a Pi strategy automatically.

A strategy with a higher win rate can still be worse if losses, drawdown, or execution
costs increase. Require adequate sample sizes before accepting a tweak.

## AI operating boundaries

A personal AI may:

- Explain a stored decision using the score and gates
- Compare labeled backtest versions
- Find logging gaps and create reproducible regression fixtures
- Propose one isolated change with a falsifiable hypothesis
- Generate research reports from read-only snapshots

It must not:

- Place or modify a live trade merely because an experiment looks profitable
- Change risk percent, threshold, stop logic, or safety gates without explicit approval
- Remove losing runs or cherry-pick time windows
- train on secrets, account IDs, tokens, or personally identifying data
- infer P/L from the protected-win label instead of using the selected manager's stored realized R
- claim profitability from backtest win rate alone

## Experiment record

Every tweak should record:

1. Hypothesis and exact rule change
2. Code commit or diff identifier
3. Strategy/version label
4. Dataset coverage and hash
5. Threshold and all configuration
6. Baseline and candidate metrics on identical windows
7. Walk-forward and held-out results
8. Known simulator omissions
9. Decision: reject, research further, or practice-test

Do not overwrite baselines. The backtesting dashboard's tweak label is part of this
record, not a substitute for a commit and dataset version.

## Skill usage

The repo-local `$goldilocks-strategy` skill tells an AI how to inspect, explain, test,
and modify this system. Invoke it for strategy questions, chart discrepancies, scoring
changes, backtest interpretation, log analysis, or automation safety reviews.

Before trusting a generated change, require the strategy tests, TypeScript checks, a
labeled comparison run, and human review in practice mode.
