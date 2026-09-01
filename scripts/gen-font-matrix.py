#!/usr/bin/env python3
"""Generate the font-matrix corpus documents from the font whitelist.

Single source: closure/font-whitelist.txt drives closure staging AND these
documents, so the acceptance matrix cannot drift from what ships.

Activation strategy:
- EVERY whitelisted .tfm gets a raw TeX \\font primitive declaration
  (preamble) and a typeset row using it. Primitives bypass NFSS entirely:
  cmssq has no .fd in TL2025 and \\fontfamily would hard-error on it.
  File activation is the goal — each .pfb embeds at shipout via
  pdftex.map, and a .vf-backed .tfm (mathpazo zplm) pulls its virtual
  font and base faces the same way. The "at 10.5pt" is load-bearing: a
  font whose (name, size) exactly matches one already resident in the
  format (the stock cmr/cmmi/cmsy/cmex defaults) is REUSED without
  re-reading the .tfm — a non-default size forces a fresh font-table
  load so every whitelist .tfm is genuinely requested from the closure.
  (pdfTeX font_max is 5000 in TL defaults; the whitelist's 239 tfm rows
  sit far below it.)
- Math families (cmmi/cmsy/cmex/cmmib) ADDITIONALLY get an NFSS math
  sweep over the standard size commands: cascaded sub/superscripts hit
  script/scriptscript sizes (how a cmsy7 request slips past a trimmed
  corpus), \\sum hits the cmex extension font, \\boldmath hits cmmib.
  Raw \\fontsize does NOT reliably update math sizes — size commands do.
- SECOND document (font-matrix-palatino): mathpazo re-routes every math
  slot (letters/symbols/largesymbols -> OML/OMS/OMX zplm, virtual fonts
  exercised at shipout). The stock document cannot exercise that face
  while preserving the cm optical-size sweep, so Palatino math gets its
  own document with the kernel symbol face and bold math — the exact
  chain the spike probe missed (letters only). amssymb loads AFTER
  mathpazo so \\mathbb stays msbm: fplmbb's .fd is not in the closure
  (known limitation, see release notes).
- Full standalone documents (corpus form — see 17-tikz-cd.tex).

Run: python3 scripts/gen-font-matrix.py [output-dir]
"""
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT_WHITELIST = pathlib.Path(os.environ.get(
    "FONT_WHITELIST", str(ROOT / "closure" / "font-whitelist.txt")))
TEXMF_DIST = pathlib.Path(os.environ.get(
    "TEXMF_DIST", os.path.join(os.path.expanduser("~"),
                                "texlive/2025/texmf-dist")))
OUT_DIR = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else \
    ROOT / "tests" / "corpus"
PDFTEX_MAP = pathlib.Path(os.environ.get(
    "PDFTEX_MAP", os.path.join(os.path.expanduser("~"),
        "texlive/2025/texmf-var/fonts/map/pdftex/updmap/pdftex.map")))

SIZE_SWEEP = ["tiny", "scriptsize", "footnotesize", "small",
              "normalsize", "large", "Large"]
MATH_ROW = (r"$X_{a^{b}}^{c_{d}}\times Y_{Z}^{W}$ "
            r"$\sum_{i=1}^{n} a_{i}$ "
            r"{\boldmath $X_{a}^{b}$} "
            r"$\mathscr{X}^{a}$ $\mathfrak{Y}_{b}$ $\mathbb{Z}$ "
            r"$\mathrm{m}\,\mathbf{b}\,\mathit{i}\,\mathsf{s}\,"
            r"\mathtt{t}\,\mathcal{C}$")
# Kernel math-symbol face under mathpazo — The slots the spike probe
# skipped. \mathbb deliberately absent (would route to U/fplmbb, whose
# .fd is not in the closure); amssymb-after-mathpazo keeps \mathbb on
# msbm instead. Bold segment hits the zplmb* shapes.
PALATINO_ROW = (r"$X_{a^{b}}^{c_{d}}\times Y \le Z \in W \ge V \ne U$ "
                r"$\to \leftarrow \pm \mp \approx \equiv \sim$ "
                r"$\sum_{i=1}^{n} a_{i} \prod_{j} b_{j} \int_{0}^{1} dx$ "
                r"$\sqrt{x+1} \left(\frac{a}{b}\right) \bigcup S$ "
                r"$\forall \exists \infty \partial \wedge \vee \cup \cap$ "
                r"$\mathcal{C}^{D}$ "
                r"{\boldmath $X_{a}^{b} \times \le \in \sum$} "
                r"\textsc{Small Caps} \textsl{slant} \textbf{b} "
                r"\textit{i} \textbf{\textit{bi}}")
PREAMBLE_PKGS = ["amssymb", "mathrsfs", "eufrak"]
PALATINO_PKGS = ["mathpazo", "amssymb"]


def csname(index):
    """Letters-only control-sequence name (TeX words exclude digits):
    0 -> fma, 25 -> fmz, 26 -> fmaa, ..."""
    name = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        name = chr(ord("a") + rem) + name
    return "fm" + name

def map_pfb_refs():
    """Basenames referenced as <name.pfb by pdftex.map entries.

    A staged .pfb is activatable iff some map entry loads it (activation
    is always map-driven). The old same-basename-tfm assumption broke
    on urw<->adobe cross-tree naming — uplbi8a.pfb's metric tfm is
    pplbi8r.tfm, a different stem.
    """
    refs = set()
    for line in PDFTEX_MAP.read_text(encoding="utf-8",
                                     errors="replace").splitlines():
        if line.startswith("%") or not line.strip():
            continue
        for tok in line.split():
            if tok.startswith("<") and tok.endswith(".pfb"):
                refs.add(tok[1:])
    if not refs:
        sys.exit(f"pdftex.map unreadable or empty: {PDFTEX_MAP}")
    return refs


def collect():
    tfm_names, pfb_names, vf_names = set(), set(), set()
    for line in FONT_WHITELIST.read_text(encoding="utf-8").splitlines():
        rel = line.split("#", 1)[0].strip()
        if not rel:
            continue
        directory = TEXMF_DIST / rel
        if not directory.is_dir():
            sys.exit(f"font whitelist directory missing: {directory}")
        for suffix, sink in ((".pfb", pfb_names), (".tfm", tfm_names),
                             (".vf", vf_names)):
            for path in directory.glob("*" + suffix):
                sink.add(path.name)

    mapped = map_pfb_refs()
    orphan_pfb = sorted(n for n in pfb_names if n not in mapped)
    orphan_vf = sorted(n for n in vf_names
                       if n[:-3] + ".tfm" not in tfm_names)
    if orphan_pfb or orphan_vf:
        # a .pfb no map entry loads can never activate; a .vf whose .tfm
        # is not whitelisted can never be requested
        sys.exit(f"pfb/vf unreachable in whitelist (config bug): "
                 f"{orphan_pfb[:5] + orphan_vf[:5]}")
    return tfm_names


STOCK_PURPOSE = ("Font-matrix acceptance: every whitelist .tfm activated via a\n"
                 "% raw \\font primitive, plus an NFSS math sweep over size commands\n"
                 "% covering the cm math families AND the common math alphabets\n"
                 "% (rsfs \\mathscr, euler \\mathfrak, msbm \\mathbb); compile must be\n"
                 "% error-free.\n")
PALATINO_PURPOSE = ("mathpazo end-to-end: the kernel math-symbol face ships through\n"
                    "% the zplm virtual fonts (omszplm/omxzplm routing, bold included);\n"
                    "% the text segment drives the Palatino 7t-vf chain (small-caps /\n"
                    "% slanted / bold / italic / bold-italic) so the adobe+urw trees\n"
                    "% stay under permanent gate; compile must be error-free.\n")


def document(pkgs, decls, rows, purpose):
    return ("% AUTO-GENERATED by scripts/gen-font-matrix.py — DO NOT EDIT.\n"
            "% Regenerate: python3 scripts/gen-font-matrix.py\n"
            "% " + purpose
            + "\\documentclass{standalone}\n"
            + "".join("\\usepackage{%s}\n" % p for p in pkgs)
            + decls
            + "\\begin{document}\n"
            "\\begin{tabular}{@{}l@{}}\n"
            + "\n".join(rows) + "\n"
            "\\end{tabular}\n"
            "\\end{document}\n")


def main():
    tfm_names = collect()

    decls, rows = [], []
    for i, name in enumerate(sorted(tfm_names)):
        cs = csname(i)
        decls.append(r"\font\%s=%s at 10.5pt %% %s" % (cs, name[:-4], name))
        rows.append(r"{\%s Quick brown fox 0OIl} \\ %% %s" % (cs, name))
    for size in SIZE_SWEEP:
        rows.append(r"\%s %s \\" % (size, MATH_ROW))
    (OUT_DIR / "font-matrix.generated.tex").write_text(
        document(PREAMBLE_PKGS, "".join(d + "\n" for d in decls), rows,
                 STOCK_PURPOSE),
        encoding="utf-8")

    prows = [r"\%s %s \\" % (size, PALATINO_ROW) for size in SIZE_SWEEP]
    (OUT_DIR / "font-matrix-palatino.generated.tex").write_text(
        document(PALATINO_PKGS, "", prows, PALATINO_PURPOSE),
        encoding="utf-8")

    print(f"[font-matrix] {len(decls)} font rows + {len(SIZE_SWEEP)} "
          f"math sweep rows -> {OUT_DIR / 'font-matrix.generated.tex'}")
    print(f"[font-matrix] palatino face document "
          f"({len(SIZE_SWEEP)} rows) -> "
          f"{OUT_DIR / 'font-matrix-palatino.generated.tex'}")


if __name__ == "__main__":
    main()
