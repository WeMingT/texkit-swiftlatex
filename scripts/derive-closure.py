#!/usr/bin/env python3
r"""Derive the S1 maximal TeX closure name list from the local TL2025 tree.

Replaces the shipped name derivation (frozen spike probe union + hand-audited
SUPPLEMENT, 202 names) with a reproducible derivation from the TL2025
texmf-dist tree. Method (2026-08-31 ruling):

  Tier A  whole-tree enumeration of the pgf/pgfplots owned directories —
          every \usetikzlibrary / \usepgflibrary / \usepgfplotslibrary target
          of pgf 3.1.11a / pgfplots 1.18.2, regardless of option gates or
          engine branches. Hard exclusions: graphdrawing/ (LuaTeX-only),
          every lua/ subtree and *.lua file, pgfplots/test/, and every
          output-driver *.def the shipped pdfTeX engine never selects
          (only pgfsys-pdftex.def, pgfsys-luatex.def, pgfsys-common-pdf.def
          and pgfutil-latex.def are ever loaded — all four are already in the
          202 baseline).
  Tier B  static BFS from the document layer + external family entry points.
          Edges: \RequirePackage / \usepackage (incl.
          \RequirePackageWithOptions; comma lists, [options] stripped),
          \input X and \input{X} (the NO-BRACE form is load-bearing:
          chemfig.sty loads chemfig.tex via `\input chemfig.tex`),
          \usetikzlibrary / \usepgflibrary / \usepgfplotslibrary (library
          files living in package dirs outside the pgf tree, e.g.
          tikzlibrarycd.code.tex), and the font-declaration chain:
          \DeclareSymbolFont / \SetSymbolFont / \DeclareMathAlphabet /
          \SetMathAlphabet {ENC}{FAM} -> <enc><fam>.fd ->
          \DeclareFontShape size specs -> <metric>.tfm (+ <metric>.vf when
          present) -> pfb via pdftex.map.
          Over-coverage is accepted and NOT pruned (risk ruling): option-
          gated requires (circuitikz' siunitx chain) and \ifluatex
          branches (tkz-euclide's luacode) are wanted edges. Known blind
          spots (macro-computed names, e.g. \RequirePackage{tikzlings-#1})
          are reported, not chased.
  Baseline  the shipped 202 names (union-summary.json perFig union ∪
          SUPPLEMENT) stay in the closure unconditionally; Tier A/B only add.

Output: closure/closure-list.txt — one flat basename per line (staging-tree
spelling), sorted, LF, single trailing newline. materialize-closure.py
consumes this list; its resolution order (kpsewhich -progname=pdflatex,
then kpsewhich) is mirrored here so every emitted name is known-resolvable.

Gates (exit 1 on violation):
  - any Tier A/B name that kpsewhich cannot resolve (nothing silently
    dropped), or that resolves to a different file than the one enumerated,
  - duplicate basenames over distinct TL2025 files,
  - shape: total > 650, or any beamer/hyperref/babel/geometry family name
    (generic typesetting packages ⇒ a seed or BFS bug).

Determinism: a pure function of (TL2025 tree, union-summary.json). No
timestamps, no unordered-set iteration reaching the output; every report
list is sorted. Verify by running twice and byte-comparing the snapshot.

Run:  python3 scripts/derive-closure.py
      TEXMF_DIST=... KPSEWHICH=... CLOSURE_LIST=... UNION_SUMMARY=... \
        python3 scripts/derive-closure.py
"""
import json
import os
import pathlib
import re
import subprocess
import sys
from collections import OrderedDict, deque

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEXMF_DIST = pathlib.Path(os.environ.get(
    "TEXMF_DIST", os.path.join(os.path.expanduser("~"),
                                "texlive/2025/texmf-dist")))
# Frozen spike probe artifact, vendored in-repo (verbatim copy of the probe
# run's union summary — the 202-baseline name source).
UNION_SUMMARY = pathlib.Path(os.environ.get(
    "UNION_SUMMARY",
    str(ROOT / "tests" / "spike-corpus" / "union-summary.json")))
KPSEWHICH = os.environ.get(
    "KPSEWHICH",
    os.path.join(os.path.expanduser("~"),
                 "texlive/2025/bin/x86_64-linux/kpsewhich"))
CLOSURE_LIST = pathlib.Path(os.environ.get(
    "CLOSURE_LIST", str(ROOT / "closure" / "closure-list.txt")))

MAX_TOTAL = 650          # brief Step 4: >650 means a seed or BFS bug
FORBIDDEN_PREFIXES = ("beamer", "hyperref", "babel", "geometry")

# DERIVE_CLOSURE_DEBUG=1 prints the first BFS edge that pulled in each name.
DEBUG = bool(os.environ.get("DERIVE_CLOSURE_DEBUG"))


# Hand-audited supplement to the probe union — the plan's exception hook
# (SUPPLEMENT stays as a fallback for macro-computed names static
# BFS cannot see). Moved here from materialize-closure.py; that script now
# takes its names from closure-list.txt.
# The probe trace has a blind spot: packages preloaded in the probe format
# generate no file request, so closure files with hard RequirePackage targets
# ship without them. epstopdf-base.sty (in the union via fig 09-amsmath)
# requires infwarerr, grfext, kvoptions, pdftexcmds; transitively kvoptions ->
# ltxcmds + kvsetkeys, grfext -> kvdefinekeys, pdftexcmds -> infwarerr +
# ltxcmds. Without these, amsmath-family blocks fail under the shipped
# pdfTeX fmt with "File infwarerr.sty not found" (verified on-device
# 2026-08-31; same supplement added plugin-side in materialize-spike-engine.mjs).
#
# 2026-09-01 additions — five more blind spots of the same
# class, each verified as a hard runtime load of a corpus figure by the
# corpus gate before supplementing (worker served 601-file staging, figure
# failed on exactly this name, green after the supplement):
# 1. Macro-concatenated package loop: tikzlings v2.5's core tikzlings.sty
#    does \RequirePackage{tikzlings-#1} over its whole animal list; loading
#    all 28 animal packages is neither wanted nor shippable, so the corpus
#    figure loads the flagship penguin package directly (which requires only
#    tikz + tikzlings-addons, both in the closure).
# 2. Kernel file substitution: latex.ltx declares
#    \declare@file@substitution{atveryend.sty}{atveryend-ltx.sty}, so
#    \usepackage{atveryend} (tikzlibraryexternal.code.tex, pulled in by
#    tikz-feynhand) loads atveryend-ltx.sty — a name no source file spells.
# 3. Aliased loader: pgfplots' dateplot library does
#    \pgfutil@usemodule{pgfcalendar}, which pgfutil-latex.def expands to
#    \usepackage{pgfcalendar} — invisible to RE_PKG_LOAD.
# 4. Macro-concatenated module loop: tkz-base's loader tkz-tools-modules.tex
#    runs \input tkz-obj-\tkz@temp.tex / \input tkz-tools-\tkz@temp.tex for
#    tkz-base.sty's \usetkztool{base,utilities,colors,text,BB,arith,print,
#    misc} + \usetkzobj{axes,grids,marks,points,rep} — exactly the 13 module
#    files tkz-base ships in TL2025, all hard loads of any tkz-fct figure.
# 5. Load-bearing "optional" configs: tkz-euclide.sty / tkz-base.sty load
#    their .cfg via \InputIfFileExists (no static edge), but the cfg defines
#    \tkz@grid@color, which the grid modules reference at load time —
#    without the cfg the compile dies on "Undefined control sequence".
#    (numprint.cfg, probed by tkz-base -> numprint, is NOT load-bearing and
#    not even shipped in TL2025 — it stays a tolerated miss.)
SUPPLEMENT = frozenset({
    "infwarerr.sty",
    "grfext.sty",
    "kvoptions.sty",
    "pdftexcmds.sty",
    "ltxcmds.sty",
    "kvsetkeys.sty",
    "kvdefinekeys.sty",
    # tikzlings macro-loaded animal (blind spot 1)
    "tikzlings-penguins.sty",
    # kernel file substitution (blind spot 2)
    "atveryend-ltx.sty",
    # \pgfutil@usemodule alias (blind spot 3)
    "pgfcalendar.sty",
    # tkz-base macro-loaded modules (blind spot 4)
    "tkz-tools-base.tex",
    "tkz-tools-utilities.tex",
    "tkz-tools-colors.tex",
    "tkz-tools-text.tex",
    "tkz-tools-BB.tex",
    "tkz-tools-arith.tex",
    "tkz-tools-print.tex",
    "tkz-tools-misc.tex",
    "tkz-obj-axes.tex",
    "tkz-obj-grids.tex",
    "tkz-obj-marks.tex",
    "tkz-obj-points.tex",
    "tkz-obj-rep.tex",
    # load-bearing optional configs (blind spot 5)
    "tkz-base.cfg",
    "tkz-euclide.cfg",
})


# --------------------------------------------------------------------------
# Tier A — whole-tree enumeration
# --------------------------------------------------------------------------

PGF = TEXMF_DIST / "tex/generic/pgf"
PGFPLOTS_GENERIC = TEXMF_DIST / "tex/generic/pgfplots"
PGFPLOTS_LATEX = TEXMF_DIST / "tex/latex/pgfplots"

# The only .def files the shipped pdfTeX+LaTeX engine ever loads; all are
# already in the 202 baseline. Every other .def in the enumerated trees is
# either a foreign output driver (the 13 systemlayer pgfsys-*.def, the
# pgfplots surfshading driver variants, pgfsys-luatexpatch.def) or a
# ConTeXt/Plain format selector (pgfutil-context.def, pgfutil-plain.def).
TIER_A_KEEP_DEFS = frozenset({
    "pgfsys-pdftex.def",
    "pgfsys-luatex.def",
    "pgfsys-common-pdf.def",
    "pgfutil-latex.def",
})

# Font definition files preloaded in the shipped pdflatex fmt. Verified
# against build/fmt-out/fmt-run1.log: latex.ltx -> fonttext.ltx inputs these
# at fmt-build time, so their \DeclareFontShape declarations live in the
# format dump and the engine never requests the .fd (or the CM fonts behind
# it) at runtime — method note: fmt-preloaded families are not
# counted again. Following euler.sty's OT1/OMS/OML declarations without this
# rule would drag ~70 CM tfm/pfb files into the closure.
FMT_PRELOADED_FDS = frozenset({
    "omlcmm.fd", "omscmsy.fd", "omxcmex.fd",
    "ot1cmr.fd", "ot1cmss.fd", "ot1cmtt.fd",
    "t1cmr.fd", "t1cmss.fd", "t1cmtt.fd",
    "ts1cmr.fd", "ts1cmss.fd", "ts1cmtt.fd",
    "ucmr.fd",
})

# Tier A categories: (label, root dir, glob). Order = report order; the
# closure itself is a sorted union, so order only affects the report.
TIER_A_TREES = (
    ("tikz_libs", PGF / "frontendlayer/tikz/libraries", "*.code.tex"),
    ("pgf_libs", PGF / "libraries", "*.tex"),
    ("pgf_modules", PGF / "modules", "*.tex"),
    ("pgf_utilities", PGF / "utilities", "*"),
    ("pgf_math", PGF / "math", "*"),
    ("pgfplots_generic", PGFPLOTS_GENERIC, "*"),
)


def tier_a_hard_excluded(path, root):
    """Hard exclusions, applied to every Tier A tree."""
    rel = path.relative_to(root)
    if "graphdrawing" in rel.parts:      # LuaTeX-only, pdfTeX never reaches it
        return True
    if "lua" in rel.parts:               # every lua/ subtree
        return True
    if path.name.endswith(".lua"):
        return True
    if "test" in rel.parts and root == PGFPLOTS_GENERIC:  # pgfplots/test/
        return True
    if path.suffix == ".def" and path.name not in TIER_A_KEEP_DEFS:
        return True                      # foreign driver / format selector
    return False


def enumerate_tier_a():
    """Returns (per-category name lists, tree paths by name). Exits with an
    error if two distinct TL2025 files in the enumerated trees share a
    basename — never silently pick one (ruling 2)."""
    categories = OrderedDict()
    paths = {}  # basename -> absolute tree path (duplicate gate)

    def add(path):
        prior = paths.get(path.name)
        if prior is None:
            paths[path.name] = path
        elif prior != path:
            sys.exit(f"DUPLICATE BASENAME in Tier A trees: {path.name} "
                     f"lives at both\n  {prior}\n  {path}")

    for label, root, pattern in TIER_A_TREES:
        found = []
        for path in sorted(root.rglob(pattern)):
            if not path.is_file() or tier_a_hard_excluded(path, root):
                continue
            if label == "pgf_utilities" and path.name in (
                    "pgfutil-context.def", "pgfutil-plain.def"):
                # format selectors for ConTeXt/Plain — the shipped
                # pdfTeX+LaTeX engine never loads them (pgfutil-latex.def
                # is in the 202 baseline)
                continue
            found.append(path.name)
            add(path)
        categories[label] = found
    # pgfplots LaTeX side: the table wrapper + clickable libs. bugtracker.sty
    # and pgfregressiontest.sty are test infra (same class as pgfplots/test/)
    # and are not enumerated; pgfplots.sty itself is in the 202 baseline.
    latex = [PGFPLOTS_LATEX / "pgfplotstable.sty"]
    latex += sorted(PGFPLOTS_LATEX.glob("libs/tikzlibrarypgfplots*.code.tex"))
    for path in latex:
        add(path)
    categories["pgfplots_latex"] = [p.name for p in latex]
    # pgfsysanimations: the only systemlayer file neither in the
    # baseline nor a foreign driver.
    categories["pgfsysanimations"] = ["pgfsysanimations.code.tex"]
    add(PGF / "systemlayer/pgfsysanimations.code.tex")
    return categories, paths


# --------------------------------------------------------------------------
# Tier B — static BFS
# --------------------------------------------------------------------------

# Document layer (the driver .def/.cfg files MUST be seeds — they
# are selected via the \Gin@driver macro, invisible to static edges) plus the
# external family entry points and the two additions
# the original seed table omitted (amsmath-2018-12-01, cmmib57).
TIER_B_SEEDS = (
    # document layer
    "standalone.cls",
    "article.cls",
    "amsmath.sty",
    "pdftex.def",
    "graphics.cfg",
    "color.cfg",
    # external family entries
    "circuitikz.sty",
    "chemfig.sty",
    "tikz-cd.sty",
    "tikz-3dplot.sty",
    "quantikz.sty",
    "tikz-feynhand.sty",
    "tikz-feynman.sty",
    "pgf-umlsd.sty",
    "tkz-euclide.sty",
    "tkz-fct.sty",
    "tkz-tab.sty",
    "tikzlings.sty",
    "hf-tikz.sty",
    "amscd.sty",
    "amstex.sty",
    "amsxtra.sty",
    "eucal.sty",
    "eufrak.sty",
    "euscript.sty",
    "euler.sty",
    "mathrsfs.sty",
    "array.sty",
    "ifthen.sty",
    # AMS compat shims. NOTE: the original seed table spelled
    # cmmib57 as a .tfm; TL2025 (like TL2024) ships only the obsolete .sty
    # stub — the amsfonts v3 cmmib57.tfm no longer exists.
    "amsmath-2018-12-01.sty",
    "cmmib57.sty",
    # circuitikz siunitx option chain (option-gated off by default, so
    # also seeded explicitly; the unconditional \RequirePackage{siunitx}
    # inside \ifpgf@circ@siunitx is a wanted over-coverage edge)
    "siunitx.sty",
    # tikz-bbox: third-party pgf library living in its own package
    # dir — pgf-tree enumeration cannot reach it, so it is a seed.
    "pgflibrarybbox.code.tex",
    # quantikz family ships BOTH tikzlibrary{quantikz,quantikz2}
    # .code.tex; quantikz.sty only loads quantikz2, the v1 library is
    # reachable solely via an explicit \usetikzlibrary{quantikz}.
    "tikzlibraryquantikz.code.tex",
)

# File types that never carry static load edges.
BINARY_SUFFIXES = frozenset({".tfm", ".pfb", ".vf", ".fmt"})

RE_PKG_LOAD = re.compile(
    r"\\(?:RequirePackage|usepackage|RequirePackageWithOptions)"
    r"(?![a-zA-Z])\s*(?:\[[^\[\]]*\]\s*)?\{([^{}\\]*)\}")
RE_TIKZ_LIB = re.compile(
    r"\\usetikzlibrary(?![a-zA-Z])\s*(?:\[[^\[\]]*\]\s*)?\{([^{}\\]*)\}")
RE_PGF_LIB = re.compile(
    r"\\usepgflibrary(?![a-zA-Z])\s*(?:\[[^\[\]]*\]\s*)?\{([^{}\\]*)\}")
RE_PGFPLOTS_LIB = re.compile(
    r"\\usepgfplotslibrary(?![a-zA-Z])\s*(?:\[[^\[\]]*\]\s*)?\{([^{}\\]*)\}")
RE_INPUT_BRACED = re.compile(r"\\input(?![a-zA-Z])\s*\{([^{}]*)\}")
RE_INPUT_BARE = re.compile(r"\\input(?![a-zA-Z])\s+([A-Za-z0-9._\-/]+)")
RE_FONT_DECL = re.compile(
    r"\\(DeclareSymbolFont|SetSymbolFont|DeclareMathAlphabet|SetMathAlphabet)"
    r"(?![a-zA-Z])")
RE_FONT_SHAPE = re.compile(r"\\DeclareFontShape(?![a-zA-Z])")

# {command: (enc arg index, fam arg index)} — Declare* take
# {NAME}{ENC}{FAM}{SER}{SHD}, Set* take {NAME}{VERSION}{ENC}{FAM}{SER}{SHD}.
FONT_DECL_ARGPOS = {
    "DeclareSymbolFont": (1, 2),
    "DeclareMathAlphabet": (1, 2),
    "SetSymbolFont": (2, 3),
    "SetMathAlphabet": (2, 3),
}
IDENTIFIER = re.compile(r"[A-Za-z][A-Za-z0-9]*")
PLAIN_NAME = re.compile(r"[A-Za-z][A-Za-z0-9._\-/]*")
# tikz/pgf/pgfplots library names may contain dots and digits (arrows.meta,
# shapes.geometric, 3d, quantikz2).
LIB_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._\-]*")
# LaTeX size-function keywords that are not font names (fontnames in size
# specs never contain '*', so sub/ssub/gen/sgen forms are rejected by the
# identifier filter already).
SIZEFN_KEYWORDS = frozenset({"sub", "ssub", "gen", "sgen", "empty",
                             "scaled", "at"})


def strip_comments(text):
    """Drop everything from the first unescaped % to end of line (handles
    \\% and \\\\% correctly)."""
    lines = []
    for line in text.split("\n"):
        i, n = 0, len(line)
        while i < n:
            c = line[i]
            if c == "\\":
                i += 2          # skip escaped char (covers \% and \\)
                continue
            if c == "%":
                break
            i += 1
        lines.append(line[:i])
    return "\n".join(lines)


def parse_tex_args(text, pos, count):
    """Parse up to `count` TeX arguments at `pos`: each is a balanced
    {...} group or a single control sequence. Returns (args, endpos)."""
    args = []
    i, n = pos, len(text)
    while len(args) < count:
        while i < n and text[i] in " \t\r\n":
            i += 1
        if i >= n:
            break
        c = text[i]
        if c == "{":
            depth, j = 0, i
            while j < n:
                if text[j] == "{":
                    depth += 1
                elif text[j] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            if j >= n or depth != 0:
                break
            args.append(text[i + 1:j])
            i = j + 1
        elif c == "\\":
            j = i + 1
            if j < n and text[j].isalpha():
                while j < n and text[j].isalpha():
                    j += 1
            else:
                j += 1
            args.append(text[i:j])
            i = j
        else:
            break
    return args, i


def metric_candidates(sizespec):
    """Font metric names from a \\DeclareFontShape size spec: strip <...>
    size entries, keep identifier tokens (rejects sub*/gen* forms, keywords,
    dimension arguments)."""
    stripped = re.sub(r"<[^<>]*>", " ", sizespec)
    out = []
    for tok in stripped.split():
        if len(tok) < 2 or tok in SIZEFN_KEYWORDS:
            continue
        if IDENTIFIER.fullmatch(tok) is None:
            continue
        out.append(tok)
    return out


class Resolver:
    """kpsewhich resolution with caching; mirrors materialize-closure.py's
    order: -progname=pdflatex first, then the default progname."""

    def __init__(self):
        self._cache = {}
        self.calls = 0

    def _run(self, name, extra):
        self.calls += 1
        res = subprocess.run([KPSEWHICH, *extra, name],
                             capture_output=True, text=True, timeout=60)
        loc = res.stdout.strip() if res.returncode == 0 else ""
        return loc if loc and pathlib.Path(loc).is_file() else ""

    def resolve(self, name):
        if name in self._cache:
            return self._cache[name]
        loc = (self._run(name, ["-progname=pdflatex"])
               or self._run(name, []))
        self._cache[name] = loc
        return loc


def load_pdftex_map(resolver):
    """tfm name -> pfb file, first line wins (updmap-generated maps list
    each tfm once)."""
    loc = resolver.resolve("pdftex.map")
    if not loc:
        sys.exit("FATAL: kpsewhich cannot resolve pdftex.map")
    mapping = {}
    with open(loc, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("!"):
                continue
            fields = line.split()
            if not fields:
                continue
            # pdftex.map lines are "tfmname PSNAME [flags] <font.pfb" — the
            # pfb token has NO closing '>'
            m = re.search(r"<([^<>\s]+\.pfb)", line)
            if m:
                mapping.setdefault(fields[0], m.group(1))
    return mapping


def extract_edges(text, resolver, pdftex_map, macro_skipped):
    r"""Static load edges of one comment-stripped file, as (candidates, soft)
    tuples: candidates are ordered like the loaders' own fallback order;
    soft=True marks no-brace \input forms whose token can be a truncated
    macro concatenation (unresolvable -> reported blind spot, not a gate
    failure)."""
    deps = []

    for match in RE_PKG_LOAD.finditer(text):
        for name in match.group(1).split(","):
            name = name.strip()
            if not name:
                continue
            if PLAIN_NAME.fullmatch(name) is None:
                macro_skipped.add(name)   # macro-computed name: blind spot
                continue
            deps.append(((name + ".sty" if "." not in name else name,), False))

    for regex, prefixes in (
            (RE_TIKZ_LIB, ("tikzlibrary{0}.code.tex",
                           "pgflibrary{0}.code.tex")),
            (RE_PGF_LIB, ("pgflibrary{0}.code.tex",)),
            (RE_PGFPLOTS_LIB, ("tikzlibrarypgfplots.{0}.code.tex",
                               "pgflibrarypgfplots.{0}.code.tex"))):
        for match in regex.finditer(text):
            for name in match.group(1).split(","):
                name = name.strip()
                if not name:
                    continue
                # library names may contain dots/digits (arrows.meta, 3d);
                # trailing separator = macro concatenation artifact
                if (LIB_NAME.fullmatch(name) is None
                        or name.endswith((".", "-", "/"))):
                    macro_skipped.add(name)
                    continue
                deps.append((tuple(p.format(name) for p in prefixes), False))

    for match in RE_INPUT_BRACED.finditer(text):
        name = match.group(1).strip()
        if not name:
            continue
        if "\\" in name or "#" in name:
            macro_skipped.add(name)     # e.g. \input{size\@ptsize.clo},
            continue                    # \input{#2.def} in pgf's loaders
        # \input{X} without extension makes TeX append its default .tex
        deps.append(((name if "." in name else name + ".tex",), False))

    for match in RE_INPUT_BARE.finditer(text):
        name = match.group(1)
        if name.endswith((".", "-", "/")):
            # macro-continuation artifact like
            # `\input pgflibrarypgfplots.surfshading.\pgfsysdriver\relax` —
            # a real no-brace \input target is a complete filename
            macro_skipped.add(name)
        elif "." in name:
            deps.append(((name,), True))
        else:
            # no-brace \input without extension (e.g. `\input xkeyval` in
            # xkeyval.sty, `\input xkvutils` in xkeyval.tex): TeX appends
            # its default extension .tex
            deps.append(((name + ".tex", name), True))

    for match in RE_FONT_DECL.finditer(text):
        args, _ = parse_tex_args(text, match.end(), 6)
        enc_i, fam_i = FONT_DECL_ARGPOS[match.group(1)]
        if len(args) <= fam_i:
            continue
        enc, fam = args[enc_i], args[fam_i]
        if (IDENTIFIER.fullmatch(enc) and IDENTIFIER.fullmatch(fam)):
            deps.append(((enc.lower() + fam.lower() + ".fd",), False))
        else:
            # e.g. euler.sty's {T1}\rmdefault — resolved at runtime against
            # the text fonts; not a static target.
            macro_skipped.add(enc + "/" + fam)

    for match in RE_FONT_SHAPE.finditer(text):
        args, _ = parse_tex_args(text, match.end(), 6)
        if len(args) < 5:
            continue
        for metric in metric_candidates(args[4]):
            deps.append(((metric + ".tfm",), False))
            if resolver.resolve(metric + ".vf"):
                deps.append(((metric + ".vf",), False))
            pfb = pdftex_map.get(metric)
            if pfb:
                deps.append(((pfb,), False))

    return deps


def hard_excluded_path(loc):
    """Hard exclusions applied to BFS-resolved files — the ruling puts
    them "everywhere", not just over the Tier A trees:
      - tex/plain/: the plain-TeX format tree (tikz.tex, pgf.tex, ...),
        reachable only via format conditionals pdflatex never takes (e.g.
        chemfig.tex's \\unless\\ifdefined\\tikzpicture \\input tikz.tex);
      - graphdrawing/: LuaTeX-only (reached via \\usetikzlibrary{graphdrawing}
        in tikzlibraryfeynman.code.tex — auto layout; pdfTeX has compat
        mode only);
      - lua/ subtrees and *.lua;
      - pgfplots/test/;
      - output-driver .def files in pgf's systemlayer / pgfplots' trees the
        shipped engine never selects (keep set = TIER_A_KEEP_DEFS)."""
    path = pathlib.Path(loc)
    try:
        rel = path.relative_to(TEXMF_DIST)
    except ValueError:
        return False
    parts = rel.parts
    if parts[:2] == ("tex", "plain"):
        return True
    if "graphdrawing" in parts or "lua" in parts:
        return True
    if path.suffix == ".lua":
        return True
    if "test" in parts and parts[:3] == ("tex", "generic", "pgfplots"):
        return True
    if path.suffix == ".def" and parts[-1] not in TIER_A_KEEP_DEFS:
        return (parts[:4] == ("tex", "generic", "pgf", "systemlayer")
                or parts[:3] == ("tex", "generic", "pgfplots"))
    return False


def run_bfs(resolver, pdftex_map, missing):
    """Static BFS over Tier B. Returns (reached name -> path, macro-computed
    names skipped, hard-excluded/fmt-preloaded edges, first-edge provenance
    when debugging)."""
    macro_skipped = set()
    excluded_edges = set()
    provenance = {}
    reached = OrderedDict()
    queue = deque(TIER_B_SEEDS)
    enqueued = set(TIER_B_SEEDS)
    while queue:
        name = queue.popleft()
        path = resolver.resolve(name)
        if not path:
            missing.append(name)
            continue
        reached[name] = path
        if pathlib.PurePosixPath(name).suffix in BINARY_SUFFIXES:
            continue
        try:
            text = pathlib.Path(path).read_text(encoding="utf-8",
                                                errors="replace")
        except OSError as exc:
            sys.exit(f"FATAL: cannot read {path}: {exc}")
        text = strip_comments(text)
        for candidates, soft in extract_edges(text, resolver, pdftex_map,
                                              macro_skipped):
            chosen = None
            excluded = False
            for cand in candidates:
                if cand in enqueued:
                    chosen = cand
                    break
                loc = resolver.resolve(cand)
                if not loc:
                    continue
                if cand in FMT_PRELOADED_FDS or hard_excluded_path(loc):
                    excluded = True   # resolvable, but ruled out (hard exclusion/fmt)
                    continue
                enqueued.add(cand)
                queue.append(cand)
                chosen = cand
                break
            if chosen is not None:
                provenance.setdefault(chosen, name)
            elif excluded:
                excluded_edges.add(f"{name} -> {' | '.join(candidates)}")
            elif soft:
                # no-brace \input form: tokenization can truncate macro
                # concatenations (documented static-BFS blind spot)
                macro_skipped.add(" | ".join(candidates))
            else:
                missing.append(" -> ".join(candidates))
    return reached, macro_skipped, excluded_edges, provenance


# --------------------------------------------------------------------------
# Gates + report
# --------------------------------------------------------------------------

def shape_gate(names):
    problems = []
    if len(names) > MAX_TOTAL:
        problems.append(f"total {len(names)} > {MAX_TOTAL}")
    for name in names:
        if "/" in name:
            problems.append(f"non-flat name in closure: {name}")
        stem = name.split(".", 1)[0].lower()
        if stem.startswith(FORBIDDEN_PREFIXES):
            problems.append(f"generic typesetting package in closure: {name}")
    return problems


def main():
    if not UNION_SUMMARY.is_file():
        sys.exit(f"FATAL: union summary not found: {UNION_SUMMARY}")
    summary = json.loads(UNION_SUMMARY.read_text())
    baseline = sorted(
        SUPPLEMENT | {n for fig in summary["perFig"].values() for n in fig})

    resolver = Resolver()
    pdftex_map = load_pdftex_map(resolver)

    # ---- Tier A ----
    tier_a_categories, tier_a_paths = enumerate_tier_a()
    missing = []

    # Every Tier A basename must resolve (materialize order) to exactly the
    # enumerated file, or a later by-name materialization would ship
    # different bytes than enumerated here.
    for name in sorted(tier_a_paths):
        loc = resolver.resolve(name)
        if not loc:
            missing.append(name)
        elif pathlib.Path(loc) != tier_a_paths[name]:
            sys.exit(f"DUPLICATE BASENAME: kpsewhich({name}) -> {loc} "
                     f"but Tier A enumerated {tier_a_paths[name]}")

    # ---- Tier B ----
    bfs_reached, macro_skipped, excluded_edges, provenance = run_bfs(
        resolver, pdftex_map, missing)

    # ---- closure ----
    tier_a_names = set(tier_a_paths)
    closure = sorted(set(baseline) | tier_a_names | set(bfs_reached))

    errors = []
    if missing:
        errors.append("unresolvable names: " + ", ".join(sorted(missing)))

    problems = shape_gate(closure)
    if problems:
        errors.extend(problems)

    base_set = set(baseline)
    new_names = [n for n in closure if n not in base_set]

    # ---- report ----
    print(f"baseline={len(baseline)} "
          f"(perFig union {len(base_set - SUPPLEMENT)} "
          f"+ SUPPLEMENT {len(SUPPLEMENT)})")
    tier_a_total = 0
    for label, names in tier_a_categories.items():
        new = sum(1 for n in names if n not in base_set)
        tier_a_total += len(names)
        print(f"tier_a.{label}={len(names)} (new {new})")
    print(f"tier_a.total={tier_a_total} "
          f"(new {sum(1 for n in tier_a_names if n not in base_set)})")
    bfs_new = sum(1 for n in bfs_reached if n not in base_set)
    print(f"tier_b.bfs_reached={len(bfs_reached)} (new {bfs_new})")
    print(f"kpsewhich_calls={resolver.calls}")
    if macro_skipped:
        print(f"tier_b.macro_form_skipped={len(macro_skipped)} (static BFS "
              f"blind spots, documented class):")
        for name in sorted(macro_skipped):
            print(f"  {name}")
    if excluded_edges:
        print(f"tier_b.d1_fmt_excluded={len(excluded_edges)} (plain-format "
              f"tree / fmt-preloaded .fd targets):")
        for edge in sorted(excluded_edges):
            print(f"  {edge}")
    print(f"closure.total={len(closure)} "
          f"(new vs 202 baseline: {len(new_names)})")
    print(f"closure.new_names ({len(new_names)}):")
    for name in new_names:
        print(f"  {name}")
    if DEBUG and provenance:
        print("tier_b.provenance (first edge per name):")
        for name in sorted(provenance):
            print(f"  {provenance[name]} -> {name}")

    if errors:
        print("GATE FAILURES:")
        for err in errors:
            print(f"  {err}")
        return 1

    CLOSURE_LIST.parent.mkdir(parents=True, exist_ok=True)
    CLOSURE_LIST.write_bytes(("\n".join(closure) + "\n").encode("ascii"))
    print(f"wrote {CLOSURE_LIST} ({len(closure)} names)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
