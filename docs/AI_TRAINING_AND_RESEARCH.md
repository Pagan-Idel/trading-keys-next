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

## Available data

The primary database is `data/automation.sqlite` in WAL mode.

| Table | Purpose | Retention |
| --- | --- | --- |
| `automation_events` | Structured worker/candylog events and rejection reasons | 3 days |
| `worker_status` | Latest state and reason per pair | Latest row per pair |
| `active_trades` | Restart recovery and dashboard state | Until closed/cleared |
| `trades` | Closed live/demo trades and journal JSON | Persistent |
| `backtest_runs` | Tweak/version configuration and aggregate results | Persistent |
| `backtest_trades` | Historical simulated entries, scores, outcomes, and context | Persistent |
| `backtest_events` | Backfill, scan, progress, and completion events | Persistent |

Candle archives under `data/` are inputs. Treat them as versioned datasets even when
they are not committed to Git. Record pair, timeframe, earliest/latest timestamp,
candle count, data source, and a content hash for reproducible experiments.

## Event vocabulary

Important worker steps include:

- `loading_zones`, `waiting_for_confirmation`
- `spread_rejected`, `runway_rejected`, `score_rejected`
- `purity_measured`, `available_rrr_measured`, `score_complete`
- `placing_trade`, `order_rejected`
- `trade_manager_break_even`, `trade_manager_protected_win`
- `trade_manager_win`, `trade_manager_loss`
- `safety_guard`, `final_safety_rejected`

Prefer `step`, `pair`, `data_json`, and timestamps over parsing display text. Display
messages may change; structured fields are the stable interface.

## Build an analysis dataset

Create one row per candidate setup, not only one row per executed trade. Otherwise the
model cannot learn why a setup was rejected and will suffer selection bias. A future
exporter should include:

- Dataset and strategy version identifiers
- Pair and M15/M5/M1 timestamps
- Zone ID, side, kind, age, width, ATR ratio, leg ratio, and prior touches
- Every penetration depth observed before the trigger
- Trend, range half, base candle count, departure multiple, reversal flag
- MTF confluence relationships
- Available opposing-zone distance and RRR
- Every hard gate and its reason
- Score component vector, total, and configured threshold
- Executable bid/ask spread where available
- Entry, stop, 1R, 2R, outcome time, exit reason, and realized R/P&L
- Whether the row came from live, demo, or backtest data

Keep rejected candidates. Mark unavailable features as unavailable rather than zero.

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
- treat protected break-even wins as positive P/L when calculating expectancy
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
