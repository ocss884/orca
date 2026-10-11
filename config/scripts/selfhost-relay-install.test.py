import importlib.util
from pathlib import Path
import tempfile
import unittest


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class RelayInstallationTest(unittest.TestCase):
    def test_uses_official_default_profile(self):
        config = module('configure-selfhost-relay')
        self.assertEqual(config.profile_directory('/home/user'), Path('/home/user/.config/orca'))
        self.assertEqual(config.profile_directory('/home/user', '/data/orca'), Path('/data/orca'))
        with self.assertRaisesRegex(ValueError, 'absolute'):
            config.profile_directory('/home/user', 'relative')

    def test_rejects_a_modified_native_template_before_extraction(self):
        prepare = module('prepare-relay-release')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'template.zip'
            archive.write_bytes(b'tampered')
            output = root / 'out'
            with self.assertRaisesRegex(ValueError, 'checksum'):
                prepare.stage_template(archive, output)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
