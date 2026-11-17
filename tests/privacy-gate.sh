#!/usr/bin/env bash
# Tier-0 static privacy gate: shape-based, zero identity literals.
# Usage: bash tests/privacy-gate.sh [--tree TREE_OID [--expected-closure-lines N]]
# No arguments: inspect tracked worktree files, including local edits.
# --tree: inspect exactly the supplied tree's blobs, never the worktree/index.
# Requires Git and Python 3; no additional repository helpers are needed.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

exec python3 - "$@" <<'PY'
import os
import re
import stat
import subprocess
import sys


class AuditError(Exception):
    pass


def note(message):
    print("privacy-gate: " + message)


def git(*args):
    # A supplied object ID must mean its original contents, not a replacement.
    result = subprocess.run(["git", "--no-replace-objects", *args],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise AuditError("git " + args[0] + " failed: " +
                         ascii(result.stderr.decode("utf-8", "replace")))
    return result.stdout


def entries(tree):
    if tree is not None:
        records = git("ls-tree", "-r", "-z", "--full-tree", tree)
    else:
        records = git("ls-files", "--stage", "-z")
    for record in records.split(b"\0"):
        if not record:
            continue
        metadata, path = record.split(b"\t", 1)
        mode, middle, last = metadata.split(b" ")
        if tree is not None:
            kind, oid = middle, last
            if kind != b"blob":
                raise AuditError("unsupported tree entry: " + ascii(os.fsdecode(path)))
        else:
            oid, stage = middle, last
            if stage != b"0":
                raise AuditError("unmerged tracked path: " + ascii(os.fsdecode(path)))
        if mode not in (b"100644", b"100755", b"120000"):
            raise AuditError("unsupported entry mode: " + ascii(os.fsdecode(path)))
        if any(part in (b"", b".", b"..") for part in path.split(b"/")):
            raise AuditError("invalid tracked path: " + ascii(os.fsdecode(path)))
        yield path, mode, oid


def worktree_content(path):
    # Walk directory descriptors without following parent or final symlinks.
    # readlink returns the link text itself, including dangling link targets.
    parts = path.split(b"/")
    directory = os.open(b".", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in parts[:-1]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=directory)
            os.close(directory)
            directory = child
        leaf = parts[-1]
        info = os.stat(leaf, dir_fd=directory, follow_symlinks=False)
        if stat.S_ISLNK(info.st_mode):
            return os.readlink(leaf, dir_fd=directory), True
        descriptor = os.open(leaf, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                             dir_fd=directory)
        with os.fdopen(descriptor, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise AuditError("not a regular file or symlink")
            return stream.read(), False
    finally:
        os.close(directory)


PRIVATE_NAMES = {b"AGENTS.md", b"CLAUDE.md", b"CLAUDE.local.md", b"skills-lock.json"}
PRIVATE_DIRS = {b".claude", b".omp", b".superpowers", b".agents"}
HOME = re.compile(rb"/home/[A-Za-z0-9_.-]+")
DRIVE = re.compile(rb"(?<![A-Za-z0-9])[A-Za-z]:[/\\]")
SCANS = (
    ("windows mount shapes", re.compile(rb"/mnt/[A-Za-z]/")),
    ("macOS user-tree shapes", re.compile(rb"/Users/[A-Za-z0-9_.-]+")),
    ("credential shapes", re.compile(
        rb"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|"
        rb"xox[bpso]-|BEGIN [A-Z ]*PRIVATE KEY")),
)
CJK = re.compile("[\u4e00-\u9fff]")
IGNORE = re.compile(rb"AGENTS\.md|CLAUDE|\.omp|\.superpowers|\.agents|skills-lock|\.claude")
CURRENT_CLOSURE_LINES = 765


def private_path(path):
    parts = path.split(b"/")
    return (any(part in PRIVATE_NAMES or part in PRIVATE_DIRS or part.startswith(b".env")
                for part in parts)
            or any(parts[index:index + 2] == [b"docs", b"superpowers"]
                   for index in range(len(parts) - 1)))


def audit(tree, expected_closure_lines):
    failed = False
    closure_seen = False

    def violation(label, path, line_number=None, line=None):
        nonlocal failed
        failed = True
        location = ascii(os.fsdecode(path))
        if line_number is not None:
            location += ":" + str(line_number)
        note(label + ": " + location)
        if line is not None:
            print("  " + ascii(line.decode("utf-8", "surrogateescape")))

    for path, mode, oid in entries(tree):
        if private_path(path):
            violation("tracked AI/personal state file", path)
        try:
            if tree is None:
                data, is_link = worktree_content(path)
            else:
                data = git("cat-file", "blob", oid.decode("ascii"))
                is_link = mode == b"120000"
        except (OSError, AuditError) as error:
            violation("cannot inspect tracked entry (" + str(error) + ")", path)
            continue

        # Count the macro list, independently of the packaged font union.
        if path == b"closure/closure-list.txt":
            closure_seen = True
            if is_link or b"\0" in data or data.count(b"\n") != expected_closure_lines:
                violation("closure/closure-list.txt must be a regular text file with " +
                          str(expected_closure_lines) + " lines; found " +
                          str(data.count(b"\n")) + " newline(s)", path)

        # Ignore files are disclosure surfaces even if they contain binary bytes.
        if path == b".gitignore":
            for number, line in enumerate(data.split(b"\n"), 1):
                if IGNORE.search(line):
                    violation("ignore-file guard: tracked .gitignore names "
                              "AI-assistant state files", path, number, line)

        # Like grep -I, NUL-containing blobs are not scanned as text. Symlink
        # targets are scanned as text, not as their referents. Only this exact
        # script path is exempt because it contains the patterns themselves.
        if path == b"tests/privacy-gate.sh" or (b"\0" in data and not is_link):
            continue
        for number, line in enumerate(data.split(b"\n"), 1):
            # Audit-ruled upstream/runtime constants, not arbitrary lines that
            # also happen to mention a constant alongside a private path.
            if any(match.group() not in (b"/home/web_user", b"/home/gboyd")
                   for match in HOME.finditer(line)):
                violation("home-directory path shapes", path, number, line)
            for label, pattern in SCANS:
                if pattern.search(line):
                    violation(label, path, number, line)
            for match in DRIVE.finditer(line):
                # Frozen spike probes have one known TeX Live installation.
                allowed = (path.startswith(b"tests/spike-corpus/") and
                           re.match(rb"d:/texlive/2024(?:[^A-Za-z0-9_.-]|$)", line[match.start():]))
                if not allowed:
                    violation("windows drive-letter shapes", path, number, line)
                    break
            if CJK.search(line.decode("utf-8", "surrogateescape")):
                violation("CJK characters in tracked text (English-only policy)",
                          path, number, line)

    if not closure_seen:
        note("missing readable closure/closure-list.txt (expected: " +
             str(expected_closure_lines) + " lines)")
        failed = True
    if not failed:
        note("clean (shapes, credentials, language, tracked-file guard, "
             "ignore-file guard, closure count)")
    return int(failed)


def main():
    args = sys.argv[1:]
    tree = None
    expected_closure_lines = CURRENT_CLOSURE_LINES
    if args:
        if len(args) not in (2, 4) or args[0] != "--tree" or not re.fullmatch(
                r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})", args[1]):
            raise AuditError("usage: bash tests/privacy-gate.sh "
                             "[--tree TREE_OID [--expected-closure-lines N]]; "
                             "TREE_OID must be a full tree object ID")
        tree = args[1].lower()
        if git("cat-file", "-t", tree).strip() != b"tree":
            raise AuditError("--tree requires a tree object, not a commit, tag or blob")
        if len(args) == 4:
            if args[2] != "--expected-closure-lines" or not re.fullmatch(r"[0-9]+", args[3]):
                raise AuditError("--expected-closure-lines requires a positive integer")
            expected_closure_lines = int(args[3])
            if expected_closure_lines <= 0:
                raise AuditError("--expected-closure-lines requires a positive integer")
    return audit(tree, expected_closure_lines)


try:
    sys.exit(main())
except (AuditError, OSError, ValueError) as error:
    note("error: " + str(error))
    sys.exit(1)
PY
