# Trading Keys

Trading Keys is a private Next.js trading workstation for manual keyboard execution,
Goldilocks strategy visualization, automated OANDA practice/live workers, structured
trade management, and historical backtesting.

The current demo strategy uses:

- M15 for trend and range context
- M5 for demand/supply zone construction
- M1 for zone touch and close-through confirmation
- A 20-point quality score with a default minimum of 14
- A required clear 2:1 runway before an order is submitted
- Break-even protection at +1R; reaching +1R is recorded as a protected win

This software can lose money. Backtests are research evidence, not a prediction or
guarantee. Validate changes out of sample and in an OANDA practice account before
considering live execution.

## Documentation

- [Goldilocks strategy and code guide](docs/GOLDILOCKS_STRATEGY.md)
- [AI research and training guide](docs/AI_TRAINING_AND_RESEARCH.md)
- [Original 20-point scoring sheet](docs/reference/20-point-scoring-sheet.pdf)
- Repo-local AI skill: `.codex/skills/goldilocks-strategy/`

The PDF is retained as source material. The implemented score is documented in the
strategy guide and should be treated as the executable specification.

## Main screens

| Route | Purpose |
| --- | --- |
| `/` | Trading keyboard and lazily loaded automation candylog |
| `/automation` | Worker state, active trades, structured logs, and trade history |
| `/strategy-lab` | Goldilocks zones, swing markers, trend, and historical 2R drawings |
| `/backtesting` | Manual research runs, tweak history, per-pair results, and trades |

The development server listens on `http://localhost:4000`.

## Setup

Requirements: Node.js 20+, npm, and OANDA credentials.

```bash
npm install
npm run test:strategy
npm run dev
```

Store credentials in the existing private credential mechanism. Never commit
`credentials.json`, `.env*`, SQLite databases, candle archives, or runtime logs.

Expected OANDA values include demo/live account IDs and tokens. Demo mode uses the
practice API; live mode can place real orders.

## Commands

```bash
# Web dashboard on port 4000
npm run dev

# Validate worker compilation and startup without normal trading operation
npm run check:automation

# OANDA practice automation
npm run run:demo

# OANDA live automation - real-money risk
npm run run:live

# Strategy regression suite
npm run test:strategy

# Type-check worker entry points
npm run build:threads

# Production web build
npm run build
```

The dashboard can also start/stop the demo automation through
`/api/automation/runtime`. Backtests run in a detached hidden worker so the web server
remains responsive. The backtesting screen reports intra-pair stages and heartbeats and
can cancel the active worker without stopping the dashboard or trading automation.

## Runtime configuration

| Variable | Default | Meaning |
| --- | ---: | --- |
| `GOLDILOCKS_MIN_SCORE` | `14` | Minimum score from 0 through 20; lower setups are logged and skipped |
| `GOLDILOCKS_RISK_PERCENT` | `0.25` | Percent risk per order; code clamps it to a maximum of 1% |

Hard risk and execution gates remain independent from scoring. Raising a score does
not bypass spread, session, news, zone, runway, freshness, or one-trade-per-pair rules.

## Data and retention

`data/automation.sqlite` uses SQLite WAL mode and contains worker status, active and
closed trades, backtest runs, backtest trades, and structured events.

- Automation candylog events are deleted after three days.
- Closed trades and backtest results are retained for research.
- Candle archives are stored separately under `data/` and grow through backfills.
- Runtime and generated data must remain out of version control.

Read [AI_TRAINING_AND_RESEARCH.md](docs/AI_TRAINING_AND_RESEARCH.md) before using this
data for optimization or model training.

## Raspberry Pi deployment

Use a 64-bit Raspberry Pi OS, Node.js 20+, and production builds. Run the web server
and automation as separate `systemd` services with automatic restart and separate
logs. Start with `run:demo`, bind the dashboard to the trusted LAN only, protect
credentials with restrictive permissions, and back up the SQLite database.

Do not expose the dashboard or runtime APIs directly to the public internet. Add
authentication and TLS before any remote access.

## Ownership

This is private personal software and is not an open-source distribution. Do not
copy, redistribute, or publish credentials, data, strategy materials, or source code
without the owner's explicit permission.
