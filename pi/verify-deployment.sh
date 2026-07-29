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
"$SYSTEMCTL" is-active --quiet "${TRADING_KEYS_DEPLOY_SERVICE:-automation-pulse-control.service}"
curl --fail --silent --show-error "${TRADING_KEYS_VERIFY_URL:-http://127.0.0.1:4080/api/status}" >/dev/null
pgrep -af 'runner/startRunner|goldilocksWorker' >/dev/null
if pgrep -af 'startAutoResearch|autoResearchWorker|backtestWorker' >/dev/null; then
  echo "Forbidden research/backtest process detected."
  exit 1
fi
echo "Deployment verification passed for $EXPECTED_COMMIT"
