# TL2025 closure materialization drift record

Date: 2026-08-31 · Name list: `probe-2026-08-30/corpus/union-summary.json` perFig union,
195 names (vendored in-repo at `tests/spike-corpus/`) · Script:
`scripts/materialize-closure.py` (re-runnable)

## Summary

| Metric | Value |
|---|---|
| Name list | 195 (all flat names, no directory forms) |
| TL2025 resolution failures (MISSING) | **0** |
| basename fallback hits | **0** |
| Byte content vs the probe's TL2024 materialization | 135 identical / **60 drifted** |
| Staging tree file-count check | 195 == list ✓ |
| Raw size | 10,104,761 B (9.64 MiB); `texfiles.tar.gz` 1,796,461 B (`scripts/pack-closure.sh`, deterministic pack) |

**No feynhand-style name drift**: all 195 names resolve directly under TL2025
(kpathsea 6.4.1) via per-name `kpsewhich -progname=pdflatex` — none needed plain
mode or a basename fallback, so no filename disappeared from the tree between
TL2024 and TL2025. The feynhand precedent (pgf 3.1.11 dropping
`\ProcessPgfPackageOptions`) is a **content-level** API removal, not triggered by
this closure: the 13/13 gate pass (`docs/corpus-gate.md`) proves the
drifted file set remains self-consistent engine-side.

## Version anchors (the main drift driver)

| Package | TL2024 (probe) | TL2025 (this repo's materialization) |
|---|---|---|
| pgf/tikz | 3.1.10 (2023-01-15) | **3.1.11a (2025-08-29)** |
| pgfplots | 1.18.1 | **1.18.2** |

(Source: the in-closure `pgf.revision.tex` and `pgfplots.revision.tex` files,
quoted verbatim.)

## Classification of the 60 byte-drifted files

- **pgf/pgfplots/tikz family, 36 files** (pgfplots 20 of them): ordinary
  version-bump content drift. The one structural rewrite:
  `pgfplotsbinary.data.code.tex` **26,859 → 616 B** — 1.18.2 replaces a
  256-entry verbatim binary table with `\loop` generation (the file head is
  `\count0=0 … \loop\ifnum\counter<256`); no content is missing.
- **LaTeX kernel / base packages, 24 files**: `article.cls`,
  `graphics`/`graphicx`/`keyval`, the `amsmath` family, `l3backend-pdftex.def`,
  `pdftex.def`, `standalone.cls` (29,032 → 31,554 B) and similar version bumps.
- **`pdftex.map` 5,531,417 → 5,541,383 B** (+9,966 B): the TL2025
  updmap-regenerated font map — slightly more entries, functionally equivalent.

The full 43-name size-level-diff list (plus 17 same-size different-content
names, 60 in total) is printed by `materialize-closure.py` at run time; the
135/60/43/17 split is reproducible with one command over the committed tooling
(per-name byte comparison against the spike probe's TL2024 materialization
tree — an external baseline not carried in this repo; re-verified 2026-08-31):

```
python3 scripts/materialize-closure.py --compare <probe-tl2024-closure-staging>
```

Output: `byte_compare: identical=135 size_level_diff=43
same_size_diff_content=17 total_drift=60 (135+43+17=195)`.

## Gate-side observation: probe requests outside the closure (not drift, not missing)

Names the worker requested during the 13-figure gate that sit outside the
closure (excluded by design) do not exist in TL2025 itself (`kpsewhich` rc=1):
`main.aux`, `epstopdf.cfg`, `.vf` probes such as `cmr10.vf`/`cmmi10.vf`,
`tikzlibraryarrows.meta.code.tex`, `tikzlibrarypgfplots.surfshading.code.tex`.
This matches the probe's (TL2024) request set — engine probe behavior is
unchanged across versions, so trimming the closure to "files actually
servable" is the right criterion (standing precedent: a miss is not a failure;
the criterion is a produced PDF).

---

## 2026-09-01 · S1 maximal closure materialization (601 names, closure-list.txt) vs the plan estimate

Name-source switch: `materialize-closure.py` no longer reads the probe's
union-summary.json (perFig union 195 + SUPPLEMENT = the 202 baseline) but
`closure/closure-list.txt` (the derivation snapshot, 601 flat names). The
kpsewhich resolution order, the MISSING hard error, the staging pre-clean and
the tree-count check discipline are unchanged; the `--compare <tree>` mode is
unchanged (it compares materialized trees, not name sources). This section's
comparison axis is the **plan's S1 estimate** (the previous section's was the
TL2024 union).

### Materialization and size check

| Metric | Value | Plan estimate | Verdict |
|---|---|---|---|
| List / materialized | 601 / 601 | ~572 (+29, composition below) | ✓ (the list is authoritative; not an anomaly) |
| MISSING | **0** | 0 | ✓ |
| basename fallback | **0** | 0 | ✓ |
| staging tree files | 601 == list | — | ✓ |
| staging raw size | 19,062,537 B (18.18 MiB) | — | recorded |
| `texfiles.tar.gz` | 3,776,820 B (3.60 MiB) | ~3.1 MiB ±5% (2.95–3.26 MiB) | **+16.2%, outside the ±5% band** (below) |
| four-asset total | 30,235,641 B (28.83 MiB) | ~28.4 MiB; warn 30 / red line 35 MiB | +1.5%; 1,221,639 B (1.17 MiB) below the warning line ✓ |

The tar figure is a single measured `scripts/pack-closure.sh` run: `pack ok:
files=601 bytes=3776820 sha256=7418a85e…` (the same-source double-run
determinism check is recorded in `docs/determinism.md`).

### 601 vs ~572 (+29) composition (verified at derivation time, recorded here)

- PSTricks option-gated over-coverage, 20 names (ruling: kept — option-gated /
  `\ifluatex` edges are wanted, over-coverage is harmless, add-only
  discipline);
- the siunitx v3 chain (translations, textcomp, xspace, etoolbox, …);
- TL2025 package restructures (cmmib57 reduced to a .sty stub, circuitikz
  1.7.x without ctikzstyle*, tkz-euclide at 50 files, …).

### Why the tar.gz exceeds the band (+16.2%, recorded as-is)

~3.1 MiB was an extrapolated estimate on TL2024 terms. Actual compression
ratios: 195 names (section above) 10,104,761 B → 1,796,461 B (17.8%); the S1
601 names 19,062,537 B → 3,776,820 B (19.8%). Among the 399 new names, the
PSTricks/pgf corpus (.tex files: 344 files, 10,285,742 B, 54% of staging) and
the font binaries (45 .pfb + 49 .tfm + 5 .vf, 1,193,534 B) compress worse
than the old mix, shifting the overall ratio +2.0pp; the tar is +108% vs the
202-name baseline (1,811,520 B), staging +89% vs the 195-name tree. At the
four-asset level it is only +0.43 MiB (+1.5%), absorbed by the ~28.4 MiB
estimate's headroom; the warning line is untouched.

### Four-asset byte table (2026-09-01)

| Asset | Bytes | MiB |
|---|---|---|
| build/swiftlatexpdftex.worker.js | 3,157,498 | 3.01 |
| build/swiftlatexpdftex.fmt | 17,670,154 | 16.85 |
| build/out/pdftocairo.stripped.js | 5,631,169 | 5.37 |
| build/texfiles.tar.gz | 3,776,820 | 3.60 |
| **Total** | **30,235,641** | **28.83** |

(fmt / worker / pdftocairo are pre-existing build artifacts, not rebuilt for
this measurement; the full-coverage gate and the release re-verification are
recorded in `docs/corpus-gate.md` and `docs/determinism.md`.)

*(Sizes are the dated measurements of this round. Both pdftocairo
5,631,169 B and — after the 619-file re-pack — the totals were superseded
on 2026-09-01 by the checkout-path-independence fix (5,630,761 B) and the
pdftex.map header sanitization (tarball 3,792,350 B, four-asset total
30,250,763 B); current authoritative values live in docs/determinism.md.)*

### Supplement notes (2026-09-01, SUPPLEMENT 601 → 619)

The corpus expansion (14 new figures) empirically surfaced five further
static-BFS blind-spot classes, and 18 names entered through the SUPPLEMENT
exception path (per-class comments live in `derive-closure.py`): the tikzlings
core package loads animal packages on demand through a
`\RequirePackage{tikzlings-#1}` loop (only the flagship penguin
`tikzlings-penguins.sty` was supplemented); the LaTeX kernel
file-substitution table redirects `\usepackage{atveryend}` to
`atveryend-ltx.sty` (a name with no source-file spelling); pgfplots dateplot's
`\pgfutil@usemodule{pgfcalendar}` expands through the pgfutil-latex.def alias
into a `\usepackage`; the tkz-base module loader loops `\input
tkz-<kind>-\tkz@temp.tex` (13 module files); and tkz-euclide/tkz-base's
`\InputIfFileExists` local cfg is load-bearing (it defines `\tkz@grid@color`;
without it, "Undefined control sequence"). Re-derivation double-run sha256
identical (`0b2ee353…`), materialization 619/619, MISSING 0,
`texfiles.tar.gz` 3,792,364 B (3.62 MiB), four-asset total 30,251,185 B
(28.85 MiB, 1.15 MiB below the warning line).

(The tarball and total figures above are superseded by the same-day
pdftex.map header sanitization: 3,792,350 B, total 30,250,763 B — see
docs/determinism.md.)
