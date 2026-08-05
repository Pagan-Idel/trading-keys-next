# Approved strategy synchronization

The Windows application is authoritative. Continuous research currently auto-promotes
each new eligible #1 to the Pi demo lifecycle. With no open trade, Windows creates a
new immutable active row in `automation_strategy_versions`, forces a Pi sync, stops the
demo workers, starts them across the staged activation boundary, and verifies the exact
run ID. An open trade defers the restart. `runner/autoPromoteResearchLeaders.ts` keeps
checking every 30 seconds, and the research worker also checks after each completed
trial. Only the active row is exported by `GET /api/automation/approved-strategy`.

The Raspberry Pi control service polls that single endpoint. It cannot provide a
strategy ID. It validates schema, immutable ID, timestamps, compatibility, and SHA-256,
then atomically writes `data/approved-strategy/staged.json`. Running workers retain
their startup snapshot. Boot recovery does not activate staging. A manual Stop followed
by Start activates a valid staged artifact after the stopped-worker and open-trade
checks, preserving the old artifact as `last-known-good.json`.

## Pi environment

Set these only in `/etc/trading-keys/automation.env` (mode 0600):

```dotenv
APPROVED_STRATEGY_SYNC_ENABLED=true
APPROVED_STRATEGY_SYNC_URL=https://windows-host.example-tailnet.ts.net/api/automation/approved-strategy
APPROVED_STRATEGY_SYNC_TOKEN=replace-with-a-long-scoped-read-only-token
APPROVED_STRATEGY_SYNC_INTERVAL_MS=300000
APPROVED_STRATEGY_SYNC_TIMEOUT_MS=15000
```

The Windows API process uses the same token under its server-side name:

```dotenv
AUTOMATION_CONFIG_READ_TOKEN=the-same-token
```

Never put tokens, OANDA credentials, SQLite files, WAL files, or runtime artifacts in
Git. Sync failures are warnings and do not stop healthy automation. Polls are
single-flight, have a bounded timeout, and retry with exponential backoff capped at one
hour. The normal interval resumes after a successful response.

## Private Tailscale HTTPS route

Keep Next.js listening on `127.0.0.1:4000`. Use Tailscale Serve, not Funnel, and grant
only the Pi device/tag access in the tailnet policy. Configure exactly one Serve path:

```powershell
tailscale serve --bg --https=443 --set-path=/api/automation/approved-strategy http://127.0.0.1:4000/api/automation/approved-strategy
tailscale serve status
```

The backend target includes the same path because Tailscale Serve removes the matched
mount prefix before proxying. If the Pi does not use tailnet MagicDNS, map the Windows
Tailscale IPv4 address to its `*.ts.net` certificate hostname in `/etc/hosts`; do not
replace the HTTPS URL with a raw IP address.

Do not configure `/` and do not use `tailscale funnel`. Verify that another tailnet
device receives 404 for unconfigured paths and 401 for the approved path without the
bearer token. Tailscale supplies HTTPS and tailnet identity/access control; the bearer
token remains a separate application-level, read-only credential.

The Windows dashboard can show the authoritative approved version and the latest
compatible winner. It cannot truthfully show Pi detected/staged/active state without a
separate authenticated Pi-to-host status channel. The Pi control service is the
authoritative view for those states via `/api/status`; no write-back channel is added
because the sync credential is deliberately read-only.

If the Windows PC is offline, the Pi continues using its current active artifact.
