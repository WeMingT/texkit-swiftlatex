# Third-Party Notices

License and obligation inventory for the third-party components used by this
build chain. Upstream pins were fixed during the build-line bring-up
(2026-08-30/31); the per-family license audit of the 619-file closure was
completed 2026-09-01 — the non-LPPL exceptions are listed in the dedicated
section below (all kept in the closure by owner ruling, 2026-09-01).
Every commit referenced below is the exact source pin this repository actually
built from (`toolchain.lock.json` + per-tree verification under `src/`).

## Distribution composition (the four release assets)

| Asset | Content | Components involved |
| --- | --- | --- |
| `swiftlatexpdftex.worker.js` | pdfTeX engine worker (wasm-embedded single file) | SwiftLaTeX, pdfTeX / TeX Live engine sources, emsdk ports (zlib/libpng), emscripten |
| `swiftlatexpdftex.fmt` | LaTeX format dump | TeX Live file layer (LaTeX2e kernel etc.) |
| `pdftocairo.js` | poppler pdftocairo (wasm-embedded single file) | poppler, cairo, fontconfig, freetype, pixman, expat, emsdk ports (zlib/libpng/libjpeg), emscripten |
| `texfiles.tar.gz` | 619-file TeX closure pack (the S1 maximal closure; extension of the 202-file baseline) | TeX Live file layer |

## Licenses and obligations, item by item

| Component | Version / commit | License | Source repo + commit | Obligations & how they are met |
| --- | --- | --- | --- | --- |
| poppler | 24.03.0 / 481ee33 | GPL-2.0-or-later (the "or later" option is taken → **GPL-3.0 branch**) | https://gitlab.freedesktop.org/poppler/poppler — 481ee336d15bdf6b2b6084dddcd1617b032d2cd5 | Combined with the plugin's AGPL-3.0 via the **GPLv3 §7 / §13 compatibility path** (GPL-3.0 and AGPL-3.0 are the same license family; the §13 network clause applies). Source-offer obligation: satisfied by this build repository being public (pins + all build scripts and flags = Corresponding Source); copyright and license notices retained in the source tree. |
| cairo | 1.17.8 / c3b6726 | LGPL-2.1 **or** MPL-1.1 (dual license, either may be chosen) | https://gitlab.freedesktop.org/cairo/cairo — c3b67263 | Statically linked into the wasm distribution; fulfilled along the **LGPL-2.1** route: the corresponding source pin and build scripts are provided via this repository (reproducible link); copyright/license notices retained. |
| fontconfig | 2.15.0 / 72b9a48 | MIT | https://gitlab.freedesktop.org/fontconfig/fontconfig — 72b9a48 (source snapshot, no .git) | MIT: copyright and license notices retained (in the source tree); static linking carries no copyleft obligation. |
| freetype | 2.13 / de8b92d | FTL (FreeType License) or GPL-2.0+; this project takes the **FTL/MIT** route | https://gitlab.freedesktop.org/freetype/freetype — de8b92dd | FTL: copyright and disclaimer notices retained (docs/FTL.TXT in the source tree); BSD-style, no copyleft obligation. |
| pixman | 0.42.2 / 37216a3 | MIT | https://gitlab.freedesktop.org/pixman/pixman — 37216a3 | MIT: copyright and license notices retained; no copyleft obligation. |
| expat | 2.2.6 (fontconfig meson subproject) | MIT | https://github.com/libexpat/libexpat — R_2_2_6 (meson wrap, hash-pinned) | MIT: copyright and license notices retained; no copyleft obligation. |
| zlib | 1.3.2 (emsdk port) | zlib License | https://github.com/madler/zlib — v1.3.2 (emsdk 6.0.8 ports/zlib.py, sha512-pinned) | zlib License: notices retained; no copyleft obligation. |
| libpng | 1.6.58 (emsdk port) | libpng License (zlib family) | emsdk 6.0.8 ports/libpng.py (TAG 1.6.58, sha512-pinned) | libpng copyright and license notices retained; no copyleft obligation. |
| libjpeg | 9f (emsdk port) | IJG (Independent JPEG Group) free-software license / TurboJPEG-family BSD | emsdk 6.0.8 ports/libjpeg.py (VERSION 9f, sha512-pinned) | IJG license: notices retained; no copyleft obligation. |
| SwiftLaTeX | 87dfb95 (2024-06-18) | AGPL-3.0 | https://github.com/SwiftLaTeX/SwiftLaTeX — 87dfb950eb9c8e9dcd4ee2a3ac97fbbbacfc618a | AGPL §13 network-interaction source-offer obligation: **satisfied by this build repository being public** (pin + the local patch `patches/0001-pdftex-harness-kpse-protocol.patch` fully public); modifications are made explicit as a patch. |
| TeX Live file layer | 619 files (the S1 maximal closure: 202-file baseline ∪ the closure derived via `closure/closure-list.txt`) | **LPPL majority** (per individual file headers) + **10 non-LPPL exception families** (dedicated table in the next section) | Materialized from a local TeX Live 2025 full installation (default `~/texlive/2025`; see `scripts/materialize-closure.py`) — **provenance anchor below**; upstream https://tug.org/texlive/ , source mirror https://github.com/TeX-Live/texlive-source | The tarball is a **mere aggregation of unmodified original files**: LPPL files keep their in-file notices (modification would require renaming — this project does not modify them; they are packed verbatim); the non-LPPL exception families are handled per family in the next section (in-file notices retained + attribution recorded in this file); permissive-license items are recorded in the same section. |
| emsdk / emscripten | 6.0.8 | emscripten: MIT (or University of Illinois/NCSA, dual); LLVM/Clang and binary tools: Apache-2.0 **with LLVM exceptions**; Binaryen: Apache-2.0 | https://github.com/emscripten-core/emsdk — 6.0.8 (pinned in `toolchain.lock.json`; wasm-opt version_132) | **Build tooling, not part of the distribution**: only MIT/Apache attribution and notice-retention duties, no copyleft; the wasm artifacts are not license-constrained derivatives of it (the LLVM exception explicitly exempts outputs). |

## TeX Live file layer: non-LPPL exceptions (2026-09-01 audit; all kept by owner ruling)

Of the 619 files, 10 families carry non-LPPL copyleft / CC licenses and ship
**verbatim (unmodified)** inside the mere-aggregation tarball: their in-file
license and copyright notices are retained as-is, and the tables in this
section are the attribution record. The three-source verification behind the
ruling (CTAN catalogue Licenses field, TL `tlpkg/texlive.tlpdb`
catalogue-license, per-file header scan) is reproducible via
`scripts/audit-licenses.py` (the full 81-family table).

| Family (TL package) | License | Files (baseline / new) | Obligations & how they are met |
| --- | --- | --- | --- |
| pgfplots | **GPL-3.0-or-later** (50 core files carry full GPL-3+ headers; the 18 `pgfplotsoldpgfsupp_*` backport copies are pgf-dual-licensed; the rest are data/version files) | 78 (33/45) | verbatim distribution; in-file headers retained; attribution recorded in this table; GPL text https://www.gnu.org/licenses/gpl-3.0 |
| preview (AUCTeX preview-latex) | **GPL-3.0** (FSF) | 1 (preview.sty; baseline) | verbatim distribution; AUCTeX provenance recorded here; GPL text https://www.gnu.org/licenses/gpl-3.0 |
| mathpazo (Pazo Math fonts) | **GPL-2.0 (+ font-embedding exception)** | 9 (fplm\* fonts 3, zplm\* virtual fonts/metrics 6; baseline) | verbatim distribution; package README/GPL terms provenance recorded here (TL `doc/latex/mathpazo/`); the embedding exception covers PDF embedding; GPL text https://www.gnu.org/licenses/old-licenses/gpl-2.0 |
| palatino (URW base35) | **GPL** | 12 (upl\*.pfb URW Palladio 3, ppl\*.tfm/.vf 9; baseline) | verbatim distribution; the URW copyright strings inside the .pfb files retained as-is; attribution recorded in this table (CTAN https://ctan.org/pkg/urw-base35) |
| mptopdf (ConTeXt mkii) | **GPL** (PRAGMA ADE / Hans Hagen) | 1 (supp-pdf.mkii; baseline) | verbatim distribution; the in-file PRAGMA copyright notice retained |
| jknapltx (mathrsfs) | **GPL-2.0** | 2 (mathrsfs.sty, ursfs.fd; new) | the "Licence: GNU licence version 2" file header retained; attribution recorded in this table |
| pgf profiler library | **GPL-3.0-or-later** | 1 (pgflibraryprofiler.code.tex; new; the remaining 193 pgf files are LPPL-1.3c/GPL-2.0 dual-licensed, LPPL taken) | file header retained; attribution recorded in this table |
| pgf-umlsd | **GPL** (CTAN catalogue; no in-file statement) | 1 (pgf-umlsd.sty; new) | no in-file statement; attribution is recorded in this table (CTAN https://ctan.org/pkg/pgf-umlsd, author Xu Yuan) |
| tikz-feynhand | **GPL-3.0-or-later** | 3 (sty + 2 library files; new) | file headers retained; attribution recorded in this table |
| quantikz | **CC-BY-4.0** | 3 (quantikz.sty + tikzlibraryquantikz{,2}; new) | attribution (author Alastair Kay) fulfilled by this table; license https://creativecommons.org/licenses/by/4.0 |

Permissive non-LPPL items (notice/attribution-retention only; recorded here
per the rsfs-fonts precedent — no further action required):

| Item | License | Files | Obligation |
| --- | --- | --- | --- |
| amsfonts fonts (msam/msbm/Euler/cm-style pfb and metrics) | SIL **OFL** (the macro files .sty/.fd remain LPPL-1.3c) | 81 (38 pfb with embedded OFL notice; 61 new) | fonts distributed verbatim; recorded in this table; license https://openfontlicense.org |
| cm metrics | **Knuth license** | 3 (cm\*.tfm; baseline) | recorded in this table (CTAN https://ctan.org/pkg/cm) |
| rsfs fonts | permissive (Ralph Smith 1991: free use and distribution; modifications require renaming and crediting the original author) | 6 (rsfs5/7/10 tfm+pfb; new) | recorded here with credit to Ralph Smith |
| dvips | other-free (TL catalogue classification) | 1 (8r.enc; baseline) | recorded in this table |
| graphics-cfg | **CC0 / public domain** | 2 (color.cfg, graphics.cfg; baseline) | none |
| hyph-utf8 | **MIT** | 1 (etex.src; new) | recorded in this table |
| latexconfig | public domain (per file header) | 1 (epstopdf-sys.cfg; baseline) | none |
| ColorBrewer color schemes (inside pgfplots) | **Apache-2.0**-style (Cynthia Brewer / Penn State) | 2 (tikzlibrary/pgflibrary colorbrewer; new) | in-file notice retained; recorded in this table (the Paul Tol schemes tikzlibrarycolortol etc. are free-use data, recorded with the pgfplots family) |
| pdftex.map | TeX Live updmap-generated (an aggregate of per-font-package map fragments; not a package file) | 1 | recorded with the TL layer |

## TeX Live provenance anchor (known gap, recorded as-is)

The file layer of `texfiles.tar.gz` and `swiftlatexpdftex.fmt` comes from a
**local TeX Live 2025 full installation** (default `~/texlive/2025`;
per-name `kpsewhich` resolution, see `scripts/materialize-closure.py`). It has
**not been hash-compared file by file against the official texlive.info
archive**. The local installation's package-manager metadata (`tlpkg/`)
attests that it came from the official tlnet repository, but a per-file
integrity anchor (sha256 comparison against the CTAN/tlnet archives) was not
established — this is a known gap, recorded as-is and not remediated here. If
a strong anchor is needed later, the 619 names in `closure/closure-list.txt`
can be verified package by package against tlnet `tlpkg/archive`.

## Combined-license conclusion

The distribution presents overall as: **a combination of GPL-3.0 (poppler,
the or-later option in effect) and AGPL-3.0 (SwiftLaTeX, plugin side)**, with
the GPLv3 §13 network-interaction clause applying — the corresponding source
is offered publicly through this repository (build scripts + pins + patches)
and the upstream pins. `texfiles.tar.gz` is a **mere aggregation of
unmodified TeX original files**: the majority are LPPL (notice retention
fulfills them); the 10 non-LPPL families (GPL family / CC-BY-4.0, dedicated
table) are fulfilled through verbatim distribution + in-file notice retention
+ the attribution record in this file, and do not form a derivative
combination with the engine wasm; the permissive items
(OFL/Knuth/other-free/CC0/MIT/Apache) carry notice-retention duties only.
The remaining components (MIT/LGPL-2.1/FTL/zlib/IJG) are permissive or
file-level licenses, fulfilled by notice retention via the public source
tree/repository, with no further copyleft effect.
