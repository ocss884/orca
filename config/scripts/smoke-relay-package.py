#!/usr/bin/env python3
"""Boot the packaged Relay-capable host on a disposable, background-only profile."""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time


def smoke(executable):
    with tempfile.TemporaryDirectory(prefix='orca-package-smoke-') as directory:
        root = Path(directory)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        env = {**os.environ, 'ORCA_BACKGROUND_LAUNCH': '1', 'ORCA_USER_DATA_PATH': str(root / 'profile')}
        for key in ('ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ORCA_RELAY_SESSION_FILE', 'ORCA_SELFHOST_SESSION_FILE'):
            env.pop(key, None)
        args = [str(executable), f'--user-data-dir={root / "profile"}']
        if sys.platform == 'darwin':
            args += ['--password-store=basic', '--use-mock-keychain']
        if os.geteuid() == 0:
            args.append('--no-sandbox')
        args += ['serve', '--relay', '--port', str(port), '--json']
        log = root / 'startup.log'
        errors = root / 'stderr.log'
        with log.open('w') as output, errors.open('w') as stderr:
            process = subprocess.Popen(args, env=env, stdout=output, stderr=stderr, start_new_session=True)
        try:
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                for line in log.read_text(errors='replace').splitlines():
                    try:
                        value = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(value, dict) and value.get('type') == 'orca_server_ready':
                        pairing = value.get('pairing', {})
                        if not pairing.get('available') or pairing.get('relay', {}).get('available') is not False:
                            raise RuntimeError('Expected direct pairing and an explicit signed-out Relay result')
                        print('Packaged Electron Relay host reached orca_server_ready on an isolated profile')
                        return
                if process.poll() is not None:
                    break
                time.sleep(0.5)
            # Readiness stdout carries a private invite; never copy it into CI diagnostics.
            raise RuntimeError('Packaged host did not become ready:\n' + errors.read_text(errors='replace')[-8000:])
        finally:
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(process.pid, sig)
                except ProcessLookupError:
                    break
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    continue
            process.wait(timeout=5)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('executable', type=Path)
    smoke(parser.parse_args().executable.resolve())
