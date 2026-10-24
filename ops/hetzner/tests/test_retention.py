import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

PROGRAM = Path(__file__).resolve().parents[1] / 'twophotonlithography-retain-releases'
loader = importlib.machinery.SourceFileLoader('retention', str(PROGRAM))
spec = importlib.util.spec_from_loader(loader.name, loader)
retention = importlib.util.module_from_spec(spec)
loader.exec_module(retention)
OLD, A, B, C, D = [str(i) * 40 for i in range(1, 6)]


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.root = self.base / 'releases'
        self.root.mkdir()
        self.live = self.base / 'current'
        self.state = self.base / 'retention.json'
        for name in [OLD, A, B, C]:
            self.add_release(name)
        self.point(C)

    def add_release(self, revision):
        path = self.root / revision
        (path / 'dist/server').mkdir(parents=True)
        (path / 'node_modules/vinext').mkdir(parents=True)
        (path / 'dist/server/index.js').write_text('reviewed runtime')
        (path / 'node_modules/vinext/package.json').write_text('{}')
        (path / 'package.json').write_text(json.dumps({'name': 'tpl-reaction-lab'}))

    def point(self, revision):
        self.live.unlink(missing_ok=True)
        self.live.symlink_to(self.root / revision)

    def retain(self, **kwargs):
        kwargs.setdefault('unused_guard', lambda paths: None)
        return retention.retain(self.root, self.live, self.state, **kwargs)

    def initialize(self, **kwargs):
        return self.retain(initialize=True, rollbacks=[B, A], **kwargs)

    def test_preview_is_read_only_and_pins_current_regardless_of_age(self):
        os.utime(self.root / C, (1, 1))
        result = self.initialize()
        self.assertEqual(result['retained_releases'], [C, B, A])
        self.assertEqual(result['remove_paths'], [str(self.root / OLD)])
        self.assertTrue((self.root / OLD).exists())
        self.assertFalse(self.state.exists())

    def test_apply_removes_only_the_old_release_and_preserves_hardlinked_files(self):
        protected = self.root / C / 'dist/server/index.js'
        linked = self.root / OLD / 'shared.js'
        os.link(protected, linked)
        inode = protected.stat().st_ino
        self.initialize(apply=True)
        self.assertFalse((self.root / OLD).exists())
        self.assertEqual(protected.read_text(), 'reviewed runtime')
        self.assertEqual(protected.stat().st_ino, inode)
        self.assertEqual(self.live.resolve(), self.root / C)

    def test_successful_activation_rotates_two_rollbacks(self):
        self.initialize(apply=True)
        self.add_release(D)
        self.point(D)
        result = self.retain(activate=D, apply=True)
        self.assertEqual(result['retained_releases'], [D, C, B])
        self.assertFalse((self.root / A).exists())

    def test_missing_rollback_aborts_before_deletion_or_state_write(self):
        (self.root / A / 'dist/server/index.js').unlink()
        with self.assertRaises(RuntimeError):
            self.initialize(apply=True)
        self.assertTrue((self.root / OLD).exists())
        self.assertFalse(self.state.exists())

    def test_candidate_symlink_cannot_delete_external_directory(self):
        external = self.base / 'external'
        (self.root / OLD).rename(external)
        (self.root / OLD).symlink_to(external)
        with self.assertRaises(RuntimeError):
            self.initialize(apply=True)
        self.assertTrue((external / 'package.json').exists())

    def test_a_working_checkout_is_never_deleted(self):
        (self.root / OLD / '.git').mkdir()
        with self.assertRaises(RuntimeError):
            self.initialize(apply=True)
        self.assertTrue((self.root / OLD).exists())

    def test_in_use_candidate_aborts_before_any_deletion(self):
        def busy(paths):
            raise RuntimeError('a process is using this release')
        with self.assertRaises(RuntimeError):
            self.initialize(apply=True, unused_guard=busy)
        self.assertTrue((self.root / OLD).exists())
        self.assertFalse(self.state.exists())

    def test_unknown_temp_directories_are_left_alone(self):
        temporary = self.root / (D + '.tmp')
        temporary.mkdir()
        self.initialize(apply=True)
        self.assertTrue(temporary.exists())

    def test_existing_installation_requires_explicit_rollback_selection(self):
        with self.assertRaises(RuntimeError):
            self.retain(activate=C, apply=True)
        self.assertTrue((self.root / OLD).exists())

    def test_history_mismatch_refuses_to_guess(self):
        self.initialize(apply=True)
        self.point(B)
        with self.assertRaises(RuntimeError):
            self.retain(apply=True)

    def test_proc_cwd_and_mmap_references_are_detected(self):
        proc = self.base / 'proc'
        process = proc / '123'
        (process / 'fd').mkdir(parents=True)
        (process / 'cwd').symlink_to(self.root / OLD)
        (process / 'maps').write_text('')
        with self.assertRaises(RuntimeError):
            retention.check_unused([self.root / OLD], proc)
        (process / 'cwd').unlink()
        (process / 'maps').write_text('1 2 3 4 5 ' + str(self.root / OLD / 'lib.so'))
        with self.assertRaises(RuntimeError):
            retention.check_unused([self.root / OLD], proc)


class OperationsOnlyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Retention test')
        self.git('config', 'user.email', 'test@example.invalid')
        (self.repo / 'app.js').write_text('runtime')
        self.commit()
        self.old = self.git('rev-parse', 'HEAD')

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo), *args], capture_output=True,
                              text=True, check=True).stdout.strip()

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'test')

    def test_operations_and_ci_changes_skip_runtime_deployment(self):
        for name in ['ops/hetzner/README.md', '.github/workflows/ci.yml']:
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('maintenance')
        self.commit()
        self.assertTrue(retention.operations_only(self.repo, self.old, 'HEAD'))

    def test_runtime_change_still_requires_normal_deployment(self):
        (self.repo / 'app.js').write_text('new runtime')
        self.commit()
        self.assertFalse(retention.operations_only(self.repo, self.old, 'HEAD'))

    def test_identical_or_missing_revisions_are_not_classified_as_operations_only(self):
        self.assertFalse(retention.operations_only(self.repo, self.old, 'HEAD'))
        self.assertFalse(retention.operations_only(self.repo, 'missing', 'HEAD'))


if __name__ == '__main__':
    unittest.main()
