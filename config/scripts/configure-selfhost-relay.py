#!/usr/bin/env python3
"""Configure Relay on Orca's ordinary Linux profile and installation."""
import argparse
import json
import os
from pathlib import Path
import pwd
import shutil
from urllib.parse import urlsplit


def profile_directory(home, explicit=None):
    directory = Path(explicit) if explicit else Path(home) / '.config' / 'orca'
    if not directory.is_absolute():
        raise ValueError('The Orca data directory must be absolute')
    return directory


def configure(user, origin, password_file, ca_file='', scope='runtime', data_dir=None):
    account = pwd.getpwnam(user)
    url = urlsplit(origin)
    if (url.scheme != 'https' or not url.hostname or url.username or url.password
            or url.path or url.query or url.fragment or origin != f'https://{url.netloc}'):
        raise ValueError('Relay must be an HTTPS origin without a path or credentials')
    if scope not in ('runtime', 'mobile'):
        raise ValueError('Pairing scope must be runtime or mobile')
    data = profile_directory(account.pw_dir, data_dir)
    if not data.parent.exists():
        data.parent.mkdir(parents=True, mode=0o755)
        os.chown(data.parent, account.pw_uid, account.pw_gid)
    data.mkdir(exist_ok=True, mode=0o700)
    os.chown(data, account.pw_uid, account.pw_gid)
    for source, name in ((password_file, 'relay-password'), (ca_file, 'relay-ca.crt')):
        if not source:
            continue
        path = Path(source)
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'{name} input must be a regular file')
        contents = path.read_bytes()
        if not contents.strip() or len(contents) > 65536:
            raise ValueError(f'Invalid {name} file size')
        temporary = data / (name + '.new')
        with temporary.open('xb') as stream:
            stream.write(contents)
        temporary.chmod(0o600)
        os.chown(temporary, account.pw_uid, account.pw_gid)
        temporary.replace(data / name)
    values = {
        'HOME': account.pw_dir,
        'ORCA_CLOUD_API_URL': origin,
        'ORCA_CLOUD_CLIENT_ID': 'orca-desktop',
        'ORCA_RELAY_URL': origin,
        'ORCA_RELAY_PASSWORD_FILE': str(data / 'relay-password'),
        'ORCA_RELAY_SESSION_FILE': str(data / 'relay-session.json'),
        'ORCA_PAIRING_FILE': str(data / 'pairing.json'),
        'ORCA_USER_DATA_PATH': str(data),
        'ORCA_PAIRING_SCOPE': scope,
        'ORCA_SERVE_PORT': '6768',
        'PATH': f'{account.pw_dir}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    }
    if ca_file:
        values['NODE_EXTRA_CA_CERTS'] = str(data / 'relay-ca.crt')
    file = data / 'relay.env'
    if file.exists():
        shutil.copy2(file, data / 'relay.env.previous')
    # EnvironmentFile does no shell interpolation; keep all values on one quoted line.
    temporary = data / 'relay.env.new'
    with temporary.open('x') as stream:
        stream.write(''.join(f'{key}={json.dumps(value)}\n' for key, value in values.items()))
    temporary.chmod(0o600)
    os.chown(temporary, account.pw_uid, account.pw_gid)
    temporary.replace(file)

    def quote(value):
        if any(char.isspace() or char in '\\"' for char in value):
            raise ValueError('Service paths with whitespace or quotes are not supported')
        return value.replace('%', '%%')

    unit = Path('/etc/systemd/system/orca.service')
    if unit.exists():
        shutil.copy2(unit, unit.with_suffix('.service.previous'))
    unit.write_text(f'''[Unit]
Description=Orca server with Relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User={user}
WorkingDirectory={quote(account.pw_dir)}
EnvironmentFile={quote(str(file))}
UMask=0077
TemporaryFileSystem=/tmp/.X11-unix:rw,mode=1777
ExecStartPre=/opt/Orca/resources/relay/run-selfhost-relay.sh login
ExecStart=/opt/Orca/resources/relay/run-selfhost-relay.sh run
Restart=on-failure
RestartSec=15
KillMode=process
TimeoutStopSec=45
StandardOutput=null
StandardError=journal

[Install]
WantedBy=multi-user.target
''')
    print(f'Configuration: {file}\nOrca profile: {data}\nPairing ({scope}): {data / "pairing.json"}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--user', required=True)
    parser.add_argument('--relay', required=True)
    parser.add_argument('--password-file', required=True)
    parser.add_argument('--ca', default='')
    parser.add_argument('--scope', choices=['runtime', 'mobile'], default='runtime')
    parser.add_argument('--data-dir')
    args = parser.parse_args()
    configure(args.user, args.relay, args.password_file, args.ca, args.scope, args.data_dir)
