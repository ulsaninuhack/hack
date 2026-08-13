#!/bin/sh
set -eu

enable_funnel=0
if [ "${1:-}" = "--enable-funnel" ]; then
  enable_funnel=1
elif [ "$#" -gt 0 ]; then
  printf 'usage: %s [--enable-funnel]\n' "$0" >&2
  exit 2
fi

bridge_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node_bin=$(command -v node || true)
codex_bin=$(command -v codex || true)
tailscale_bin=$(command -v tailscale || true)
if [ -z "$tailscale_bin" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
  tailscale_bin=/Applications/Tailscale.app/Contents/MacOS/Tailscale
fi

[ -n "$node_bin" ] || { printf 'Node.js 24 is required.\n' >&2; exit 1; }
[ -n "$codex_bin" ] || { printf 'Codex CLI is required.\n' >&2; exit 1; }
node_dir=$(dirname "$node_bin")
codex_dir=$(dirname "$codex_bin")
node_major=$($node_bin -p 'process.versions.node.split(".")[0]')
[ "$node_major" = "24" ] || { printf 'Node.js 24 is required; found %s.\n' "$($node_bin --version)" >&2; exit 1; }
$codex_bin login status >/dev/null 2>&1 || {
  printf 'Codex is not logged in. Run: codex login --device-auth\n' >&2
  exit 1
}

case "$bridge_dir$node_bin$codex_bin$HOME" in
  *'&'*|*'<'*|*'>'*)
    printf 'Install paths containing XML special characters are unsupported.\n' >&2
    exit 1
    ;;
esac

bridge_port=${CODEX_BRIDGE_PORT:-8765}
bridge_model=${CODEX_BRIDGE_MODEL:-gpt-5.5}
bridge_timeout=${CODEX_BRIDGE_MODEL_TIMEOUT_MS:-25000}
bridge_effort=${CODEX_BRIDGE_REASONING_EFFORT:-low}
bridge_max_pending=${CODEX_BRIDGE_MAX_PENDING:-4}
bridge_rate_limit=${CODEX_BRIDGE_RATE_LIMIT_PER_MINUTE:-30}
bridge_funnel_path=${CODEX_BRIDGE_FUNNEL_PATH:-/incheon-care-codex-bridge}
case "$bridge_port" in
  ''|*[!0-9]*) printf 'CODEX_BRIDGE_PORT must be numeric.\n' >&2; exit 1 ;;
esac
if [ "$bridge_port" -lt 1 ] || [ "$bridge_port" -gt 65535 ]; then
  printf 'CODEX_BRIDGE_PORT must be between 1 and 65535.\n' >&2
  exit 1
fi
case "$bridge_model" in
  ''|*[!A-Za-z0-9._-]*) printf 'CODEX_BRIDGE_MODEL contains unsupported characters.\n' >&2; exit 1 ;;
esac
case "$bridge_effort" in
  low|medium|high|xhigh) ;;
  *) printf 'CODEX_BRIDGE_REASONING_EFFORT is invalid.\n' >&2; exit 1 ;;
esac
for numeric_setting in "$bridge_timeout" "$bridge_max_pending" "$bridge_rate_limit"; do
  case "$numeric_setting" in
    ''|*[!0-9]*) printf 'Bridge numeric settings must contain only digits.\n' >&2; exit 1 ;;
  esac
done
if [ "$bridge_timeout" -lt 1000 ] || [ "$bridge_timeout" -gt 60000 ]; then
  printf 'CODEX_BRIDGE_MODEL_TIMEOUT_MS must be between 1000 and 60000.\n' >&2
  exit 1
fi
if [ "$bridge_max_pending" -lt 1 ] || [ "$bridge_max_pending" -gt 16 ]; then
  printf 'CODEX_BRIDGE_MAX_PENDING must be between 1 and 16.\n' >&2
  exit 1
fi
if [ "$bridge_rate_limit" -lt 1 ] || [ "$bridge_rate_limit" -gt 120 ]; then
  printf 'CODEX_BRIDGE_RATE_LIMIT_PER_MINUTE must be between 1 and 120.\n' >&2
  exit 1
fi
case "$bridge_funnel_path" in
  /|''|*[!A-Za-z0-9._~/-]*|*'..'*)
    printf 'CODEX_BRIDGE_FUNNEL_PATH must be a non-root safe URL path.\n' >&2
    exit 1
    ;;
  /*) ;;
  *)
    printf 'CODEX_BRIDGE_FUNNEL_PATH must start with /.\n' >&2
    exit 1
    ;;
esac

config_dir="$HOME/Library/Application Support/IncheonCareCodexBridge"
log_dir="$HOME/Library/Logs/IncheonCareCodexBridge"
token_file="$config_dir/token"
plist="$HOME/Library/LaunchAgents/kr.i5.incheon-care-codex-bridge.plist"
label=kr.i5.incheon-care-codex-bridge
user_domain="gui/$(id -u)"

umask 077
mkdir -p "$config_dir" "$log_dir" "$HOME/Library/LaunchAgents"
if [ ! -s "$token_file" ]; then
  openssl rand -hex 32 >"$token_file"
fi
chmod 600 "$token_file"

cd "$bridge_dir"
npm ci --omit=dev
npm test

plist_tmp="$plist.tmp"
cat >"$plist_tmp" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node_bin</string>
    <string>$bridge_dir/src/server.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$bridge_dir</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$node_dir:$codex_dir:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>CODEX_BIN</key><string>$codex_bin</string>
    <key>CODEX_BRIDGE_TOKEN_FILE</key><string>$token_file</string>
    <key>CODEX_BRIDGE_PORT</key><string>$bridge_port</string>
    <key>CODEX_BRIDGE_MODEL</key><string>$bridge_model</string>
    <key>CODEX_BRIDGE_MODEL_TIMEOUT_MS</key><string>$bridge_timeout</string>
    <key>CODEX_BRIDGE_REASONING_EFFORT</key><string>$bridge_effort</string>
    <key>CODEX_BRIDGE_MAX_PENDING</key><string>$bridge_max_pending</string>
    <key>CODEX_BRIDGE_RATE_LIMIT_PER_MINUTE</key><string>$bridge_rate_limit</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$log_dir/stdout.log</string>
  <key>StandardErrorPath</key><string>$log_dir/stderr.log</string>
</dict>
</plist>
EOF
chmod 600 "$plist_tmp"
mv "$plist_tmp" "$plist"

launchctl bootout "$user_domain/$label" >/dev/null 2>&1 || true
sleep 1
launchctl bootstrap "$user_domain" "$plist"
launchctl kickstart -k "$user_domain/$label"

attempt=1
while [ "$attempt" -le 20 ]; do
  if curl --fail --silent --show-error "http://127.0.0.1:$bridge_port/health" >/dev/null; then
    break
  fi
  if [ "$attempt" -eq 20 ]; then
    printf 'Bridge health check failed; inspect %s/stderr.log.\n' "$log_dir" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done

printf 'Codex bridge is healthy on 127.0.0.1:%s.\n' "$bridge_port"
printf 'Bearer token is stored at %s and was not printed.\n' "$token_file"

if [ "$enable_funnel" -eq 1 ]; then
  [ -n "$tailscale_bin" ] || { printf 'Tailscale CLI is required for Funnel.\n' >&2; exit 1; }
  "$tailscale_bin" funnel --bg --yes --set-path "$bridge_funnel_path" "$bridge_port"
  "$tailscale_bin" funnel status
fi
