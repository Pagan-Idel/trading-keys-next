#!/usr/bin/env bash
set -euo pipefail

ROOT="${TRADING_KEYS_DEPLOY_ROOT:-/srv/trading-keys}"
SOURCE="$ROOT/source"
RELEASES="$ROOT/releases"
ACTIVE="$ROOT/app"
DATA="$ROOT/data"
BACKUPS="$ROOT/backups"
REMOTE="${TRADING_KEYS_DEPLOY_REMOTE:-https://github.com/Pagan-Idel/trading-keys-next.git}"
SERVICE="${TRADING_KEYS_DEPLOY_SERVICE:-automation-pulse-control.service}"
VALIDATION_COMMAND="${TRADING_KEYS_DEPLOY_VALIDATION_COMMAND:-npm ci && npm run validate:automation && npm run build:pi-runtime && cd artifacts/pi-runtime && npm install --omit=dev}"
SYSTEMCTL="${TRADING_KEYS_DEPLOY_SYSTEMCTL:-systemctl}"
UNIT_TARGET="${TRADING_KEYS_DEPLOY_UNIT_TARGET:-/etc/systemd/system/$SERVICE}"
PROMOTE=false
[[ "${1:-}" == "--promote" ]] && PROMOTE=true

if [[ "${TRADING_KEYS_DEPLOY_TEST_MODE:-false}" != true ]]; then
  [[ "$ROOT" == /srv/trading-keys ]] || { echo "Custom deployment roots require test mode."; exit 1; }
  [[ "$(id -u)" -eq 0 ]] || { echo "Run with sudo."; exit 1; }
fi
install -d -o tradingkeys -g tradingkeys "$ROOT" "$RELEASES" "$DATA" "$BACKUPS"
if [[ ! -d "$SOURCE/.git" ]]; then
  runuser -u tradingkeys -- git clone --branch main --single-branch "$REMOTE" "$SOURCE"
fi
git_source(){ runuser -u tradingkeys -- git -C "$SOURCE" "$@"; }
[[ "$(git_source remote get-url origin)" == "$REMOTE" ]] ||
  { echo "Unexpected origin in $SOURCE"; exit 1; }
[[ -z "$(git_source status --porcelain)" ]] ||
  { echo "Refusing deployment: $SOURCE has local changes."; git_source status --short; exit 1; }

git_source fetch origin main --prune
echo "Incoming commits:"
git_source log --oneline HEAD..origin/main
echo "Incoming files:"
git_source diff --name-status HEAD..origin/main
COMMIT="$(git_source rev-parse origin/main)"
SHORT="${COMMIT:0:12}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE="$RELEASES/$STAMP-$SHORT"

install -d -o tradingkeys -g tradingkeys "$RELEASE"
git_source archive "$COMMIT" | tar -x -C "$RELEASE"
rm -rf -- "$RELEASE/artifacts"
install -d -o tradingkeys -g tradingkeys "$RELEASE/runtime"
ln -s "$DATA" "$RELEASE/data"
chown -R tradingkeys:tradingkeys "$RELEASE"

runuser -u tradingkeys -- bash -lc "cd '$RELEASE' && TRADING_KEYS_PI_RUNTIME=true $VALIDATION_COMMAND"
RELEASE_APP="$RELEASE/artifacts/pi-runtime"
[[ -f "$RELEASE_APP/controlServer.mjs" ]] || { echo "Validated build did not produce the Pi runtime."; exit 1; }
ln -s "$DATA" "$RELEASE_APP/data"
printf '%s\n' "$COMMIT" > "$RELEASE_APP/DEPLOYED_COMMIT"

if ! $PROMOTE; then
  echo "Validated candidate: $RELEASE_APP"
  echo "Re-run with --promote to switch the active release and restart $SERVICE."
  exit 0
fi

PREVIOUS="$(readlink -f "$ACTIVE" 2>/dev/null || true)"
printf '%s\n' "$PREVIOUS" > "$BACKUPS/$STAMP.previous-release"
UNIT_BACKUP="$BACKUPS/$STAMP.$SERVICE"
if [[ -f "$UNIT_TARGET" ]]; then
  cp -p "$UNIT_TARGET" "$UNIT_BACKUP"
else
  : > "$UNIT_BACKUP.absent"
fi
ln -s "$RELEASE_APP" "$ACTIVE.next"
mv -Tf "$ACTIVE.next" "$ACTIVE"
install -D -m 0644 "$RELEASE_APP/automation-pulse-control.service" "$UNIT_TARGET.next"
mv -Tf "$UNIT_TARGET.next" "$UNIT_TARGET"
"$SYSTEMCTL" daemon-reload
"$SYSTEMCTL" enable "$SERVICE"
"$SYSTEMCTL" restart "$SERVICE"
if ! "$RELEASE/pi/verify-deployment.sh" "$COMMIT"; then
  echo "Verification failed; rolling back to $PREVIOUS"
  if [[ -f "$UNIT_BACKUP" ]]; then
    cp -p "$UNIT_BACKUP" "$UNIT_TARGET.rollback"
    mv -Tf "$UNIT_TARGET.rollback" "$UNIT_TARGET"
  elif [[ -f "$UNIT_BACKUP.absent" ]]; then
    rm -f -- "$UNIT_TARGET"
  fi
  "$SYSTEMCTL" daemon-reload
  if [[ -z "$PREVIOUS" || ! -d "$PREVIOUS" ]]; then
    rm -f -- "$ACTIVE"
    "$SYSTEMCTL" stop "$SERVICE"
    echo "No prior release existed; the failed candidate was deactivated."
    exit 1
  fi
  ln -s "$PREVIOUS" "$ACTIVE.rollback"
  mv -Tf "$ACTIVE.rollback" "$ACTIVE"
  "$SYSTEMCTL" restart "$SERVICE"
  "$RELEASE/pi/verify-deployment.sh" "$(cat "$PREVIOUS/DEPLOYED_COMMIT")"
  exit 1
fi
echo "Promoted $RELEASE_APP"
