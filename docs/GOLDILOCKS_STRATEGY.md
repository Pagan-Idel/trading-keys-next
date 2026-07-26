# Goldilocks Strategy and Code Guide

## Purpose and authority

This document explains the Goldilocks strategy as it is currently implemented. It is
the human-readable strategy contract for maintainers and AI agents. When prose and
behavior disagree, inspect the cited implementation, add a regression test, and then
update both the code and this guide together.

The original source reference is
[`20-point-scoring-sheet.pdf`](reference/20-point-scoring-sheet.pdf). The code has
deliberate adaptations agreed during development, including a three-point trend maximum,
a four-point departure-quality category, a five-point approach-warning category, and a
four-point multi-timeframe confluence category, while preserving a 20-point total.

The objective is not maximum raw profit. The research objective is higher
out-of-sample expectancy and stability under bounded risk, drawdown, spread, and
execution constraints.

## Current demo timeframe stack

| Role                  | Timeframe | Use                                                        |
| --------------------- | --------- | ---------------------------------------------------------- |
| Context               | H1        | Swing trend and premium/discount range alignment           |
| Zone                  | M15       | Base and continuation demand/supply zones                  |
| Zone lifecycle        | M15       | First outside candle and zone validity                     |
| Prior-touch purity    | M5        | Every touching candle before the first trade trigger        |
| Trigger               | M5        | Trade touch and later close-through confirmation           |
| Execution resolution  | M1        | Post-entry stop, +1R, break-even, and target ordering only |
| Confluence            | M5/M15/H1 | Same-side overlapping zone count                           |

These are intentionally small for rapid practice testing. Keep them centralized in
`utils/goldilocksConfig.ts` when moving to higher timeframes.

Backtesting, automatic research, and Strategy Lab also expose the non-live
`m15-m5-m1-research-v3` profile: M15 trend/range, M5 zones and first-outside
lifecycle, and M1 prior-touch purity plus first-touch/later close-through
confirmation. M1 is also the lowest available post-entry resolution. Entry becomes
eligible only after the confirming M1 candle completes, and outcome simulation starts
with the next candle at that close time; it never uses the confirming candle's
already-completed range to resolve the trade. This profile does not change the
live/demo worker.

The Historical Trade Replay page is opened from recorded-trade `View chart` links and
is locked to the production intraday stack: M5 confirmation, M15 zones,
and H1 trend, with M1 retained only for touch and execution drill-down. Its chart can
display M1, M5, M15, or H1 while preserving that role contract; it does not expose a
timeframe-stack selector. A historical trade replay draws the selected stored trade,
its entry/stop/target risk-reward area, its originating zone, and the nearest
opposite-side zone that was active at entry. Generic historical context zones are omitted.
Its permanent trade ID appears as a candy-styled copyable badge along the bottom of the
chart so screenshots and visual audits retain the recorded-trade identity.
The active indicator feed includes only setups whose current-version score is eligible.
An older stored trade from a compatible H1/M15/M5 strategy version shows its stored
trade, entry marker, risk-reward box, and reconstructed trade-zone overlay together
with a legacy audit notice; the notice prevents the row from being mistaken for a
current-version setup.
Reaching either chart edge reveals an in-chart button for explicitly loading the next
older or newer candle page. Loaded candles merge by stable candle time, the visible
time range remains fixed without an automatic scroll jump, and the button moves to the
new history boundary. Box and
Fibonacci drawings persist locally per pair and visible timeframe, with optional OHLC
light-magnet snapping. Clicking a displayed trade's touch candle switches to M1.
The displayed prior-touch amount is measured as touching candles on M5, the confirmation
timeframe. Purity arms on the first completed M5 candle fully outside the zone after its
base. Every later completed M5 candle intersecting the zone counts individually,
including consecutive touching candles. The trade-trigger M5 candle is excluded from
prior history. M15 separately retains its originating departure for zone lifecycle and
departure-quality evidence.
Replay charts mark reconstructed prior-touch candles with orange dots only; they omit
the timeframe and sequence label and do not render a per-touch audit list.
They also anchor a `DEPARTURE` arrow to the first completed zone-timeframe candle
fully outside the trade zone. That same candle supplies departure-quality scoring and
the zone-formation news window. A departure rejected by the two-of-three shock gate keeps
the same departure marker without displaying shock or wick-rejection diagnostics.
For a current-version stored replay, the saved touch count remains authoritative. A
legacy replay preserves its stored score but displays the current
causal touch reconstruction so contract changes are visible.
The replay audit separates entry proximity from purity: M5 touch-range and executable-
entry percentages are hard-gate measurements, while the M5 prior-touch candle count
alone determines the 0/2/4 purity score.
The expanded audit begins with version-aware score components and hard gates. Component
titles describe their strategy role rather than hardcoding a timeframe; the stored
source name and evidence retain the actual timeframe used by that run. Each component
and detailed measurement explains why it is checked, how to interpret it, and what
characterizes stronger evidence without changing the stored trade retrospectively.
Audit-card titles are unnumbered. The confirmation-timeframe warning card focuses on
the two scored pre-touch categories: a confirmed liquidity-pool sweep and a fast
momentum approach. Compression remains visible context but is not adverse and does
not deduct points. Confirmation strength is omitted from this score explanation;
the binary close-through confirmation remains the required entry trigger.
Stored backtest rows keep their original immutable diagnostic JSON, while Historical
Trade Replay causally recomputes the current diagnostic version from its archived
pre-touch and confirmation candles so detector fixes are visible without rewriting the
saved run.
Diagnostic-only zero-maximum entries are omitted from the Score Components table so it
contains only components capable of awarding points.
The Score Components card leads with the stored total out of 20, its minimum threshold,
and the resulting pass/fail status.

The historical research runner also exposes a separate, non-live
`d1-h4-h1-research-v3` profile. It mirrors the contract as D1 trend/range, H4 zones,
first-outside and prior-touch purity, H1 first touch plus a distinct later H1
close-through confirmation, and M5 post-entry ordering. Confluence is H1/H4/D1.
Selecting either research profile on Backtesting does not change the live/demo worker,
which remains locked to H1/M15/M5/M1.

## Market structure and trend

The swing labeler produces HH, HL, LH, and LL points. The scanner converts adjacent
compatible swing points into bullish and bearish legs. H1 trend uses protected external
structure rather than blindly following the newest internal label. In a bullish regime,
a wick below the latest confirmed protected HL flips trend bearish and freezes the
preceding external high as the bullish-reversal level. Internal HH or LH labels below
that protected high cannot turn trend bullish. Supply and demand are mirrored: a bearish
regime turns bullish only after price breaks its frozen external protected high; the
preceding external low then becomes the bearish-reversal level. If no usable confirmed
structure exists, trend is unknown. Live/demo scanning, Strategy Lab reconstruction,
manual backtests, and automatic research campaigns all consume this same protected-
structure timeline; long backtests merge overlapping swing-detection chunks before the
timeline is evaluated.

Strategy Lab displays every confirmed swing on the currently selected chart timeframe
as a native candle-anchored HH, HL, LH, or LL marker that remains attached through zoom
and scroll changes. Switching timeframe redraws the structure from
that timeframe's own candles rather than projecting another timeframe's labels. Older
pagination pages merge structure points by candle time so previously loaded labels
remain attached to their candles while chart history expands. A
reversal-strength condition is recorded when a leg changes from
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
leg. Continuations remain detected and drawn as context for runway and confluence
calculations, but cannot arm a touch, create a confirmation, receive a trade score, or
become an entry zone. Only base zones can create trades.

### Retired imbalance-balance-imbalance overlay

The experimental purple IBI overlays are no longer drawn in Strategy Lab. They were
research-only, never created live/demo entries, and never changed the 20-point score.
Strategy Lab now displays only the original Goldilocks base and continuation zones.

## Zone lifecycle

A zone can be fresh, touched, invalidated, or expired.

1. The originating leg must complete before the zone is available.
2. Once the structural break identifies the zone, scan forward from its M15 base: the first completed M15 candle fully outside is the originating departure and arms touch counting, even when it predates `availableAt`.
3. Purity arms on the first completed M5 candle fully outside the zone after its base. Every later completed M5 candle whose wick enters the zone counts as one qualifying prior touch, provided it completes before the first M5 trade-trigger touch. Consecutive touching M5 candles count individually.
4. Equality with the proximal boundary counts as a touch.
5. Touch depth has no effect: any intersection with the zone counts as exactly one touch.
6. The first M5 candle whose wick intersects the zone is frozen as the trade-trigger touch. Later touching M5 candles cannot replace it while the strategy waits for close-through confirmation.
7. The first M5 trigger candle and all later candles are excluded from prior-touch count. They belong to the pending trade trigger, not the pre-trigger purity ledger.
8. A fourth qualifying touch invalidates the zone; three remains the maximum allowed.
9. Demand invalidates when a wick trades below its distal low. Supply invalidates when
   a wick trades above its distal high.
10. A continuation also invalidates if price reaches its same-side base.
11. An otherwise active zone expires after 30 calendar days. Historical records
    remain available, but an older base cannot create a new setup.
12. A zone is rejected when a high-impact event for either pair currency overlaps the
    interval from its M15 base candle open through the end of its first completed M15
    departure candle. Missing historical coverage fails closed.

Invalid and expired zones remain historical records but cannot create new entries.
Charts normally show only the nearest active demand and supply zones, plus historical
zones that explain a drawn trade. Strategy Lab highlights an oversized rejected M5
first-touch candle in orange with the compact label `FAILED 1ST TOUCH` only while its
source zone remains usable at the displayed historical time and that source zone is
actually drawn. An unrelated or hidden zone cannot leave an orphan marker on a stored
trade replay.

## Touch and confirmation

M15 owns the first outside candle. M5 owns prior-touch purity, the first trade touch,
and later confirmation. M1 never creates a setup; it is retained only to resolve
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

Available reward-to-risk is the distance from entry to the nearest edge of the stored
opposing zone divided by risk to the selected entry zone's stop. It remains part of the
2R runway gate and research record, but it awards no quality-score points.

## Hard gates

All gates must pass before scoring and again where volatility can change the result:

| Gate                | Current rule                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Market              | Forex market open and configured holiday rules allow trading                                                                                                                                                                                                                                                                                                    |
| Weekly close/reopen | Reject entries from Friday 16:00 through Sunday 18:00 America/New_York; this includes the final hour before Friday close and first hour after Sunday reopen                                                                                                                                                                                                     |
| Weekend liquidation | At Friday 16:00 America/New_York, close every managed Goldilocks position and retry broker failures until the 17:00 close                                                                                                                                                                                                                                       |
| Holiday             | Reject during configured holiday windows                                                                                                                                                                                                                                                                                                                        |
| Session             | At least one currency's local trading session is active                                                                                                                                                                                                                                                                                                         |
| News                | Reject high-impact events for either currency from one hour before through one hour after; fail closed if news status is unavailable                                                                                                                                                                                                                            |
| Zone formation news | Reject a zone when either currency's high-impact news window overlaps its M15 base-through-completed-departure interval; fail closed if formation coverage is unavailable                                                                                                                                                                                       |
| Existing trade      | Only one open broker trade per pair                                                                                                                                                                                                                                                                                                                             |
| Zone                | Active, no more than 30 calendar days old, no more than three touches, not broken                                                                                                                                                                                                                                                                                |
| Confirmation        | Latest completed M5 close-through after a distinct M5 touch candle                                                                                                                                                                                                                                                                                              |
| Entry proximity     | First M5 touch range must be no more than 50% of M15 zone width; the fresh executable ask for BUY or bid for SELL must remain no more than 50% of one zone width beyond the proximal edge. The confirmation close has no separate distance gate. Historical backtests use that close as the modeled executable entry because historical bid/ask is unavailable. |
| Adverse approach    | Reject when the final three completed M5 candles displace at least 1.5 prior M5 ATR toward the zone, the first-touch candle spans at least 1.5 ATR, and its close penetrates at least 50% of the zone. A touch candle that wicks through but closes back beyond the proximal edge is an absorption reclaim and explicitly passes this gate.                     |
| Spread              | Valid quote and no more than 3 pips                                                                                                                                                                                                                                                                                                                             |
| Runway              | Clear 2R at confirmation and current executable entry                                                                                                                                                                                                                                                                                                           |

Gates receive no points. A failed gate prevents scoring and order submission.

## The implemented 20-point score

The default threshold is 14/20. A score below the configured threshold is explicitly
logged and skipped. Equal to the threshold passes.

| Component                         | Maximum | Current rule                                                                                                                                                                                                                                            |
| --------------------------------- | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1 trend                          |       3 | Trade direction aligned with current H1 swing trend                                                                                                                                                                                                     |
| M15 departure quality             |       4 | Combined M15 formation count: 1 candle = 3, 2 = 2, 3 = 1, 4+ = 0. Sustained close displacement: below 2x = 0, 2x or greater = 0.5, 4x+ = 1. |
| M5 approach warnings              |       5 | Zero warnings = 5, one = 3, both = 0. The categories are a confirmed liquidity-pool sweep and a fast momentum approach into the zone. Compression is not penalized. |
| M5 purity                         |       4 | No prior M5 touch candle = 4; one prior touch = 2; otherwise 0                                                                                                                                                                                          |
| Zone inside zone (MTF confluence) |       4 | Same-side overlap: one timeframe = 0; two = 2; all three = 4. Chart label: `ZIZ n/3 · timeframes`.                                                                                                                                                      |

Score-audit tables distinguish awarded points from the confluence count: for example,
`ZIZ 2/3` displays as `2 pts (max 4)`, keeping awarded score separate from the
timeframe confluence count.

The departure-quality score gives three points to formation compactness and one to
sustained close displacement. A one-candle base followed immediately by the first M15
candle that closes beyond the zone earns all three compactness points. A lingering candle
is any completed M15 candle after the selected base candle and before that first close-away candle whose
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

| Profile    | Risk at 14/20 | Risk at 20/20 |
| ---------- | ------------: | ------------: |
| Easy       |         0.10% |         0.25% |
| Default    |         0.25% |         0.50% |
| Aggressive |         0.50% |         1.00% |

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
Its Backtest rule controls are organized into three saved groups: enable/disable
switches for historically simulated hard gates, editable score-component weights, and
numeric touch-count, entry-proximity, adverse-approach, departure-shock,
departure-strength, and available-RRR thresholds. These controls affect backtests only
and never alter the live/demo worker. Starting a run immediately inserts its queued row into Backtest runs while
the detached worker starts, and every saved run retains the complete normalized tweak
snapshot in its configuration JSON. Loading a prior run restores those inputs into
the editor. Zone-edge stops and exact 2R target placement remain fixed execution
contracts; disabling the runway gate changes research eligibility only.
The editor presents score weights as five plain-language categories: trend, departure,
purity, approach warnings, and zone-inside-zone. They always total exactly 20. Moving
one category proportionally rebalances the other four; internal
partial-credit tiers (such as one-touch purity and two-of-three ZIZ) scale
automatically. The entire controls area is collapsed by default, and hovering or
focusing any editable card exposes its plain-language explanation.
Its history shows one clickable row per complete backtest run rather than duplicating a
run into pair rows. Loading a row restores the saved account, leverage, risk, timeframe,
score, lookback, and pair configuration together with that run's account projection,
trades, replay links, and event log. A dedicated run-configuration table and the history
row's hover/focus details expose the saved tweaks for the selected run.
The Run column stays compact by showing only the `View tweaks` button; its hover/focus
details include the long saved label and compact numeric tweak snapshot. The separate
selected-run tweaks table was removed because it duplicated the active editor.
The new-run label contains only the selected strategy version and UTC run date
(`strategy-version · YYYY-MM-DD`). Detailed weights and settings remain in the saved
run configuration instead of cluttering the label. A restored historical run keeps its
stored label when prepared for a rerun.
Dashboard edge reporting is calculated from each trade's final realized R. It leads
with expectancy per trade and profit factor, and also reports average positive R,
average absolute loss R, payoff ratio, profitable-trade rate, break-even trades, net R,
maximum drawdown in R, and longest losing streak. A protected break-even remains a
reached-1R diagnostic but contributes 0R and is not counted as a profitable trade.
Profit factor is gross positive R divided by gross negative R: an all-winning sample
displays infinity, while a run containing only break-even trades (or no realized-R
trades) displays `No P/L` because the ratio is undefined.
Pair/tweak rows rank by realized-R expectancy rather than win rate and flag samples
below 50 trades as early evidence; 100 or more is the preferred initial review size.
Every stored trade also receives a deterministic `GL-PAIR-YYYYMMDD-HHMM-HASH` ID that
survives progress rewrites and can be searched globally from the dashboard.
New backtest and live/demo trade records store zone age as exact seconds from the
originating M15 base candle to M5 entry eligibility; dashboards display the same value in days.
Approach pressure uses only completed candles available before the first touch. Its
causal leg begins with the first confirmation-timeframe candle that
closes away from the zone and ends with the candle immediately before first touch; there
is no fixed candle-count window. When that span contains more than 500 source candles,
the same start/end interval is aggregated to the smallest standard higher resolution
that produces at most 500 candles for whole-leg approach-shape analysis; the warning
scope never moves. Liquidity sweeps and their required opposite reaction use the same
confirmation-timeframe candles as approach shape. If the full interval exceeds 500
candles, both use the same smallest standard higher resolution. At first touch, both
warning categories are narrowed to the actual return leg: supply starts at the latest
lowest low between departure and touch, while demand starts at the latest highest high.
It keeps four measurements separate:
confirmed liquidity-pool sweeps, reaction displacement in pre-touch confirmation-timeframe ATRs, the whole-leg approach shape, and
confirmation-candle research fields. Approach shape classifies the return leg as
tightening compression, orderly approach, momentum drive, or mixed/unclear.
The leg is directional when at least half its candles close toward the zone or at
least half its successive adverse edges step toward the zone. Tightening compression
requires that directional condition plus a composite score of at least 60%: range
contraction contributes 30%, body contraction 20%, adjacent-candle overlap 25%, low
net-progress efficiency 15%, and directional consistency 10%. Compression is descriptive
only. Fast approach detects distinct multi-candle momentum pushes rather than isolated
large candles. A pullback of at least 0.35 prior ATR ends the current push and starts
a new candidate. A completed push qualifies when its net close displacement toward
the zone is at least 2 prior ATR and 1.25 zone widths, while retaining at least 60%
close-path efficiency and at least two advancing close-to-close steps. This separates
strong advances divided by a meaningful pause or pullback and rejects both one-candle
spikes and smaller noisy moves. Each qualifying
push counts once and receives one `FAST ATTACK` marker at its source-timeframe origin:
the highest high before an attack into demand or the lowest low before an attack into
supply. One or more pushes
create the single fast-approach warning category; additional pushes do not stack score
deductions. A directional
return without those impulses is orderly and earns no warning; a non-directional return
is mixed/unclear and also earns no warning. A pre-touch liquidity sweep can qualify
through either of two paths on the confirmation timeframe. The standard path starts
with a liquidity pool. It can be either at least four contiguous sideways
candles whose adverse edges stay within 0.25 local ATR, total range stays within
1.5 ATR, close drift stays within 0.75 ATR, and adjacent candles retain meaningful
range overlap; or at least two separated swing pivots whose adverse edges stay within
0.25 local ATR and which produce at least one ATR of intervening reaction away from
that shared edge. The structural form captures equal lows for supply approaches and
equal highs for demand approaches without treating rolling edges as a pool. Second,
the first candle to breach the completed pool must wick through the shared adverse
edge by at least 0.15 prior ATR and close back inside it by at least 0.02 prior ATR
or 1% of the zone width, whichever is greater. Third, that candle or a later
pre-touch candle must react
at least 1.25 local
ATR in the opposite direction and close through the pool midpoint before price makes
a newer adverse extreme. Demand uses the
upside mirror and supply uses the downside definition. The alternate deep-sweep path
does not require equal lows, equal highs, or a sideways pool. A wick must clear one
prior adverse swing by at least 3.25 prior ATR, then that candle or one of the next two
analysis candles must recover at least 1.25 ATR and close back across the swept swing
before price makes a newer adverse extreme. A shallower breach without a standard pool,
or either path without the completed opposite reaction, is not a sweep. The breach and reaction are
one combined warning, never two separate deductions. Only sweep candles at or after
the return-leg extreme can qualify; earlier departure-side sweeps are ignored. Pool
context immediately before that extreme may still establish a sweep occurring exactly
at the turn. The detector does not use a fixed lookback count. One or more completed patterns
create one warning category; additional markers do not stack score deductions. The
`adversePressureScore` counts the two adverse warning
categories from zero to two and drives the five-point approach-warning score. New backtest trades
persist the structured measurement; live/demo workers emit `approach_pressure_measured`
and retain the same object in the trade journal. Existing records display `Legacy`.
The offline regression fixture for `GL-GBPUSD-20260331-1210-8E930F13` preserves its
actual causal M5 return-leg candles and must continue to produce the 1:15-1:45 AM CDT
structural equal-low pool, 2:15 AM sweep, 2:30 AM recovery, three fast pushes, two
warning categories, and a 9/20 score.
The companion negative regression for `GL-GBPJPY-20260706-0305-2C94E8FA` must reject
its July 2 11:00 PM CDT probe: it breached the M15 pool by only 0.02 ATR and its
immediate recovery reached only 1.08 ATR. Its July 3 1:30 AM CDT wick qualifies through
the deep-sweep path, while a separate later standard sweep still belongs to the same
single sweep-warning category.
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
Switching to a different stored trade clears the previous replay's visible-time-range
memory before framing the new zone base, entry, and exit, so its selected trade zone and
trade markers cannot remain off-screen in the prior trade's viewport.
When the replay also projects contextual M15 zones onto M5, M15, or H1, its visible
start expands to include the earliest displayed zone's originating base candle. A zone
must not be clamped to the first chart candle and appear as a floating rectangle without
its price source. The selected entry zone is labeled `HISTORY TRADE ZONE`; the retained
opposing zone remains intentionally unlabeled to reduce chart noise. The selected trade
zone's ZIZ count comes from its stored entry-time backtest score, because a bounded
visual replay may not contain the older source zones needed to reconstruct that count.

Historical simulation currently:

- Uses the selected profile's archived trend/zone/confirmation candles and its
  configured post-entry resolution; the M15/M5/M1 profile uses M1 for both
  confirmation and the lowest available outcome resolution
- Reconstructs zones without future eligibility at the setup timestamp
- Applies zone validity, close-through confirmation, 2R runway, scoring, and one open
  simulated trade per pair
- Freezes the first M5 zone overlap as the trigger, excludes its containing M15 candle
  from prior-touch purity, and applies the 50%-of-zone-width touch-range and modeled
  executable-entry proximity gates
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
  inside that window. A zone whose M15 base-through-departure formation interval overlaps
  that window is also rejected. Missing calendar coverage fails closed instead of being treated
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
`data/goldilocks-research.sqlite`. The default bounded search evaluates score cutoffs
10, 12, 14, 16, and 18 across all three timeframe profiles and eight interpretable
strategy families: baseline, freshness-first, structure-first, confluence/runway-first,
balanced context, and isolated session, entry-proximity, and adverse-approach gate
ablations. Core market-hours, holiday, news, and 2R-runway safety gates stay enabled
in every family. This produces 120 trials and records all 22 management-policy outcomes
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
Historical scans pre-index each zone's first completed outside candle once and then
advance causally through confirmation candles. They must not rescan the complete zone
timeframe archive for every active-zone/confirmation-candle combination.

## Code map

| Area                                       | Primary files                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Strategy configuration                     | `utils/goldilocksConfig.ts`                                                                                     |
| Zone lifecycle and runway                  | `utils/goldilocksStrategy.ts`                                                                                   |
| Swing conversion, trend, range, confluence | `utils/goldilocksScanner.ts`                                                                                    |
| 20-point calculation                       | `utils/goldilocksScoring.ts`                                                                                    |
| Live/demo orchestration                    | `workers/goldilocksWorker.ts`, `runner/startRunner.ts`, `runner/strategyRunner.ts`                              |
| Spread/session/news/market gates           | `utils/spreadGuard.ts`, `utils/sessionUtils.ts`, `utils/newsGuard.ts`, `utils/marketCloseGuard.ts`              |
| Position sizing and broker order           | `utils/placeTrade.ts`, `utils/oanda/api/`                                                                       |
| Persistent logs and trades                 | `utils/automationLogger.ts`, `utils/automationStore.ts`, `utils/tradeHistory.ts`                                |
| Historical simulation                      | `utils/goldilocksBacktest.ts`, `utils/backtestRunner.ts`, `utils/backtestStore.ts`, `workers/backtestWorker.ts` |
| Dashboards                                 | `pages/automation.tsx`, `pages/strategy-lab.tsx`, `pages/backtesting.tsx`, `pages/research.tsx`                 |
| Regression specification                   | `tests/goldilocksStrategy.test.ts`                                                                              |

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
