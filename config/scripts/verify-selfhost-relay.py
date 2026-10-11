#!/usr/bin/env python3
"""Verify a packaged fork or wait for a freshly generated native Relay offer."""
import base64
import hashlib
import json
from pathlib import Path
import sys
import time
from urllib.parse import parse_qs, urlsplit


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def verify_package(directory, release, arch):
    root = Path(directory)
    info = json.loads((root / 'BUILD-INFO.json').read_text())
    if info['release'] != release or info['architecture'] != arch:
        raise ValueError('Release or architecture mismatch')
    for name, expected in info['files'].items():
        if digest(root / name) != expected:
            raise ValueError(f'Package file mismatch: {name}')
    print(f'Package verified: {release} ({arch}), source {info["sourceCommit"]}')


def wait_ready(file, started_at):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            value = json.loads(Path(file).read_text())
            if value['generatedAt'] >= float(started_at) * 1000 and value['pairing']['available']:
                pairing = value['pairing']
                relay = pairing.get('relay', {})
                url = relay.get('url') if relay.get('available') else pairing.get('pairingUrl')
                code = parse_qs(urlsplit(url).query)['code'][0]
                offer = json.loads(base64.urlsafe_b64decode(code + '=' * (-len(code) % 4)))
                if offer.get('relay') and offer['relay']['inviteExpiresAt'] > time.time() * 1000:
                    print(f'Relay offer ready: runtime {value["runtimeId"]}')
                    return
        except (OSError, ValueError, KeyError):
            pass
        time.sleep(2)
    raise SystemExit('No fresh Relay offer after 120s; inspect the service journal and private config')


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == 'package':
        verify_package(*sys.argv[2:])
    elif len(sys.argv) == 4 and sys.argv[1] == 'service-ready':
        env_file = Path(sys.argv[2].split(' (', 1)[0])
        values = dict(line.split('=', 1) for line in env_file.read_text().splitlines() if '=' in line)
        wait_ready(json.loads(values['ORCA_PAIRING_FILE']), sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == 'ready':
        wait_ready(*sys.argv[2:])
    else:
        raise SystemExit('Usage: verify-selfhost-relay.py package DIR RELEASE ARCH | ready FILE START_EPOCH')
