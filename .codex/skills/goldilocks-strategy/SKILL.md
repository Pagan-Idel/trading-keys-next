---
name: goldilocks-strategy
description: Operate, explain, test, debug, document, and safely improve the Trading Keys Goldilocks forex strategy. Use for Goldilocks demand/supply zones, HH/HL/LH/LL structure, touches, M1 confirmations, 2R runway, 20-point scoring, trade management, automation logs, backtests, Raspberry Pi operation, or AI research based on this repository.
---

# Goldilocks Strategy

Work from the repository root. Treat tests and structured code as authoritative; never
infer a rule only from a screenshot or profitable example.

## Load the right context

Read `docs/GOLDILOCKS_STRATEGY.md` completely for any strategy or implementation
change. Read `docs/AI_TRAINING_AND_RESEARCH.md` completely for optimization, dataset,
log-analysis, model-training, or backtest-comparison work. Consult
`docs/reference/20-point-scoring-sheet.pdf` only as historical source material.

## Classify the request

Identify each requested change as exactly one of:

- Detection/lifecycle rule
- Confirmation rule
- Hard safety gate
- Score component or threshold
- Execution/trade-management rule
- Backtest assumption
- Visualization/logging-only change

Keep chart, worker, and backtest behavior on shared strategy utilities. Do not copy
detection logic into a component.

## Change workflow

1. Translate the request into exact candle, price, time, and equality conditions.
2. Locate the narrowest shared implementation and current regression test.
3. Preserve hard gates independently from the 20-point score.
4. Add a deterministic test reproducing the scenario before or with the change.
5. Preserve causal timing; never use future candles or final zone state at entry time.
6. Log decisions with stable `step`, `pair`, and structured data fields.
7. Run:

```bash
npm run test:strategy
npx tsc --noEmit
npm run build:threads
```

8. For behavior changes, create a labeled backtest on the same data as its baseline.
9. Update `docs/GOLDILOCKS_STRATEGY.md` when the executable contract changes.

## Research objective

Optimize out-of-sample expectancy and robustness under fixed risk and safety gates.
Reject changes supported only by in-sample profit, win rate, or cherry-picked charts.
Report trade count, expectancy in R, drawdown, profit factor, pair stability, and known
simulator omissions.

Never promise profit, silently increase risk, remove safety gates, or authorize live
execution. Require explicit user approval for material live-risk changes.

## Important invariants

- Current demo stack: M15 trend/range, M5 zones, M1 touch/confirmation.
- Total score: 20; default minimum: 14.
- Score only after all hard gates pass.
- Use the executable entry for the final 2R runway check.
- Stop at the selected zone distal boundary; target exactly 2R.
- Move to break-even at +1R; a later break-even stop is a protected win but not
  positive P/L.
- Maximum three qualifying touches; invalidate on the fourth.
- Expire active zones after two calendar years.
- Preserve one open trade per pair and restart recovery.
- Backtests currently omit historical spread, news, session, slippage, and latency.
