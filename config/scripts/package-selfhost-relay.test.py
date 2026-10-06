import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('packager', Path(__file__).with_name('package-selfhost-relay.py'))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class AsarReplacementTest(unittest.TestCase):
    def make_archive(self, root, version='1.4.221'):
        package = json.dumps({'version': version}).encode()
        preserved = b'unchanged renderer and native metadata'
        header = {'files': {
            'package.json': {'size': len(package), 'offset': '0'},
            'renderer.js': {'size': len(preserved), 'offset': str(len(package))},
            'out': {'files': {'main': {'files': {'old-chunk.js': {'size': 3, 'offset': '0'}}}}},
        }}
        encoded = json.dumps(header).encode()
        size = (4 + len(encoded) + 3) & ~3
        header_bytes = struct.pack('<II', size, len(encoded)) + encoded + bytes(size - 4 - len(encoded))
        archive = root / 'app.asar'
        archive.write_bytes(struct.pack('<II', 4, len(header_bytes)) + header_bytes + package + preserved)
        return archive, preserved

    def test_preserves_other_offsets_and_replaces_entire_main_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, preserved = self.make_archive(root)
            main = root / 'main'
            (main / 'chunks').mkdir(parents=True)
            (main / 'index.js').write_text('require("./chunks/new.js")')
            (main / 'chunks/new.js').write_text('module.exports = "新源码"')
            (main / 'index.js.map').write_text('private source map')
            packager.replace_main(archive, main)
            raw = archive.read_bytes()
            header_size = struct.unpack_from('<I', raw, 4)[0]
            json_size = struct.unpack_from('<I', raw, 12)[0]
            header = json.loads(raw[16:16 + json_size])
            entry = header['files']['renderer.js']
            start = 8 + header_size + int(entry['offset'])
            self.assertEqual(raw[start:start + entry['size']], preserved)
            files = header['files']['out']['files']['main']['files']
            self.assertEqual(set(files), {'index.js', 'chunks'})
            self.assertTrue(files['index.js']['unpacked'])
            self.assertEqual((root / 'app.asar.unpacked/out/main/chunks/new.js').read_bytes(),
                             (main / 'chunks/new.js').read_bytes())

    def test_rejects_wrong_upstream_version_without_mutating_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, _ = self.make_archive(root, '1.4.220')
            before = archive.read_bytes()
            with self.assertRaisesRegex(ValueError, 'version'):
                packager.replace_main(archive, root / 'main')
            self.assertEqual(archive.read_bytes(), before)

    def test_rejects_invalid_header(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'app.asar'
            archive.write_bytes(struct.pack('<II', 4, 99_999_999))
            with self.assertRaisesRegex(ValueError, 'header'):
                packager.replace_main(archive, Path(directory))


    def test_package_verification_rejects_tampering_and_wrong_architecture(self):
        verify_spec = importlib.util.spec_from_file_location(
            'verify', Path(__file__).with_name('verify-selfhost-relay.py'))
        verify = importlib.util.module_from_spec(verify_spec)
        verify_spec.loader.exec_module(verify)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / 'index.js'
            file.write_text('fork source')
            info = {'release': 'test', 'architecture': 'arm64', 'sourceCommit': 'test',
                    'files': {'index.js': packager.sha256(file)}}
            (root / 'BUILD-INFO.json').write_text(json.dumps(info))
            verify.verify_package(root, 'test', 'arm64')
            with self.assertRaisesRegex(ValueError, 'architecture'):
                verify.verify_package(root, 'test', 'amd64')
            file.write_text('wrong program')
            with self.assertRaisesRegex(ValueError, 'mismatch'):
                verify.verify_package(root, 'test', 'arm64')


if __name__ == '__main__':
    unittest.main()
