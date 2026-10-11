#!/usr/bin/env python3
"""Stage the pinned upstream SSH deployment template and fork Relay service scripts."""
import argparse
import hashlib
from pathlib import Path, PurePosixPath
import shutil
import zipfile

UPSTREAM_TEMPLATE_COMMIT = '57452c681f27c03fd3c016a06da6315777db775a'
UPSTREAM_TEMPLATE_ARTIFACT = 11697030775
TEMPLATE_SHA256 = '915b2ca129fccc0f4d7e94d78f7027580d123db13e58782bc3d9c7d86b9d7ce9'
ROOT = Path(__file__).resolve().parents[2]


def stage_template(archive_path, output):
    if hashlib.sha256(archive_path.read_bytes()).hexdigest() != TEMPLATE_SHA256:
        raise ValueError('Official SSH template checksum mismatch')
    with zipfile.ZipFile(archive_path) as archive:
        for member in archive.infolist():
            relative = PurePosixPath(member.filename)
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Unsafe template path')
            destination = output.joinpath(*relative.parts)
            if member.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source, destination.open('wb') as target:
                    shutil.copyfileobj(source, target)
    if not (output / 'orcad-template.json').is_file():
        raise ValueError('Missing SSH deployment template manifest')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--template', type=Path, required=True)
    args = parser.parse_args()
    template = ROOT / 'out/orcad-template'
    if template.exists():
        shutil.rmtree(template)
    stage_template(args.template, template)
    scripts = ROOT / 'out/relay-service'
    scripts.mkdir(parents=True, exist_ok=True)
    for name in ['selfhost-relay-login.mjs', 'run-selfhost-relay.sh', 'configure-selfhost-relay.py', 'verify-selfhost-relay.py']:
        shutil.copy2(ROOT / 'config/scripts' / name, scripts / name)
    print(f'Staged verified upstream SSH template {UPSTREAM_TEMPLATE_COMMIT} and fork Relay service scripts')


if __name__ == '__main__':
    main()
