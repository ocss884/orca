#!/usr/bin/env bash
set -euo pipefail
umask 077
release=1.4.224-relay.2
repo=ocss884/orca
service_user=${SUDO_USER:-$(id -un)}
relay='' password_file='' ca_file='' release_dir='' data_dir='' scope=runtime
usage() {
  cat <<'EOF'
Usage: sudo bash install-selfhost-relay.sh [options]
  --user USER             Existing service user (default: sudo caller/current user)
  --relay https://HOST    Configure and start a self-hosted Relay connection
  --password-file FILE   Private file containing the Relay password
  --ca FILE              PEM CA for a privately signed Relay
  --scope runtime|mobile Pairing permission scope (default: runtime)
  --data-dir DIR         Explicit Orca profile; default: ~/.config/orca
  --release-dir DIR      Directory containing release assets and SHA256SUMS
Without --relay: install the standard Orca Debian package or upgrade an existing orca.service.
Linux amd64/arm64, Debian/Ubuntu. Configuration and pairing use the ordinary Orca profile.
EOF
}
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --user|--relay|--password-file|--ca|--scope|--data-dir|--release-dir)
      (($# >= 2)) || { usage >&2; exit 2; }
      case "$1" in
        --user) service_user=$2 ;;
        --relay) relay=$2 ;;
        --password-file) password_file=$2 ;;
        --ca) ca_file=$2 ;;
        --scope) scope=$2 ;;
        --data-dir) data_dir=$2 ;;
        --release-dir) release_dir=$2 ;;
      esac
      shift 2 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ $EUID == 0 ]] || { echo 'Run using sudo (or as root).' >&2; exit 1; }
[[ $(uname -s) == Linux ]] || { echo 'Linux is required.' >&2; exit 1; }
case $(uname -m) in
  x86_64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo 'Only x86_64 and ARM64 are supported.' >&2; exit 1 ;;
esac
command -v apt-get >/dev/null || { echo 'This installer supports Debian/Ubuntu.' >&2; exit 1; }
[[ $service_user =~ ^[a-zA-Z_][a-zA-Z0-9_-]*\$?$ ]] || exit 2
id "$service_user" >/dev/null
[[ $scope == runtime || $scope == mobile ]] || { usage >&2; exit 2; }
[[ -z $data_dir || $data_dir == /* ]] || { echo '--data-dir must be absolute' >&2; exit 2; }
if [[ -n $relay ]]; then
  [[ -f $password_file ]] || { echo '--relay requires --password-file.' >&2; exit 2; }
  [[ -z $ca_file || -f $ca_file ]] || { echo 'CA file not found.' >&2; exit 2; }
  [[ -d /run/systemd/system ]] || { echo 'Enable systemd first (including in WSL).' >&2; exit 1; }
elif [[ -n $password_file || -n $ca_file || -n $data_dir ]]; then
  echo 'Configuration options require --relay.' >&2; exit 2
fi
# Never start a second runtime on top of the previous release's running profile.
if systemctl is-active --quiet orca-selfhost.service 2>/dev/null; then
  echo 'Stop the legacy orca-selfhost.service and migrate its profile first; see docs/selfhost-relay.md.' >&2
  exit 1
fi
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl python3
asset=orca-ide_${release}_${arch}.deb
for name in "$asset" SHA256SUMS; do
  if [[ -n $release_dir ]]; then
    cp -- "$release_dir/$name" "$work/$name"
  else
    curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
      "https://github.com/$repo/releases/download/v$release/$name" -o "$work/$name"
  fi
done
(cd "$work"; awk -v name="$asset" '$2 == name {print}' SHA256SUMS > selected.sha256
 [[ $(wc -l < selected.sha256) == 1 ]] && sha256sum -c selected.sha256)
[[ $(dpkg-deb -f "$work/$asset" Architecture) == "$arch" ]] || exit 1
# electron-builder encodes semver prereleases with Debian's ordering separator.
[[ $(dpkg-deb -f "$work/$asset" Version) == "${release//-/\~}" ]] || exit 1
was_active=false
if systemctl is-active --quiet orca.service 2>/dev/null; then
  was_active=true
  systemctl stop orca.service
fi
apt-get install -y --no-install-recommends "$work/$asset"
scripts=/opt/Orca/resources/relay
if [[ -n $relay ]]; then
  config_args=(--user "$service_user" --relay "$relay" --password-file "$password_file" --scope "$scope")
  if [[ -n $ca_file ]]; then config_args+=(--ca "$ca_file"); fi
  if [[ -n $data_dir ]]; then config_args+=(--data-dir "$data_dir"); fi
  python3 "$scripts/configure-selfhost-relay.py" "${config_args[@]}"
fi
if [[ -f /etc/systemd/system/orca.service && ( -n $relay || $was_active == true ) ]]; then
  systemctl daemon-reload
  started_at=$(date +%s)
  systemctl enable --now orca.service
  env_file=$(systemctl show -p EnvironmentFiles --value orca.service)
  python3 "$scripts/verify-selfhost-relay.py" service-ready "$env_file" "$started_at"
fi
echo "Installed Orca $release ($arch) at /opt/Orca"
