import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


link = load('link')
rollback = load('rollback')


class LinkingTests(unittest.TestCase):
    def test_preview_backup_repeat_and_rollback_with_spaces(self):
        with tempfile.TemporaryDirectory(prefix='dotfiles home ') as temp, contextlib.redirect_stdout(io.StringIO()):
            home = Path(temp)
            config = home / '.config/nvim'
            config.mkdir(parents=True)
            (config / 'init.lua').write_text('original')
            agent = home / '.pi/agent'
            (agent / 'extensions').mkdir(parents=True)
            shim = agent / 'extensions/automatic-workflows.js'
            shim.write_text('old shim')
            mcp = agent / 'mcp.json'
            mcp.write_text(json.dumps({'mcpServers': {'mega-challenge': {'url': 'https://example.test'}}}))
            link.install(home)
            self.assertFalse(config.is_symlink())
            self.assertFalse((home / '.dotfiles-backups').exists())
            changes = link.install(home, apply=True)
            self.assertTrue(config.is_symlink())
            self.assertFalse(shim.exists())
            self.assertFalse(mcp.exists())
            self.assertEqual(link.install(home, apply=True), [])
            manifest = next((home / '.dotfiles-backups').glob('*/manifest.json'))
            self.assertTrue(changes)
            rollback.rollback(manifest, apply=True)
            self.assertEqual((config / 'init.lua').read_text(), 'original')
            self.assertEqual(shim.read_text(), 'old shim')
            self.assertTrue(mcp.exists())

    def test_personal_opt_in_and_refuse_changed_rollback(self):
        with tempfile.TemporaryDirectory() as temp, contextlib.redirect_stdout(io.StringIO()):
            home = Path(temp)
            link.install(home, apply=True, personal=True)
            self.assertTrue((home / '.pi/agent/mcp.json').is_symlink())
            dest = home / '.config/nvim'
            dest.unlink()
            dest.mkdir()
            manifest = next((home / '.dotfiles-backups').glob('*/manifest.json'))
            with self.assertRaises(RuntimeError):
                rollback.rollback(manifest, apply=True)
            self.assertTrue(dest.is_dir())

    def test_mixed_mcp_fails_before_mutation(self):
        with tempfile.TemporaryDirectory() as temp, contextlib.redirect_stdout(io.StringIO()):
            home = Path(temp)
            agent = home / '.pi/agent'
            agent.mkdir(parents=True)
            (agent / 'mcp.json').write_text(json.dumps({'mcpServers': {'mega-challenge': {}, 'work': {}}}))
            with self.assertRaises(RuntimeError):
                link.install(home, apply=True)
            self.assertFalse((home / '.config').exists())


if __name__ == '__main__':
    unittest.main()
