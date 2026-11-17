"""Exercise artifact scanning through its public command line."""
from pathlib import Path
import base64
import gzip
import io
import os
import socket
import subprocess
import sys
import tarfile
import tempfile
import unittest


SCANNER = Path(__file__).resolve().parents[2] / "scripts/scan-artifacts.py"


class ArtifactScanTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def scan(self, path, *options):
        return subprocess.run([sys.executable, str(SCANNER), *options, str(path)],
                              capture_output=True, text=True)

    def scan_container_home(self, path, *options, host_needles=""):
        # Model the container home without changing the process environment.
        code = """from pathlib import Path
from unittest.mock import patch
import runpy
import sys
sys.argv = sys.argv[1:]
with patch('pathlib.Path.home', return_value=Path('/root')):
    runpy.run_path(sys.argv[0], run_name='__main__')
"""
        environment = dict(os.environ, TEXKIT_HOST_NEEDLES=host_needles)
        return subprocess.run(
            [sys.executable, "-c", code, str(SCANNER), *options, str(path)],
            capture_output=True, text=True, env=environment)

    def payloads(self, content):
        plain = self.root / "payload.bin"
        plain.write_bytes(content)
        compressed = self.root / "payload.bin.gz"
        compressed.write_bytes(gzip.compress(content, mtime=0))
        return (plain, compressed, self.archive(content))

    def assert_container_scan(self, content, expected, *options, host_needles="", nested=False):
        paths = self.payloads(content)
        if nested:
            paths += (self.nested_archive(content),)
        for path in paths:
            with self.subTest(format=path.name, content=content):
                result = self.scan_container_home(path, *options, host_needles=host_needles)
                self.assertEqual(result.returncode, expected, result.stdout + result.stderr)

    def archive(self, content, *, uid=0):
        path = self.root / "payload.tar.gz"
        with tarfile.open(path, "w:gz") as archive:
            member = tarfile.TarInfo("texmf-dist/neutral.txt")
            member.size = len(content)
            member.uid = uid
            member.mode = 0o644
            archive.addfile(member, io.BytesIO(content))
        return path

    def nested_archive(self, content):
        original = io.BytesIO()
        with tarfile.open(fileobj=original, mode="w:xz") as archive:
            member = tarfile.TarInfo("texmf-dist/neutral.txt")
            member.size, member.mtime = len(content), 123
            member.mode = 0o644
            archive.addfile(member, io.BytesIO(content))
        path = self.root / "nested.tar.gz"
        with tarfile.open(path, "w:gz") as archive:
            member = tarfile.TarInfo("archives/original.tar.xz")
            member.size, member.mode = len(original.getvalue()), 0o644
            archive.addfile(member, io.BytesIO(original.getvalue()))
        return path

    def test_scan_clean(self):
        plain = self.root / "neutral.txt"
        plain.write_bytes(b"neutral artifact\n")
        compressed = self.root / "neutral.txt.gz"
        compressed.write_bytes(gzip.compress(plain.read_bytes(), mtime=0))
        for path in (plain, compressed, self.archive(plain.read_bytes())):
            with self.subTest(path=path.name):
                result = self.scan(path)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_scan_home_in_gzip(self):
        home = str(self.root / "example-home")
        path = self.root / "leak.gz"
        path.write_bytes(gzip.compress(home.encode(), mtime=0))
        result = self.scan(path, "--needle", home)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("gzip", result.stdout)
        self.assertIn(home, result.stdout)

    def test_scan_tar_owner(self):
        result = self.scan(self.archive(b"neutral", uid=1001))
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("uid", result.stdout)
        self.assertIn("1001", result.stdout)

    def test_scan_tar_member(self):
        hostname = socket.gethostname()
        result = self.scan(self.archive(hostname.encode()))
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("texmf-dist/neutral.txt", result.stdout)
        self.assertIn(hostname, result.stdout)

    def test_exact_icu_home_resource(self):
        self.assert_container_scan(b"\0icudt76l/brkitr/root.res\0", 0)

    def test_absolute_home_path(self):
        self.assert_container_scan(b"\0/root/leaked-build/file.c\0", 1)

    def test_mixed_resource_and_home_path(self):
        neutral = b"\0icudt76l/brkitr/root.res\0"
        leak = b"\0/root/leaked-build/file.c\0"
        for content in (neutral + leak, leak + neutral):
            self.assert_container_scan(content, 1)

    def test_resource_field_boundaries(self):
        for content in (
            b"\0prefixicudt76l/brkitr/root.res\0",
            b"\0icudt76l/brkitr/root.res-suffix\0",
            b"icudt76l/brkitr/root.res\0",
            b"\0icudt76l/brkitr/root.res",
            b"\0icudt76l/other/root.res\0",
        ):
            self.assert_container_scan(content, 1)

    def test_explicit_home_needle_stays_strict(self):
        self.assert_container_scan(b"\0icudt76l/brkitr/root.res\0", 1,
                                   "--needle", "/root")

    def test_host_home_needle_stays_strict(self):
        self.assert_container_scan(b"\0icudt76l/brkitr/root.res\0", 1,
                                   host_needles="/root")

    def test_container_home_word_suffixes_are_not_paths(self):
        for content in (b"/roottop/rootbot/rootmod", b"/rootA", b"/rootz",
                        b"/root0", b"/root9", b"/root_"):
            self.assert_container_scan(content, 0, nested=True)

    def test_container_home_path_boundaries_stay_strict(self):
        for content in (b"/root", b"/root/.cache/x", b"HOME=/root\n",
                        b'"/root"', b"/root.", b"/root:", b"/root ",
                        b"/root\0", b"/root\x80", b"/root\xff"):
            self.assert_container_scan(content, 1, nested=True)

    def test_word_suffix_does_not_hide_a_later_home_path(self):
        self.assert_container_scan(b"/roottop/rootbot/rootmod /root/.cache/x", 1, nested=True)

    def test_explicit_home_word_suffix_stays_strict(self):
        self.assert_container_scan(b"/roottop", 1, "--needle", "/root", nested=True)

    def test_host_home_word_suffix_stays_strict(self):
        self.assert_container_scan(b"/roottop", 1, host_needles="/root", nested=True)

    def js(self, source):
        path = self.root / "worker.js"
        path.write_text(source, encoding="utf-8")
        return path

    def encoded(self, data):
        return "".join("\\x%02x" % value for value in data)

    def test_valid_inline_wasm_formats(self):
        wasm = b"\0asm\x01\0\0\0"
        for source in (
            "function binaryDecode(bin){};binaryDecode('" + self.encoded(wasm) + "')",
            'const wasmBinaryFile="data:application/octet-stream;base64,'
            + base64.b64encode(wasm).decode() + '";',
        ):
            with self.subTest(source=source):
                result = self.scan(self.js(source))
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_decoded_identity_hidden_from_raw_javascript(self):
        needle = "fixture-" + chr(0x6F22) + "-'\\"
        wasm = b"\0asm\x01\0\0\0" + needle.encode()
        sources = (
            "binaryDecode('" + self.encoded(wasm) + "')",
            'const wasmBinaryFile="data:application/wasm;base64,'
            + base64.b64encode(wasm).decode() + '";',
        )
        for source in sources:
            with self.subTest(source=source):
                self.assertNotIn(needle, source)
                result = self.scan(self.js(source), "--needle", needle)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn("wasm", result.stdout)
                self.assertIn(repr(needle), result.stdout)

    def test_binary_string_escapes_are_decoded_without_execution(self):
        needle = "fixture-quote-'\"-slash-\\-line-\n"
        source = 'binaryDecode("\\0asm\\x01\\u0000\\0\\0fixture-quote-\'\\\"-slash-\\\\-line-\\n")'
        result = self.scan(self.js(source), "--needle", needle)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("wasm", result.stdout)
        self.assertIn(repr(needle), result.stdout)

    def test_malformed_inline_payloads_fail_closed(self):
        for source in (
            "binaryDecode('\\0asm\\1')",
            "binaryDecode('\\0asm\\x01\\0\\0\\0",
            "binaryDecode('\\0asm\\xGG')",
            "binaryDecode('\\0asm\\u12')",
            "binaryDecode('\\0asm\\q')",
            "binaryDecode(variable)",
            "binaryDecode('not-wasm')",
            'const wasmBinaryFile="data:application/octet-stream;base64,%%%";',
            'const wasmBinaryFile="data:application/octet-stream;base64,AGFzbQ==";',
            'const wasmBinaryFile="data:application/octet-stream;base64,";',
            'const wasmBinaryFile="unknown.wasm";',
        ):
            with self.subTest(source=source):
                result = self.scan(self.js(source))
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn("cannot", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
