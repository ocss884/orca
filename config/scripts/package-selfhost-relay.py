#!/usr/bin/env python3
"""Package a source-built main process with hash-pinned upstream Linux runtimes."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile

VERSION = '1.4.221'
RELEASE = VERSION + '-relay.1'
BASE_SHA256 = {
    'amd64': '42445eaceccf705b8e6b1abe843cca90e86dfeb8dbfbb42ed47ed1af93c5576b',
    'arm64': 'b909aff2d894fdc6b298ac8fb14ca41643e9a7a28ba7b2d94c7c831a8df026a8',
}


def sha256(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def replace_main(archive, main):
    with archive.open('rb') as stream:
        pickle_size, header_size = struct.unpack('<II', stream.read(8))
        if pickle_size != 4 or not 8 <= header_size <= 16 * 1024 * 1024:
            raise ValueError('Invalid ASAR header')
        header_bytes = stream.read(header_size)
        json_size = struct.unpack_from('<I', header_bytes, 4)[0]
        header = json.loads(header_bytes[8:8 + json_size])
        package_entry = header['files']['package.json']
        stream.seek(8 + header_size + int(package_entry['offset']))
        package = json.loads(stream.read(package_entry['size']))
        if package['version'] != VERSION:
            raise ValueError('ASAR version does not match the source release')
        target = Path(str(archive) + '.unpacked') / 'out' / 'main'
        if target.exists():
            shutil.rmtree(target)
        tree = {'files': {}}
        for file in sorted(main.rglob('*.js')):
            relative = file.relative_to(main)
            if file.is_symlink():
                raise ValueError('Main bundle must contain regular files')
            node = tree
            for part in relative.parts[:-1]:
                node = node['files'].setdefault(part, {'files': {}})
            node['files'][relative.name] = {'size': file.stat().st_size, 'unpacked': True}
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, destination)
        if 'index.js' not in tree['files']:
            raise ValueError('Missing compiled main entry')
        header['files']['out']['files']['main'] = tree
        encoded = json.dumps(header, separators=(',', ':'), ensure_ascii=False).encode()
        payload_size = (4 + len(encoded) + 3) & ~3
        new_header = struct.pack('<II', payload_size, len(encoded)) + encoded
        new_header += bytes(payload_size - 4 - len(encoded))
        temporary = archive.with_suffix('.new')
        with temporary.open('wb') as output:
            output.write(struct.pack('<II', 4, len(new_header)))
            output.write(new_header)
            stream.seek(8 + header_size)
            shutil.copyfileobj(stream, output)
    temporary.replace(archive)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--deb', type=Path, required=True)
    parser.add_argument('--arch', choices=BASE_SHA256, required=True)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    if json.loads((root / 'package.json').read_text())['version'] != VERSION:
        raise ValueError('Source package version does not match the pinned runtime')
    if not re.fullmatch('[0-9a-f]{40}', args.source_commit):
        parser.error('--source-commit must be a full Git commit')
    if sha256(args.deb) != BASE_SHA256[args.arch]:
        raise ValueError('Upstream package checksum mismatch')
    metadata = subprocess.check_output(['dpkg-deb', '-f', str(args.deb), 'Architecture'], text=True).strip()
    if metadata != args.arch:
        raise ValueError('Upstream architecture mismatch')
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='orca-selfhost-build-') as directory:
        stage = Path(directory)
        subprocess.run(['dpkg-deb', '-x', str(args.deb), str(stage)], check=True)
        app = stage / 'opt/Orca'
        replace_main(app / 'resources/app.asar', root / 'out/main')
        (app / 'resources/app-update.yml').write_text(
            'provider: github\nowner: ocss884\nrepo: orca\nupdaterCacheDirName: orca-selfhost-updater\n')
        scripts = app / 'selfhost'
        scripts.mkdir()
        for name in ['selfhost-relay-login.mjs', 'run-selfhost-relay.sh', 'configure-selfhost-relay.py', 'verify-selfhost-relay.py']:
            shutil.copy2(root / 'config/scripts' / name, scripts / name)
        shutil.copy2(root / 'LICENSE', app / 'LICENSE.orca')
        dependencies = subprocess.check_output(['dpkg-deb', '-f', str(args.deb), 'Depends'], text=True)
        (app / 'selfhost/dependencies.txt').write_text(dependencies)
        info = {'release': RELEASE, 'upstreamVersion': VERSION, 'sourceCommit': args.source_commit,
                'architecture': args.arch, 'upstreamDebSha256': BASE_SHA256[args.arch],
                'files': {str(p.relative_to(app)): sha256(p)
                          for p in sorted((app / 'resources/app.asar.unpacked/out/main').rglob('*.js'))}}
        info['files']['resources/app.asar'] = sha256(app / 'resources/app.asar')
        info['files'].update({str(p.relative_to(app)): sha256(p) for p in scripts.iterdir() if p.is_file()})
        (app / 'BUILD-INFO.json').write_text(json.dumps(info, indent=2) + '\n')
        artifact = args.output.resolve() / f'orca-headless-{RELEASE}-linux-{args.arch}.tar.gz'
        subprocess.run(['tar', '-czf', str(artifact), '-C', str(app), '.'], check=True)
        print(f'{sha256(artifact)}  {artifact.name}')


if __name__ == '__main__':
    main()
