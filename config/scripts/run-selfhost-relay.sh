#!/usr/bin/env bash
set -euo pipefail
base=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
unset DISPLAY WAYLAND_DISPLAY ELECTRON_RUN_AS_NODE
export ORCA_BACKGROUND_LAUNCH=1 LIBGL_ALWAYS_SOFTWARE=1
if [[ ${1:-} == login ]]; then
  export ELECTRON_RUN_AS_NODE=1
  exec "$base/orca-ide" "$base/selfhost/selfhost-relay-login.mjs"
fi
[[ ${1:-} == run ]] || { echo 'Usage: run-selfhost-relay.sh login|run' >&2; exit 2; }
: "${ORCA_SELFHOST_DATA_DIR:?Missing persistent data directory}"
args=()
if [[ $EUID == 0 ]]; then args+=(--no-sandbox); fi
exec "$base/orca-ide" "${args[@]}" "--user-data-dir=$ORCA_SELFHOST_DATA_DIR" \
  serve --port "${ORCA_SELFHOST_PORT:-6768}" --pairing-address 127.0.0.1 --mobile-pairing --json
