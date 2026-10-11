#!/usr/bin/env bash
set -euo pipefail
scripts=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
base=$(cd -- "$scripts/../.." && pwd -P)
unset DISPLAY WAYLAND_DISPLAY ELECTRON_RUN_AS_NODE
export ORCA_BACKGROUND_LAUNCH=1 LIBGL_ALWAYS_SOFTWARE=1
if [[ ${1:-} == login ]]; then
  export ELECTRON_RUN_AS_NODE=1
  exec "$base/orca-ide" "$scripts/selfhost-relay-login.mjs"
fi
[[ ${1:-} == run ]] || { echo 'Usage: run-selfhost-relay.sh login|run' >&2; exit 2; }
args=()
if [[ $EUID == 0 ]]; then args+=(--no-sandbox); fi
# Respect the same explicit profile override as the official CLI; otherwise use Orca's default.
if [[ -n ${ORCA_USER_DATA_PATH:-} ]]; then args+=("--user-data-dir=$ORCA_USER_DATA_PATH"); fi
scope_args=()
case ${ORCA_PAIRING_SCOPE:-runtime} in
  runtime) ;;
  mobile) scope_args+=(--mobile-pairing) ;;
  *) echo 'ORCA_PAIRING_SCOPE must be runtime or mobile' >&2; exit 2 ;;
esac
exec "$base/orca-ide" "${args[@]}" serve --relay "${scope_args[@]}" \
  --port "${ORCA_SERVE_PORT:-6768}" --pairing-address 127.0.0.1 --json
