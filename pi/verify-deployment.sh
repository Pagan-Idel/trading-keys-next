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
VERIFY_URL="${TRADING_KEYS_VERIFY_URL:-http://127.0.0.1:4080/api/status}"
CONTROL_TOKEN="${PULSE_CONTROL_TOKEN:-}"
ENV_FILE="${TRADING_KEYS_DEPLOY_ENV_FILE:-/etc/trading-keys/automation.env}"
if [[ -z "$CONTROL_TOKEN" && -r "$ENV_FILE" ]]; then
  CONTROL_TOKEN="$(sed -n 's/^PULSE_CONTROL_TOKEN=//p' "$ENV_FILE" | tail -n 1)"
fi
fetch_status(){
  if [[ -n "$CONTROL_TOKEN" ]]; then
    curl --fail --silent --config - "$VERIFY_URL" <<<"header = \"Authorization: Bearer $CONTROL_TOKEN\""
  else
    curl --fail --silent "$VERIFY_URL"
  fi
}
STATUS=""
for _attempt in {1..30}; do
  if STATUS="$(fetch_status 2>/dev/null)" && [[ -n "$STATUS" ]]; then break; fi
  sleep 1
done
[[ -n "$STATUS" ]] || { echo "Deployment verification timed out waiting for $VERIFY_URL"; exit 1; }
DESIRED_STATE="$(node -e 'const value=JSON.parse(process.argv[1]);const state=value?.runtime?.desiredState;if(state!=="running"&&state!=="stopped")process.exit(1);process.stdout.write(state)' "$STATUS")"
if [[ "$DESIRED_STATE" == running ]]; then
  READY=false
  for _attempt in {1..30}; do
    if pgrep -af 'runner/startRunner' >/dev/null && pgrep -af 'goldilocksWorker' >/dev/null; then READY=true; break; fi
    sleep 1
  done
  [[ "$READY" == true ]] || { echo "Deployment verification timed out waiting for demo workers."; exit 1; }
fi
if pgrep -af 'startAutoResearch|autoResearchWorker|backtestWorker' >/dev/null; then
  echo "Forbidden research/backtest process detected."
  exit 1
fi
echo "Deployment verification passed for $EXPECTED_COMMIT"
