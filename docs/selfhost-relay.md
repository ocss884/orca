# Self-hosted headless Relay fork

This branch adds native Relay support to `orca serve`, based on upstream **v1.4.221**.
It uses the existing mobile pairing, device authentication and E2EE protocols.
It does not bundle a Relay deployment, an authentication server, any credentials or a CA.

## Patch boundaries

1. Share the desktop Relay provider startup with serve mode, after RPC initialization.
   Based on [upstream PR #22435](https://github.com/stablyai/orca/pull/22435)
   ([alternative #20862](https://github.com/stablyai/orca/pull/20862), [issue #18504](https://github.com/stablyai/orca/issues/18504)).
2. Explicitly import an origin-bound account session into a dedicated headless profile.
   Normal profile/session stores and the existing token refresh mechanism remain in use.
3. Opt into native mobile Relay invites at startup and privately write pairing results.
   Linux/macOS can refresh an invite with SIGUSR2 without restarting the host.
4. Provide a noninteractive PKCE login helper for the single-user compatible auth service.

No mobile or runtime wire fields are changed. Direct CLI/runtime pairing remains the
upstream default unless the operator explicitly opts into the mobile Relay flow.

## Configure a host

Use a fork-built Orca installation. The upstream binary does not understand the new
`ORCA_SELFHOST_*` variables. Use a persistent dedicated user data directory; never
copy another host's E2EE keys or device registry. Do not run two processes on one profile.

Example environment file (replace paths and origin):

```ini
ORCA_CLOUD_API_URL=https://relay.example.com:8443
ORCA_CLOUD_CLIENT_ID=orca-desktop
ORCA_RELAY_URL=https://relay.example.com:8443
ORCA_SELFHOST_PASSWORD_FILE=/home/orca/.config/orca-relay/password
ORCA_SELFHOST_SESSION_FILE=/home/orca/.config/orca-relay/session.json
ORCA_SELFHOST_RELAY_PAIRING=1
ORCA_SELFHOST_PAIRING_FILE=/home/orca/.config/orca-relay/pairing.json
ORCA_BACKGROUND_LAUNCH=1
HOME=/home/orca
```

An HTTPS IP origin is also supported. For a private CA, additionally set
`NODE_EXTRA_CA_CERTS` to the CA certificate file and trust that CA on the phone.
Never disable TLS verification. Keep the password and session files owned by the
service user and mode 0600; keep their parent directory private (0700). Windows
operators must restrict file ACLs to the service identity themselves.

Copy `config/scripts/selfhost-relay-login.mjs` alongside the installed application.
With the environment loaded, run the helper using Node 24, then launch the host:

```sh
node /opt/orca-relay-tools/selfhost-relay-login.mjs
/opt/orca/current/orca-ide serve --port 6768 --pairing-address 127.0.0.1 --mobile-pairing --json
```

The helper uses the compatible `/v1/desktop/auth/authorize` and `/session` endpoints,
validates the PKCE callback and writes `{origin, session}` atomically. This is a
single-user self-host auth flow, not a general-purpose official Orca OAuth login tool.
The importer rejects expired sessions, missing `relay.use`, wrong origins, unsafe
POSIX permissions, and attempts to replace a different linked account.

Linux headless may have memory-only account storage. **Run login before every service
start** rather than reusing the original session file indefinitely. During a running
session, Orca's normal refresh logic applies. A fresh login is the recovery mechanism
if a refresh was ambiguous and Orca refuses to replay it.

The invite can contain a direct endpoint as well as Relay metadata (`automatic`
connection mode). A phone uses its saved host/credential record; merely connecting a
new host to Relay does not automatically add it to the phone's host list.

## systemd example

This sample assumes the operator has already created user `orca`, its private config
directory, the environment file, the password file and the installed fork build.

```ini
[Unit]
Description=Orca headless with self-hosted Relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=orca
Group=orca
WorkingDirectory=/home/orca
EnvironmentFile=/home/orca/.config/orca-relay/headless.env
UMask=0077
ExecStartPre=/usr/bin/node /opt/orca-relay-tools/selfhost-relay-login.mjs
ExecStart=/opt/orca/current/orca-ide serve --port 6768 --pairing-address 127.0.0.1 --mobile-pairing --json
Restart=on-failure
RestartSec=15
StandardOutput=null
StandardError=journal

[Install]
WantedBy=multi-user.target
```

The JSON readiness output contains pairing credentials, so this sample discards stdout
and uses the private `ORCA_SELFHOST_PAIRING_FILE`. Inspect `pairing.available`,
`generatedAt` and `runtimeId` there. An unavailable result overwrites the old file too.
`--pairing-address` changes the advertised address, **not** the server bind address;
protect direct port 6768 separately if only Relay access is intended. The host only
needs outbound access to the Relay's HTTPS port. No tunnel or external bridge is used.

On Linux, generate a fresh invite without restarting:

```sh
systemctl kill --kill-who=main --signal=SIGUSR2 orca-headless.service
```

This targets the Orca process in the example unit. If a wrapper is the main process,
signal its Orca child instead. The updated private file contains `pairing.pairingUrl`.
Show it as a QR locally; do not publish the file or put it in a repository.
SIGUSR2 refresh is not registered on Windows or when pairing is disabled.

## Verification and upgrades

Install dependencies with the upstream-pinned pnpm and Node 24. For these source checks,
`pnpm install --frozen-lockfile --ignore-scripts` is enough; packaging needs the ordinary
native dependency setup described by upstream.

```sh
pnpm tc:node
pnpm test:selfhost-relay
```

The tests cover session scope/expiry/permissions, callback and PKCE validation,
existing direct pairing behavior, relay opt-in, disabled pairing, private refresh
output, startup ordering and native mobile pairing-mode persistence. They do not
replace testing an actual packaged Linux build against a deployed Relay and iPhone.

Before deploying an upgrade:

1. Stop the service and back up the current program, config, profile and pairing keys.
2. Rebase this branch onto a selected release and drop provider wiring if upstream
   includes an equivalent fix. Do not automatically follow upstream main in production.
3. Run the checks, follow upstream's Linux x86_64 build instructions, and install the
   new program in a new version directory. Do not copy a compiled JS file from an old build.
4. From an external machine, connect using Relay only, complete E2EE/device auth, and
   assert `status.get` and `pairing.getEndpoints` succeed for the expected runtime.
   Use a separate test invite; it can consume credentials intended for a phone.
5. Check fresh phone pairing, existing-device reconnect after restart, and token refresh.
6. Switch `/opt/orca/current` only to an accepted version. If reverting across a profile
   migration, restore the matching stopped-service data snapshot as well as the program.

Keep Relay and compatible auth deployments versioned independently.

## Linux binary installation and packaging

See the [README](../README.md) for the pinned installer. Release `v1.4.221-relay.1`
provides Linux amd64 and arm64 tarballs, a SHA256SUMS file, and an installer. These
are headless packages for Debian/Ubuntu, not signed desktop installers or 32-bit ARM builds.
The installer satisfies the upstream Debian runtime dependencies and installs audio
libraries needed by Electron even with no display. A system Node installation is not
required: the login helper uses the bundled Electron's Node mode.

The release reuses **exactly v1.4.221** official runtime/native dependencies and renderer,
then replaces the entire main-process bundle, including every chunk, with a build from
this fork. `package-selfhost-relay.py` pins each official Debian package's SHA-256,
checks its architecture and ASAR package version, and rewrites the main entries to the
new unpacked bundle while preserving offsets for the other ASAR contents. It records
source commit, upstream digest and individual compiled JS hashes in `BUILD-INFO.json`.
The ASAR and shipped helper files are hashed as well. No credentials or host profile are included. The updater feed points to this fork;
headless upgrades are performed with the installer, not the desktop updater.

Build on a machine with Node 24 and the repository's pinned pnpm:

```sh
pnpm install --frozen-lockfile --ignore-scripts
ORCA_ELECTRON_VITE_TARGET=main node config/scripts/run-electron-vite-build.mjs --config config/electron-vite-target.config.cts
```

On Linux with `dpkg-deb`, using the same checkout and the built `out/main/`:

```sh
python3 config/scripts/package-selfhost-relay.py \
  --deb /path/to/orca-ide_1.4.221_amd64.deb --arch amd64 \
  --source-commit "$(git rev-parse HEAD)" --output release
# Repeat with the official arm64 Debian package and --arch arm64.
(cd release && sha256sum orca-headless-*.tar.gz > SHA256SUMS)
```

Do not change just the pinned base version: an upgrade must build main from that same
upstream version plus the fork commits, update the official digests and release name,
and repeat packaged validation on supported architectures before publishing.

The installer creates `orca-selfhost.service`, distinct from older hand-built services
named `orca-headless.service`. It does not migrate an old profile or stop another
service using port 6768. Resolve any existing port/profile conflict before installation.
`--user` defaults to the sudo caller (or current account if already root); root launches
need Chromium's `--no-sandbox`, which the wrapper adds only for UID 0. The service gives Xvfb its own `/tmp/.X11-unix` mount, avoiding WSLg's read-only socket directory without changing the host mount. It has
that user's normal host privileges and no disk read/write throttling. Systemd cannot
start a WSL distribution while Windows has it shut down; the service starts when the
systemd-enabled distribution starts.

On an upgrade the installer retains the old version directory and records its path in
`/opt/orca-selfhost/previous-version`. Stop the service and back up the private config
and persistent profile **before upgrading**. A rollback may need the matching profile
snapshot, not just an old binary. Existing config is reused if `--relay` is omitted;
providing Relay options again creates a new configuration and backs up the previous env
file. Runtime identity and device keys belong in the persistent profile, not the package.

The original v1.4.220 deployment is separate and remains unchanged by publishing this
release. A protocol probe is not a substitute for the user's real iPhone acceptance.

### Release validation

For `v1.4.221-relay.1`: the 38 focused TypeScript tests and four packaging/checksum
tests pass; the shell scripts pass ShellCheck. The amd64 package was installed in
Ubuntu 24.04 WSL2, authenticated against a self-hosted Relay over verified TLS, and
passed mobile-protocol E2EE, device authentication, RPC and resume-credential reconnect
after service restart. The arm64 package started to `orca_server_ready` in a native
ARM64 Ubuntu 24.04 container. ARM64 Relay end-to-end and a real iPhone connection to
this new WSL host are not included in those results.
