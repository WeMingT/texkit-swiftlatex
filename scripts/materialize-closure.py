#!/usr/bin/env python3
"""Materialize the S1 maximal TeX closure (619 names) on TeXLive 2025.

Name list source: closure/closure-list.txt — the committed snapshot derived by
scripts/derive-closure.py (Tier A whole-tree enumeration of the pgf/pgfplots
trees + Tier B static BFS over the TL2025 texmf-dist tree). One name per
line, all flat basenames; the staging path always mirrors the list spelling.
Each name is resolved with the local TL2025 kpsewhich and copied into
build/closure-staging/<name>. Resolution order per name:

  1. kpsewhich -progname=pdflatex <name>   (same progname the smoke/gate
                                            drivers use for supply, and the
                                            fmt build used)
  2. kpsewhich <name>                      (default progname)
  3. kpsewhich <basename>                  (strip directory form; path stays
                                            the list spelling — reported as
                                            basename_fallback)

A name unresolved after all three attempts is MISSING: printed, and the script
exits 1 (nothing silently dropped). Staging is wiped first, so the tree after a
successful run contains exactly the closure ∪ the whitelisted font trees
(count check = closure name list ∪ font whitelist (union count gate)).

Staged *.map files carry updmap-generated %-comment headers that record the
generating machine's absolute paths; those comment lines are rewritten to a
fixed neutral note (map parsers ignore comments, so this is functionally
neutral). The whole staging tree is then scanned for build-machine identity
strings (home path, hostname) — any hit fails the run. These
strings are deterministic on a given machine, so same-machine byte gates
cannot catch them; this is the leak class found in the 2026-09-01 pre-release
audit (docs/determinism.md, pdftex.map header section).

With --compare <dir>, the freshly materialized staging tree is additionally
byte-compared against another materialization of the same name list, printing
the drift split: identical / size-level drift / same-size different-content.
Drift itself is expected, recorded in docs/closure-tl2025-delta.md, and not a
failure.

Run:  python3 scripts/materialize-closure.py
      python3 scripts/materialize-closure.py --compare <closure-staging-tree>
      CLOSURE_LIST=<path> CLOSURE_STAGING=<dir> python3 scripts/materialize-closure.py
"""
import os
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# S1 closure name list — committed snapshot derived by scripts/derive-closure.py.
CLOSURE_LIST = pathlib.Path(os.environ.get(
    "CLOSURE_LIST", str(ROOT / "closure" / "closure-list.txt")))
STAGING = pathlib.Path(os.environ.get(
    "CLOSURE_STAGING", str(ROOT / "build" / "closure-staging")))
KPSEWHICH = os.environ.get(
    "KPSEWHICH",
    os.path.join(os.path.expanduser("~"),
                 "texlive/2025/bin/x86_64-linux/kpsewhich"))

# Font whitelist (engine-v1 rebuild): TL2025 texmf-dist directories
# mirrored wholesale into staging, bypassing the name-list resolution —
# font size selection is user-document-driven and must not be corpus-trimmed.
TEXMF_DIST = pathlib.Path(os.environ.get(
    "TEXMF_DIST", os.path.join(os.path.expanduser("~"),
                                "texlive/2025/texmf-dist")))
FONT_WHITELIST = pathlib.Path(os.environ.get(
    "FONT_WHITELIST", str(ROOT / "closure" / "font-whitelist.txt")))


def stage_font_whitelist(staging):
    """Copy every *.pfb / *.tfm / *.vf under the whitelisted TL2025 directories
    into staging (flat basenames, closure-list spelling). Duplicate
    basenames WITHIN the font trees are a hard error (kpsewhich would be
    ambiguous too). Returns the set of staged font basenames — the count
    gate needs the names (union semantics), not a count: the closure name
    list already carries ~99 font files of its own."""
    dirs = []
    for line in FONT_WHITELIST.read_text(encoding="utf-8").splitlines():
        entry = line.split("#", 1)[0].strip()
        if entry:
            dirs.append(entry)
    if not dirs:
        sys.exit("font whitelist is empty — expected at least the cm font directories")
    seen = {}
    for rel in dirs:
        directory = TEXMF_DIST / rel
        if not directory.is_dir():
            sys.exit(f"font whitelist directory missing in TL2025: {directory}")
        for suffix in ("*.pfb", "*.tfm", "*.vf"):
            for path in sorted(directory.glob(suffix)):
                if path.name in seen:
                    sys.exit(f"duplicate font basename {path.name!r} "
                             f"({seen[path.name]} and {path})")
                seen[path.name] = path
                shutil.copy2(path, staging / path.name)
    print(f"[fonts] whitelisted font files staged: {len(seen)}")
    return set(seen)

# --compare <tree>: byte-compare staging against another materialization and
# print the drift split (see module docstring). Parsed before main() runs.
_args = sys.argv[1:]
if _args and _args[0] == "--compare":
    if len(_args) != 2:
        sys.exit("usage: materialize-closure.py [--compare <tree>]")
    COMPARE = pathlib.Path(_args[1])
elif _args:
    sys.exit("usage: materialize-closure.py [--compare <tree>]")
else:
    COMPARE = None


def kpsewhich(name, extra=()):
    res = subprocess.run([KPSEWHICH, *extra, name],
                         capture_output=True, text=True, timeout=60)
    loc = res.stdout.strip() if res.returncode == 0 else ""
    return loc if loc and pathlib.Path(loc).is_file() else ""

# Fixed replacement for %-comment lines that carry the build machine's
# absolute home path (updmap-generated map headers). Byte-level on purpose:
# map files are not guaranteed UTF-8.
SANITIZED_NOTE = b"% (path header removed: build-machine absolute path)"


def machine_identity_needles():
    """Strings that identify the build machine; all derived at runtime (none
    hardcoded, so the checker itself carries no identity).

    Deliberately NO bare-username needle: on machines whose username is a
    common word (root in containers, runner on CI hosts) a bare substring
    scan false-positives on upstream content — observed on the first CI
    run (2026-09-01), where the "root" needle tripped 38 upstream TeX
    files (TeX macro names like \\uproot@ also collide with any
    user@host-shaped pattern). Every real leak vector embeds the username
    inside the home path (covered here) or as user@host (caught by the
    hostname needle); tar uname is normalized empty by pack-closure.sh."""
    return {
        "home-dir": os.path.expanduser("~"),
        "hostname": os.uname().nodename,
    }


def sanitize_map_headers():
    """Rewrite %-comment lines containing the build machine's absolute home
    path in staged *.map files to SANITIZED_NOTE. Map parsers ignore comment
    lines, so this is functionally neutral. A home path in a non-comment
    context is left untouched and caught by the identity scan below. Returns
    [(staged name, rewritten line count)]."""
    home = os.path.expanduser("~").encode()
    rewritten = []
    for path in sorted(STAGING.rglob("*.map")):
        data = path.read_bytes()
        if home not in data:
            continue
        lines = data.split(b"\n")
        count = sum(1 for line in lines
                    if line.startswith(b"%") and home in line)
        if not count:
            continue
        path.write_bytes(b"\n".join(
            SANITIZED_NOTE if (line.startswith(b"%") and home in line) else line
            for line in lines))
        rewritten.append((str(path.relative_to(STAGING)), count))
    return rewritten


def assert_no_machine_identity():
    """Leak gate: no staged file may contain the build machine's home path
    or hostname (see machine_identity_needles for why the username is not
    a bare needle). Such strings are deterministic on one machine, so
    same-machine rebuild gates are blind to them (the class the 2026-09-01
    pre-release audit caught in pdftex.map). Returns True when clean."""
    needles = {label: needle.encode()
               for label, needle in machine_identity_needles().items() if needle}
    hits = []
    for path in sorted(STAGING.rglob("*")):
        if not path.is_file():
            continue
        data = path.read_bytes()
        for label, needle in needles.items():
            if needle in data:
                hits.append(f"{path.relative_to(STAGING)} ({label})")
    if hits:
        print("MACHINE IDENTITY IN STAGING (leak gate FAILED):", *hits, sep="\n  ")
        return False
    return True


def compare_trees(other):
    """Byte-compare STAGING against another materialized tree of the same
    name list. Buckets: identical / size-level drift / same-size
    different-content. Returns 1 only when the name sets differ (wrong tree
    compared); drift itself is expected, recorded in the delta doc, and not a
    failure."""
    staging_names = {str(p.relative_to(STAGING))
                     for p in STAGING.rglob("*") if p.is_file()}
    other_names = {str(p.relative_to(other))
                   for p in other.rglob("*") if p.is_file()}
    only_staging = sorted(staging_names - other_names)
    only_other = sorted(other_names - staging_names)
    identical, size_level, same_size = [], [], []
    for name in sorted(staging_names & other_names):
        new = (STAGING / name).read_bytes()
        old = (other / name).read_bytes()
        if new == old:
            identical.append(name)
        elif len(new) != len(old):
            size_level.append((name, len(old), len(new)))
        else:
            same_size.append(name)
    print(f"compare_vs={other}")
    print(f"byte_compare: identical={len(identical)} "
          f"size_level_diff={len(size_level)} "
          f"same_size_diff_content={len(same_size)} "
          f"total_drift={len(size_level) + len(same_size)} "
          f"({len(identical)}+{len(size_level)}+{len(same_size)}"
          f"={len(staging_names)})")
    for name, old, new in size_level:
        print(f"  size {name}: {old} -> {new}")
    for name in same_size:
        print(f"  same-size {name}")
    if only_staging or only_other:
        print("ONLY IN STAGING:", only_staging)
        print("ONLY IN COMPARE TREE:", only_other)
        return 1
    return 0


def main():
    names = [line for line in
             (raw.rstrip() for raw in CLOSURE_LIST.read_text().splitlines())
             if line]

    if STAGING.exists():
        shutil.rmtree(STAGING)
    STAGING.mkdir(parents=True)

    missing, base_fallback = [], []
    total_bytes = 0
    for name in names:
        loc = kpsewhich(name, ["-progname=pdflatex"]) or kpsewhich(name)
        if not loc and "/" in name:
            loc = kpsewhich(pathlib.PurePosixPath(name).name,
                            ["-progname=pdflatex"]) or kpsewhich(pathlib.PurePosixPath(name).name)
            if loc:
                base_fallback.append(name)
        if not loc:
            missing.append(name)
            continue
        data = pathlib.Path(loc).read_bytes()
        dest = STAGING / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        total_bytes += len(data)

    materialized = len(names) - len(missing)
    print(f"list={len(names)} materialized={materialized} missing={len(missing)}")
    print(f"staging_bytes={total_bytes} ({total_bytes / 2**20:.2f} MiB)")
    print(f"basename_fallback={len(base_fallback)} {base_fallback}")
    if missing:
        print("MISSING:", missing)
        return 1
    font_names = stage_font_whitelist(STAGING)  # set of basenames
    on_disk = sum(1 for p in STAGING.rglob("*") if p.is_file())
    expected = len(set(names) | font_names)
    if on_disk != expected:
        print(f"STAGING COUNT MISMATCH: {on_disk} != {expected} "
              f"(closure {len(names)} ∪ fonts {len(font_names)})")
        return 1
    print(f"staging files {on_disk} == closure {len(names)} ∪ fonts {len(font_names)} OK")
    for name, count in sanitize_map_headers():
        print(f"sanitized_map_header: {name} ({count} comment line(s))")
    if not assert_no_machine_identity():
        return 1
    print("identity_scan: staging clean (no home-dir/hostname strings)")
    if COMPARE is not None:
        if not COMPARE.is_dir():
            print(f"COMPARE TREE NOT FOUND: {COMPARE}")
            return 1
        return compare_trees(COMPARE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
