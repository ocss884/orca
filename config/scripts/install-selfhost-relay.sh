#!/usr/bin/env bash
set -euo pipefail
umask 077
release=1.4.221-relay.1
repo=ocss884/orca
service_user=${SUDO_USER:-$(id -un)}
relay='' password_file='' ca_file='' release_dir=''
usage() {
  cat <<'EOF'
Usage: sudo bash install-selfhost-relay.sh [options]
  --user USER             Run as this existing user (default: sudo caller/current user)
  --relay https://IP:8443 Configure and start a self-hosted Relay connection
  --password-file FILE   Private file containing the Relay password
  --ca FILE              PEM CA for a privately signed Relay (optional)
  --release-dir DIR      Install checksum-verified local release assets (offline/testing)
Without --relay: install binaries, or upgrade/restart an existing orca-selfhost service.
Linux amd64/arm64; Ubuntu 22.04+/Debian 12+; systemd required to run the service.
EOF
}
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --user|--relay|--password-file|--ca|--release-dir)
      (($# >= 2)) || { usage >&2; exit 2; }
      case "$1" in
        --user) service_user=$2 ;;
        --relay) relay=$2 ;;
        --password-file) password_file=$2 ;;
        --ca) ca_file=$2 ;;
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
if [[ -n $relay ]]; then
  [[ -f $password_file ]] || { echo '--relay requires --password-file.' >&2; exit 2; }
  [[ -z $ca_file || -f $ca_file ]] || { echo 'CA file not found.' >&2; exit 2; }
  [[ -d /run/systemd/system ]] || { echo 'Enable systemd first (including in WSL).' >&2; exit 1; }
elif [[ -n $password_file || -n $ca_file ]]; then
  echo '--password-file and --ca require --relay.' >&2; exit 2
fi
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl python3
asset=orca-headless-$release-linux-$arch.tar.gz
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
mkdir "$work/package"
tar -xzf "$work/$asset" -C "$work/package"
python3 "$work/package/selfhost/verify-selfhost-relay.py" package "$work/package" "$release" "$arch"
apt-get satisfy -y "$(cat "$work/package/selfhost/dependencies.txt")"
if apt-cache show libasound2t64 >/dev/null 2>&1; then sound=libasound2t64; else sound=libasound2; fi
apt-get install -y --no-install-recommends "$sound"
# Keep each accepted package immutable; repeated installation verifies instead of replacing it.
base=/opt/orca-selfhost
version_dir=$base/releases/$release-$arch
mkdir -p "$base/releases"
chmod 755 "$base" "$base/releases"
if [[ -d $version_dir ]]; then
  python3 "$work/package/selfhost/verify-selfhost-relay.py" package "$version_dir" "$release" "$arch"
  cmp "$version_dir/BUILD-INFO.json" "$work/package/BUILD-INFO.json" || {
    echo 'This release directory has different provenance; refusing to overwrite.' >&2; exit 1;
  }
else
  mv "$work/package" "$version_dir"
  chmod -R a+rX "$version_dir"
fi
if [[ -f /etc/systemd/system/orca-selfhost.service ]]; then
  systemctl stop orca-selfhost.service
fi
if [[ -L $base/current ]]; then
  readlink -f "$base/current" > "$base/previous-version"
fi
ln -s "$version_dir" "$base/current.new"
mv -Tf "$base/current.new" "$base/current"
if [[ -n $relay ]]; then
  python3 "$base/current/selfhost/configure-selfhost-relay.py" \
    "$service_user" "$relay" "$password_file" "$ca_file"
fi
if [[ -f /etc/systemd/system/orca-selfhost.service ]]; then
  systemctl daemon-reload
  started_at=$(date +%s)
  systemctl enable --now orca-selfhost.service
  systemctl is-active --quiet orca-selfhost.service
  actual_user=$(systemctl show -p User --value orca-selfhost.service)
  actual_home=$(getent passwd "$actual_user" | cut -d: -f6)
  python3 "$base/current/selfhost/verify-selfhost-relay.py" ready \
    "$actual_home/.config/orca-selfhost/pairing.json" "$started_at"
  echo 'Service started and produced a fresh Relay pairing offer.'
fi
echo "Installed $release ($arch) at $base/current"
echo "Provenance: $base/current/BUILD-INFO.json"
