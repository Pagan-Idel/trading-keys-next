#!/usr/bin/env bash
set -euo pipefail
EXPECTED_COMMIT="${1:?expected commit required}"
APP="${TRADING_KEYS_DEPLOY_ROOT:-/srv/trading-keys}/app"
SYSTEMCTL="${TRADING_KEYS_DEPLOY_SYSTEMCTL:-systemctl}"
if [[ "${TRADING_KEYS_DEPLOY_TEST_MODE:-false}" != true && "$APP" != /srv/trading-keys/app ]]; then
  echo "Custom verification roots require test mode."
  exit 1
fi

[[ "$(cat "$APP/DEPLOYED_COMMIT")" == "$EXPECTED_COMMIT" ]]
[[ -f "$APP/candleCollectorWorker.mjs" ]] || {
  echo "Deployment verification failed: compiled candle collector entry is missing."
  exit 1
}
"$SYSTEMCTL" is-active --quiet "${TRADING_KEYS_DEPLOY_SERVICE:-automation-pulse-control.service}"
"$SYSTEMCTL" is-enabled --quiet "${TRADING_KEYS_DEPLOY_SERVICE:-automation-pulse-control.service}"
STATUS="$(curl --fail --silent --show-error "${TRADING_KEYS_VERIFY_URL:-http://127.0.0.1:4080/api/status}")"
DESIRED_STATE="$(node -e 'const value=JSON.parse(process.argv[1]);const state=value?.runtime?.desiredState;if(state!=="running"&&state!=="stopped")process.exit(1);process.stdout.write(state)' "$STATUS")"
if [[ "$DESIRED_STATE" == running ]]; then
  pgrep -af 'runner/startRunner' >/dev/null
  pgrep -af 'goldilocksWorker' >/dev/null
fi
if pgrep -af 'startAutoResearch|autoResearchWorker|backtestWorker' >/dev/null; then
  echo "Forbidden research/backtest process detected."
  exit 1
fi
echo "Deployment verification passed for $EXPECTED_COMMIT"
