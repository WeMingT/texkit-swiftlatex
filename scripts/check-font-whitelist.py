#!/usr/bin/env python3
"""Gate: every font-whitelist file is present in the packed closure tar.

The whitelist (closure/font-whitelist.txt) is the single source that drives
both materialize-closure.py staging and this assertion, so the two cannot
drift. PFB, TFM and VF trees are asserted as one set: a TFM gap is
a recoverable TeX error, a PFB or VF gap aborts the engine — all must
be closed.

Run:  python3 scripts/check-font-whitelist.py [build/texfiles.tar.gz]
Exit: 0 = every whitelisted file packed; 1 = anything missing.
"""
import os
import pathlib
import sys
import tarfile
from font_whitelist import read_entries, selected_files

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT_WHITELIST = pathlib.Path(os.environ.get(
    "FONT_WHITELIST", str(ROOT / "closure" / "font-whitelist.txt")))
TEXMF_DIST = pathlib.Path(os.environ.get(
    "TEXMF_DIST", os.path.join(os.path.expanduser("~"),
                                "texlive/2025/texmf-dist")))
TAR = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build" / "texfiles.tar.gz"


def whitelist_dirs():
    return sorted(directory for directory, _ in read_entries(FONT_WHITELIST))


MANDATORY_TREES = {
    # Structural baseline: the union-count gate in materialize-closure.py
    # is self-consistent (expected derives from the current whitelist), so
    # deleting a tree line silently re-greens every count gate. These
    # assertions pin the whitelist's shape: tree count and the
    # abort-class-critical trees (vf chains + base-font chains).
    "fonts/tfm/public/mathpazo", "fonts/vf/public/mathpazo",
    "fonts/type1/public/mathpazo",
    "fonts/type1/public/amsfonts/cmextra",
    "fonts/tfm/adobe/palatino", "fonts/type1/urw/palatino",
    "fonts/vf/adobe/palatino",
    "fonts/type1/public/fpl",
    "fonts/tfm/adobe/symbol", "fonts/type1/urw/symbol",
    "fonts/tfm/public/lm", "fonts/type1/public/lm", "fonts/enc/dvips/lm",
}


def assert_structure(dirs):
    if len(dirs) != 22:
        sys.exit(f"whitelist structure drift: {len(dirs)} trees, expected 22")
    missing = MANDATORY_TREES - set(dirs)
    if missing:
        sys.exit(f"whitelist lost mandatory trees: {sorted(missing)}")


def expected_files():
    expected = {}
    for entry in read_entries(FONT_WHITELIST):
        for path in selected_files(TEXMF_DIST, entry):
            if path.name in expected:
                sys.exit(f"duplicate font basename {path.name!r} "
                         f"({expected[path.name]} and {path})")
            expected[path.name] = path
    return expected


def assert_latin_modern_counts(expected):
    counts = {suffix: sum(path.parent.name == "lm" and
                         path.suffix == suffix for path in expected.values())
              for suffix in (".tfm", ".pfb", ".enc")}
    wanted = {".tfm": 236, ".pfb": 92, ".enc": 8}
    if counts != wanted:
        sys.exit(f"Latin Modern subset drift: {counts}, expected {wanted}")
    print(f"Latin Modern subset OK: {counts}")


def main():
    dirs = whitelist_dirs()
    assert_structure(dirs)
    expected = expected_files()
    assert_latin_modern_counts(expected)
    if not TAR.is_file():
        sys.exit(f"closure pack missing: {TAR} — run pack-closure.sh first")
    with tarfile.open(TAR, "r:gz") as tar:
        packed = {pathlib.Path(name).name for name in tar.getnames()}
    missing = sorted(name for name in expected if name not in packed)
    if missing:
        print(f"font whitelist gate FAILED: {len(missing)} missing from {TAR}:", file=sys.stderr)
        for name in missing[:20]:
            print(f"  {name}  (source: {expected[name]})", file=sys.stderr)
        if len(missing) > 20:
            print(f"  ... and {len(missing) - 20} more", file=sys.stderr)
        # docstring contract: exit 1 = anything missing — the FAILED path
        # must not fall through to the OK print.
        sys.exit(1)
    print(f"whitelist structure OK: {len(dirs)} trees (mandatory set present)")
    pfb = sum(1 for n in expected if n.endswith(".pfb"))
    tfm = sum(1 for n in expected if n.endswith(".tfm"))
    vf = sum(1 for n in expected if n.endswith(".vf"))
    enc = sum(1 for n in expected if n.endswith(".enc"))
    print(f"[fonts] whitelist gate OK: {len(expected)} files "
          f"({pfb} pfb + {tfm} tfm + {vf} vf + {enc} enc) all packed in {TAR}")


if __name__ == "__main__":
    main()
