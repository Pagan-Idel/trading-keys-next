#!/usr/bin/env bash
set -euo pipefail

REPO_UNDER_TEST="${1:-/repo}"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
ORIGIN="$SANDBOX/origin.git"
SEED="$SANDBOX/seed"
ROOT="$SANDBOX/runtime"
BIN="$SANDBOX/bin"
mkdir -p "$SEED/pi" "$BIN"
cp "$REPO_UNDER_TEST/pi/deploy.sh" "$REPO_UNDER_TEST/pi/verify-deployment.sh" \
  "$REPO_UNDER_TEST/pi/automation-pulse-control.service" "$SEED/pi/"
printf '{"scripts":{}}\n' > "$SEED/package.json"
git -C "$SEED" init -b main >/dev/null
git -C "$SEED" config user.email test@example.invalid
git -C "$SEED" config user.name test
git -C "$SEED" add .
git -C "$SEED" commit -m initial >/dev/null
git clone --bare "$SEED" "$ORIGIN" >/dev/null
chmod 755 "$SANDBOX" "$ORIGIN"
chown -R tradingkeys:tradingkeys "$ORIGIN"

cat > "$BIN/systemctl" <<'EOF'
#!/usr/bin/env sh
printf '%s\n' "$*" >> "${MOCK_SYSTEMCTL_LOG:?}"
exit 0
EOF
cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env sh
if test "${MOCK_VERIFY_FAIL:-false}" = true; then exit 1; fi
printf '%s\n' '{"runtime":{"desiredState":"running"}}'
EOF
cat > "$BIN/pgrep" <<'EOF'
#!/usr/bin/env sh
case "$*" in
  *startAutoResearch*|*autoResearchWorker*|*backtestWorker*) exit 1 ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$BIN/"*

export PATH="$BIN:$PATH"
export TRADING_KEYS_DEPLOY_TEST_MODE=true
export TRADING_KEYS_DEPLOY_ROOT="$ROOT"
export TRADING_KEYS_DEPLOY_REMOTE="$ORIGIN"
export TRADING_KEYS_DEPLOY_VALIDATION_COMMAND='mkdir -p artifacts/pi-runtime && touch artifacts/pi-runtime/controlServer.mjs && cp pi/automation-pulse-control.service artifacts/pi-runtime/'
export TRADING_KEYS_DEPLOY_SYSTEMCTL="$BIN/systemctl"
export TRADING_KEYS_DEPLOY_UNIT_TARGET="$ROOT/systemd/automation-pulse-control.service"
export TRADING_KEYS_VERIFY_URL=http://fixture.invalid/status
export MOCK_SYSTEMCTL_LOG="$SANDBOX/systemctl.log"

echo preserved > "$ROOT-data-seed"
bash "$REPO_UNDER_TEST/pi/deploy.sh"
test ! -e "$ROOT/app"
test -d "$ROOT/data"
echo runtime-data > "$ROOT/data/preserved.txt"

bash "$REPO_UNDER_TEST/pi/deploy.sh" --promote
test -L "$ROOT/app"
test "$(cat "$ROOT/data/preserved.txt")" = runtime-data
grep -q 'KillMode=control-group' "$TRADING_KEYS_DEPLOY_UNIT_TARGET"
grep -q '^enable automation-pulse-control.service$' "$MOCK_SYSTEMCTL_LOG"
FIRST="$(readlink -f "$ROOT/app")"
FIRST_UNIT_HASH="$(sha256sum "$TRADING_KEYS_DEPLOY_UNIT_TARGET" | awk '{print $1}')"

printf '\n# second\n' >> "$SEED/pi/verify-deployment.sh"
git -C "$SEED" add .
git -C "$SEED" commit -m second >/dev/null
chown -R root:root "$ORIGIN"
git -C "$SEED" push "$ORIGIN" main >/dev/null
chown -R tradingkeys:tradingkeys "$ORIGIN"
export MOCK_VERIFY_FAIL=true
if bash "$REPO_UNDER_TEST/pi/deploy.sh" --promote; then
  echo "Expected verification failure." >&2
  exit 1
fi
test "$(readlink -f "$ROOT/app")" = "$FIRST"
test "$(cat "$ROOT/data/preserved.txt")" = runtime-data
test "$(sha256sum "$TRADING_KEYS_DEPLOY_UNIT_TARGET" | awk '{print $1}')" = "$FIRST_UNIT_HASH"

touch "$ROOT/source/unexpected.local"
if bash "$REPO_UNDER_TEST/pi/deploy.sh"; then
  echo "Expected dirty-source refusal." >&2
  exit 1
fi
echo "deployment script tests passed"
