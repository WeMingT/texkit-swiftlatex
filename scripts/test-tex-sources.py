"""Exercise source identity failures and documented-source declarations."""
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("tex_sources", Path(__file__).with_name("tex-sources.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
scan_spec = importlib.util.spec_from_file_location("scan_artifacts", Path(__file__).with_name("scan-artifacts.py"))
scanner = importlib.util.module_from_spec(scan_spec)
scan_spec.loader.exec_module(scanner)


class SourceIdentityTests(unittest.TestCase):
    def test_exact_source_identity(self):
        module.verify_blob(b"source", {"bytes": 6, "sha256": "41cf6794ba4200b839c53531555f0f3998df4cbb01a4d5cb0b94e3ca5e23947d"})

    def test_truncated_source_is_rejected(self):
        with self.assertRaises(ValueError):
            module.verify_blob(b"sourc", {"bytes": 6, "sha256": "41cf6794ba4200b839c53531555f0f3998df4cbb01a4d5cb0b94e3ca5e23947d"})

    def test_changed_source_is_rejected(self):
        with self.assertRaises(ValueError):
            module.verify_blob(b"Source", {"bytes": 6, "sha256": "41cf6794ba4200b839c53531555f0f3998df4cbb01a4d5cb0b94e3ca5e23947d"})

    def test_declared_sources_stop_at_end_of_header(self):
        text = b"%% generated with the docstrip utility.\n%% The original source files were:\n%% one.dtx (with options: `a')\n%% two.fdd (with options: `b')\n%%\n% unrelated.ins\n"
        self.assertEqual(module.declared_sources(text), ["one.dtx", "two.fdd"])

    def test_source_without_generated_header(self):
        self.assertEqual(module.declared_sources(b"% Original source\n\\relax\n"), [])

    def test_identity_inside_an_official_archive_is_rejected(self):
        inner = io.BytesIO()
        with tarfile.open(fileobj=inner, mode="w:xz") as archive:
            member = tarfile.TarInfo("source/example.tex")
            data = b"% unexpected-build-machine\n"
            member.size, member.mtime = len(data), 123
            archive.addfile(member, io.BytesIO(data))
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "tex-sources.tar.gz"
            with tarfile.open(target, "w:gz") as archive:
                member = tarfile.TarInfo("archives/example.source.tar.xz")
                member.size, member.mode = len(inner.getvalue()), 0o644
                archive.addfile(member, io.BytesIO(inner.getvalue()))
            self.assertTrue(scanner.scan(target, [("unexpected-build-machine", False)]))

    def test_original_archive_dates_are_preserved(self):
        inner = io.BytesIO()
        with tarfile.open(fileobj=inner, mode="w:xz") as archive:
            member = tarfile.TarInfo("source/example.tex")
            data = b"% original source\n"
            member.size, member.mtime = len(data), 123
            archive.addfile(member, io.BytesIO(data))
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "tex-sources.tar.gz"
            with tarfile.open(target, "w:gz") as archive:
                member = tarfile.TarInfo("archives/example.source.tar.xz")
                member.size, member.mode = len(inner.getvalue()), 0o644
                archive.addfile(member, io.BytesIO(inner.getvalue()))
            self.assertEqual(scanner.scan(target, [("unexpected-build-machine", False)]), [])


if __name__ == "__main__":
    unittest.main()
