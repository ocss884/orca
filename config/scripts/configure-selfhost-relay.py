#!/usr/bin/env python3
"""Write private per-user Relay configuration and its systemd unit."""
import json
import os
from pathlib import Path
import pwd
import shutil
import sys
from urllib.parse import urlsplit

user, origin, password_file, ca_file = sys.argv[1:]
account = pwd.getpwnam(user)
url = urlsplit(origin)
if (url.scheme != 'https' or not url.hostname or url.username or url.password
        or url.path or url.query or url.fragment or origin != f'https://{url.netloc}'):
    raise SystemExit('Relay must be an HTTPS origin without a path or credentials')
config = Path(account.pw_dir) / '.config/orca-selfhost'
data = Path(account.pw_dir) / '.local/share/orca-selfhost'
for parent in (Path(account.pw_dir) / '.config', Path(account.pw_dir) / '.local', data.parent):
    if not parent.exists():
        parent.mkdir(mode=0o755)
        os.chown(parent, account.pw_uid, account.pw_gid)
for directory in (config, data):
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o700)
    os.chown(directory, account.pw_uid, account.pw_gid)
for source, name in ((password_file, 'password'), (ca_file, 'relay-ca.crt')):
    if not source:
        continue
    path = Path(source)
    if not path.is_file() or path.is_symlink():
        raise SystemExit(f'{name} input must be a regular file')
    contents = path.read_bytes()
    if not contents.strip() or len(contents) > 65536:
        raise SystemExit(f'Invalid {name} file size')
    temporary = config / (name + '.new')
    temporary.unlink(missing_ok=True)
    with temporary.open('xb') as stream:
        stream.write(contents)
    temporary.chmod(0o600)
    os.chown(temporary, account.pw_uid, account.pw_gid)
    temporary.replace(config / name)
values = {
    'HOME': account.pw_dir,
    'ORCA_CLOUD_API_URL': origin,
    'ORCA_CLOUD_CLIENT_ID': 'orca-desktop',
    'ORCA_RELAY_URL': origin,
    'ORCA_SELFHOST_PASSWORD_FILE': str(config / 'password'),
    'ORCA_SELFHOST_SESSION_FILE': str(config / 'session.json'),
    'ORCA_SELFHOST_PAIRING_FILE': str(config / 'pairing.json'),
    'ORCA_SELFHOST_DATA_DIR': str(data),
    'ORCA_SELFHOST_RELAY_PAIRING': '1',
    'ORCA_SELFHOST_PORT': '6768',
    'PATH': f'{account.pw_dir}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
}
if ca_file:
    values['NODE_EXTRA_CA_CERTS'] = str(config / 'relay-ca.crt')
file = config / 'headless.env'
if file.exists():
    shutil.copy2(file, config / 'headless.env.previous')
file.write_text(''.join(f'{key}={json.dumps(value)}\n' for key, value in values.items()))
file.chmod(0o600)
os.chown(file, account.pw_uid, account.pw_gid)


def quote(value):
    if any(char.isspace() or char in '\"' for char in value):
        raise SystemExit('Service paths with whitespace or quotes are not supported')
    return value.replace('%', '%%')


unit = Path('/etc/systemd/system/orca-selfhost.service')
if unit.exists():
    shutil.copy2(unit, unit.with_suffix('.service.previous'))
unit.write_text(f'''[Unit]
Description=Orca self-hosted headless Relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User={user}
WorkingDirectory={quote(account.pw_dir)}
EnvironmentFile={quote(str(file))}
UMask=0077
TemporaryFileSystem=/tmp/.X11-unix:rw,mode=1777
ExecStartPre=/opt/orca-selfhost/current/selfhost/run-selfhost-relay.sh login
ExecStart=/opt/orca-selfhost/current/selfhost/run-selfhost-relay.sh run
Restart=on-failure
RestartSec=15
TimeoutStopSec=45
StandardOutput=null
StandardError=journal

[Install]
WantedBy=multi-user.target
''')
print(f'Configuration: {file}\nPersistent profile: {data}\nPairing: {config / "pairing.json"}')
