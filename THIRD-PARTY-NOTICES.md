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
| `swiftlatexpdftex.fmt` | Precompiled LaTeX format including pgfplots | LaTeX2e kernel, PGF/TikZ, pgfplots and their format inputs (see below) |
| `pdftocairo.js` | poppler pdftocairo (wasm-embedded single file) | poppler, cairo, fontconfig, freetype, pixman, expat, emsdk ports (zlib/libpng/libjpeg), emscripten |
| `texfiles.tar.gz` | 1,416-member TeX closure with a generated, trimmed pdftex.map | TeX Live file layer |

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
| TeX Live file layer | 1,416 members (the 765-name closure union the 788-file font whitelist) | **LPPL majority** (per individual file headers) + **10 non-LPPL exception families from the 2026-09-01 audit** (dedicated table in the next section) + **endfloat (GPL-2.0-or-later) and algorithms (LGPL-2.1-or-later)** (see "Additional package and font coverage") | Materialized from the digest-pinned frozen TeX Live 2025 image in `toolchain.lock.json` (see `scripts/materialize-closure.py`) — **provenance anchor below**; upstream https://tug.org/texlive/ , source mirror https://github.com/TeX-Live/texlive-source | The tarball aggregates original package and font files with one generated map: LPPL package files retain their in-file notices and are packed verbatim; `pdftex.map` is trimmed during packing as described below; the 10 audited non-LPPL exception families are handled per family in the next section (in-file notices retained + attribution recorded in this file); endfloat and algorithms are documented in "Additional package and font coverage"; permissive-license items are recorded in the next section. |
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
| pdftex.map | TeX Live updmap-generated (an aggregate of per-font-package map fragments; not a package file) | 1 | generated output trimmed to closure TFM names by `scripts/trim-font-map.py`; covered by the contributing font-package notices |

## Additional package and font coverage

The inventory includes all 1,416 archive members, including the selected
font directories, rather than only the macro-layer name list. The additions
below total 444 files. Existing families retain their previously recorded
terms; every added runtime file is copied unchanged from its frozen package.

| Package | Added files | Applicable terms and source |
|---|---:|---|
| algorithm2e | 1 | LPPL-1.3-or-later; Christophe Fiorio; algorithm2e.sty and documentation sources |
| algorithmicx | 3 | LPPL, as granted by Szasz Janos in algorithmicx.tex; algorithmicx.sty, algpseudocode.sty and algcompatible.sty retain their author notices |
| algorithms | 1 | LGPL-2.1-or-later selected from the header's version-2-or-later grant; Peter Williams and Rogerio Brito; algorithms.dtx and algorithms.ins |
| booktabs | 1 | LPPL-1.3c-or-later; booktabs.dtx and booktabs.ins |
| braket | 1 | Public domain, Donald Arseneau; braket.sty and braket.tex |
| chemgreek | 1 | LPPL-1.3-or-later; Clemens Niederberger; chemgreek source and documentation |
| circuitikz | 3 | LPPL selected from LPPL/GPL package terms; Romano Giannetti and the named contributors; unchanged style files and package notices |
| elocalloc | 1 | LPPL; David Carlisle; elocalloc.dtx and elocalloc.ins |
| endfloat | 1 | GPL-2.0-or-later; Darrel McCauley, Jeffrey Goldberg and Axel Sommerfeldt; endfloat.dtx, endfloat.ins, README and COPYING |
| float | 1 | LPPL; Anselm Lingnau; float.dtx and float.ins accompany the generated float.sty |
| forest | 4 | LPPL-1.3-or-later; Saso Zivanovic; forest.dtx, forest-libs.dtx and installation sources |
| ifoddpage | 1 | LPPL-1.3-or-later; Martin Scharrer; ifoddpage.dtx and installation sources |
| inlinedef | 1 | LPPL-1.3-or-later; Stephen D. Hicks; inlinedef.dtx and inlinedef.ins |
| l3packages | 1 | LPPL-1.3c-or-later; LaTeX Project; xparse documented sources |
| latex | 14 | LPPL-1.3c-or-later; LaTeX Project; complete LaTeX base sources and manifests |
| lm | 360 | GUST Font License 1.0; Boguslaw Jackowski and Janusz M. Nowacki; font programs, metrics, encodings and LaTeX support files, detailed below |
| makecell | 1 | LPPL; Olga Lapko; makecell.dtx accompanies the generated file |
| mhchem | 1 | LPPL-1.3c; Martin Hensel; mhchem source and bundled license |
| multirow | 3 | LPPL-1.3-or-later; Oystein Bache, Pieter van Oostrum and named contributors; multirow.dtx and multirow.ins include bigstrut and bigdelim |
| pgf-blur | 1 | LPPL for the shipped library; Martin Giese and Norbert Preining; documented sources and installation file |
| psnfss | 10 | LPPL; the complete PSNFSS source bundle and manifest accompany the generated font definitions |
| relsize | 1 | Public domain, with Unlicense fallback; Matt Swift and Donald Arseneau; original source notice retained |
| tikzlings | 27 | LPPL-1.3c-or-later; samcarter; animal package source files and notices |
| tocbibind | 1 | LPPL-1.3c-or-later; Peter Wilson, maintained by Will Robertson; tocbibind.dtx and installation sources |
| tools | 4 | LPPL-1.3c-or-later; LaTeX Project; complete Tools Bundle, including bm, tabularx, dcolumn and hhline documented sources |

The same release provides `tex-sources.tar.gz` with 123 complete original
runtime package archives, 36 documented-source archives declared by the frozen
package database, four documentation archives and all 354 stock format inputs.
The included official containers
retain their original bytes and are listed by package, revision, byte count,
SHA-256 and frozen SHA-512 in `tex-sources-manifest.json`. The source selection
is declared in `closure/tex-source-policy.json`; all 444 added runtime files
were compared with the frozen image and matched exactly. Separate documentation
containers are included for algorithms, endfloat, Latin Modern and mhchem
because they carry the accompanying license terms, license clarification or
work manifest. Other documentation containers are omitted: the unchanged
package sources and declared documented sources are provided in the runtime
and source containers. Recipients must retain the individual notices and
provide the accompanying source information when redistributing these files.
The historical archive directory remains the original provenance reference;
source availability does not depend on that directory remaining online.

The `endfloat.sty` header's old phrase "GNU-style conditions" does not
specify a license version. The package README records Jeffrey Goldberg's
March 2006 clarification: GPL version 2 or later. The same-revision README,
GPL-2.0 COPYING text, endfloat.dtx and endfloat.ins provide the grant and
corresponding source; the generated file is unmodified. GPL-2.0 text is at
https://www.gnu.org/licenses/old-licenses/gpl-2.0.html . The algorithms
package's source and notices are similarly included under LGPL-2.1-or-later;
the selected license text is at https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html .
Both are separate package components in the aggregation.

### Latin Modern Type 1 subset

The original GUST-FONT-LICENSE.TXT is version 1.0, dated 22 June 2009.
It grants LPPL-1.3c-or-later and requests, **without legally requiring**,
new font and file names for derived works. The accompanying Latin Modern
README credits Boguslaw Jackowski and Janusz M. Nowacki, on behalf of TeX
Users Groups. Original copyright, version strings and font names are retained.

The copied font subset contains 236 metrics, 92 Type 1 outlines and eight
encoding files, with every optical size for OT1, T1, TS1 and math; 24
unchanged LaTeX support files complete the 360-file package contribution.
No font outline, metric, encoding or support file is edited. This is a
selected compiled distribution of the complete original font package,
identified as a subset rather than the complete Latin Modern distribution.
The supplied files install and behave as their original counterparts;
the omissions and build selection are disclosed in closure/font-whitelist.txt.
The license's renaming request concerns derived font modifications and does
not impose mandatory renaming here. No support from the original authors
is implied for this selection or the engine's font policy.

The complete work, its manifest, GUST license and font sources are available
from https://www.gust.org.pl/projects/e-foundry/latin-modern/ and the fixed
TeX Live package archives described above. The release source archive contains
the original license, README and manifest in `archives/lm.doc.tar.xz`, with the
complete original font package in `archives/lm.tar.xz`. These notices, the
unchanged files and access to the complete work satisfy the applicable
compiled-distribution and source conditions; selection does not relicense
the fonts. The format's separate font redirect is this repository's own
AGPL-3.0 source, not an edit to Latin Modern font files.

## Precompiled format and Corresponding Source

`swiftlatexpdftex.fmt` is a precompiled asset, separate from the aggregation
of source files in `texfiles.tar.gz`. It is generated from 354 TeX Live 2025
inputs. These
include the LaTeX2e kernel and its base font and configuration files,
l3kernel, firstaid, babel, graphics and xcolor, PGF/TikZ and pgfplots,
language loaders and hyphenation patterns, pdfTeX configuration and glyph
mappings, Computer Modern font metrics, and Unicode data.
`closure/fmt-preload.txt` preloads TikZ and pgfplots without package options,
plus the positioning, shapes.geometric and calc TikZ libraries.
Before those preloads, closure/fmt-font-redirect.tex is inlined immediately
after the kernel to redirect T1 and TS1 text. It is this repository's own
source and is distributed with the complete generation recipe. The metadata
records its path, 2,822 bytes and SHA-256
`64fdb75ada7ae5590ac0dadf8506222f33a5a98e4ade782231772b3d847ba743`
in the `inlined` field; it is not a served TeX Live member. The format
metadata preserves the complete `filesServedList` of 354 inputs. Immediately
after pgfplots, `closure/fmt-pgfplots-hint.tex` disables the suggested compat
version hint by default. Documents can enable it explicitly with
`\pgfplotsset{compat/show suggested version=true}`. This second inlined file
is also provided with the generation recipe and recorded in `inlined`.

Each component retains its own license. The LaTeX kernel and other LPPL
and permissively licensed inputs are the standard TeX macro environment
on which the GPL-licensed macro packages depend. Precompilation does not
relicense any component or remove its copyright, license or source
obligations. This distribution uses LPPL-1.3c for PGF/TikZ and the
PGF-licensed support files `pgfplotslibrary.code.tex` and
`pgfplotsoldpgfsupp_pgfutil-common-lists.tex`. It uses GPL-3.0-or-later for
pgfplots, as granted by the pgfplots sources, including its precompiled
form. The GPL version 3 terms are at
https://www.gnu.org/licenses/gpl-3.0.html .

For hyphenation inputs with a non-GPL license available in the file header,
the distribution uses the following terms. The selections also record
file-level grants that differ from package-level catalogue labels.

| Input | Selected license |
|---|---|
| `hyph-da.tex` | MIT |
| `hyph-nl.tex` | MIT |
| `hyph-et.tex` | MIT |
| `hyph-fi-x-school.tex` | MIT |
| `hyph-fur.tex` | MIT |
| `hyph-hu.tex` | MPL-1.1 |
| `hyph-ga.tex` | MIT |
| `hyph-it.tex` | MIT |
| `hyph-la-x-classic.ec.tex` | MIT |
| `hyph-la.tex` | MIT |
| `hyph-lv.tex` | LGPL-2.1 |
| `hyph-mn-cyrl.tex` | MIT |
| `hyph-oc.tex` | MIT |
| `hyph-pms.tex` | MIT |
| `hyph-pl.tex` | MIT |
| `hyph-rm.tex` | MIT |
| `hyph-sh-latn.tex` | LPPL-1.0-or-later |
| `hyph-sh-cyrl.tex` | LPPL-1.0-or-later |
| `hyph-sl.tex` | MIT |
| `hyph-tr.tex` | LPPL-1.0-or-later |
| `hyph-cy.tex` | MIT |

The Hungarian patterns explicitly offer MPL-1.1, GPL-2.0 and LGPL-2.1;
MPL-1.1 is selected. The Latvian patterns explicitly offer LGPL-2.1 or
GPL-2.0-or-later; LGPL-2.1 is selected, and its obligations remain
applicable. The current Italian header offers LPPL-1.3-or-later or MIT;
MIT is selected, while its LGPL reference occurs in the change history.
The Serbo-Croatian headers grant LPPL version 1 or later even though the
frozen package catalogue labels the package GPL; the file-level LPPL grant
is used. The Finnish school patterns have an MIT header despite a
public-domain package label. These selections retain the original notices
and do not treat catalogue labels as substitutes for the file headers.

The loader wrappers `loadhyph-hu.tex`, `loadhyph-it.tex`,
`loadhyph-sr-latn.tex` and `loadhyph-sr-cyrl.tex` carry the per-file grant:
"You may freely use, modify and/or distribute this file." This grant is
used for these wrappers; their package catalogue labels are respectively
GPL, LGPL, GPL and GPL. The pattern files they load retain the separate
terms selected above.

The following inputs have no non-GPL option identified in their file
headers and frozen package metadata:

| Input | Applicable recorded terms |
|---|---|
| `hyph-cs.tex` | GPL-2.0-or-later; the header specifies version 2 and allows later versions |
| `hyph-sk.tex` | GPL-2.0-or-later; the header specifies version 2 and allows later versions |
| `hyph-id.tex` | GPL-2.0-only; the header specifies version 2 without an or-later grant |
| `glyphtounicode.tex` | GPL, as recorded by the frozen pdftex package catalogue; the label does not specify a version and the file header contains no license grant |

`glyphtounicode.tex` identifies lcdf-typetools version 2.95 and the three
glyph-list inputs from which it was generated. An unversioned catalogue
label is not represented here as a verified version-specific grant. All
original notices and the package metadata are retained with the source.

Corresponding Source is provided by the same release and this repository:

1. `tex-sources.tar.gz` contains all 354 stock format inputs, including
   `language.dat`, at their paths relative to the frozen TeX Live installation.
   It also contains the 18 documented-source archives in the provenance table
   and complete package and source containers for the other TeX components
   identified in this inventory. Original containers are preserved verbatim.
2. `tex-sources-manifest.json` inside that archive records every payload path,
   byte count and SHA-256. Official containers also record the package name,
   revision and frozen package-database SHA-512. The 44 docstrip inputs are
   checked against these containers: 156 source references, 128 distinct
   members, none missing.
3. This public repository provides the complete build recipe and disclosed
   transformations listed below. The official TeX Live historical archives
   remain the original source of the containers; their revisions, sizes and
   SHA-512 checksums are preserved as provenance rather than as an external
   dependency for obtaining Corresponding Source.

For the remaining inputs, their TeX Live packages are identified by
package name and revision, with the runtime archive size and SHA-512 in
`containersize` and `containerchecksum`; documented-source archives use
`sourcecontainersize` and `sourcecontainerchecksum`. The installation's
`language.dat` is a configuration file generated by the installer from
the language template and package `AddHyphen` metadata, rather than a
single package runfile. Its template header declares public domain. All
64 package sections were checked against the frozen `AddHyphen` entries.

The release source archive provides the verified copies directly. Its
independent release identity is recorded in `release/tex-sources.json`.
Recipients can obtain and verify the complete source distribution without
waiting for a separate source offer or accessing a historical mirror. This
source distribution preserves the individual component licenses.

The source and build record consists of:

- `toolchain.lock.json` and `docker/builder.Dockerfile`, identifying the
  immutable emsdk toolchain, installed TeX Live files and package metadata
  by image digest;
- the original TeX/LaTeX, PGF and pgfplots inputs and their license and
  installed file headers in that TeX Live tree, and the checked source and
  documentation archives identified below; package projects are
  https://tug.org/texlive/, https://www.latex-project.org/,
  https://github.com/pgf-tikz/pgf and https://github.com/pgf-tikz/pgfplots;
- `worker/pdftex-library.js`, `worker/pdftex-pre.js` and
  `worker/pdftex-node-pre.js`, together with the fixed SwiftLaTeX source
  pin and `patches/0001-pdftex-harness-kpse-protocol.patch`;
- `scripts/build-worker.sh`, `scripts/build-fmt.sh`,
  `scripts/build-fmt.mjs` and `scripts/check-fmt-preload.mjs`, and the
  preload declaration `closure/fmt-preload.txt` and its inlined source
  `closure/fmt-font-redirect.tex` and `closure/fmt-pgfplots-hint.tex`.

Run `scripts/in-builder.sh` to obtain the pinned builder, fetch the fixed
sources with `scripts/fetch-sources.sh`, then run
`scripts/build-pdftex.sh all` in an offline builder.
`scripts/pack-tex-sources.sh` packs the verified stock inputs and downloaded
official containers with sorted paths, neutral ownership, fixed timestamps
and timestamp-free gzip compression. `scripts/build-fmt.sh`
generates two formats, compares their bytes, and preserves the full input
metadata. The recipe pins the format date/time to `2025.11.1.0`, injects the
preload commands immediately before the kernel's final dump, and discloses
those changes in `scripts/build-fmt.mjs`. The original installed source
files are retained; the transformed inputs and generated format are
reproducible from this public recipe. Anyone redistributing the format
must retain notices, provide the applicable license terms and make the
corresponding source and recipe available under the applicable component
licenses.

## TeX Live provenance

Engine v2 uses the frozen TeX Live 2025 installation from
`texlive/texlive@sha256:f25ee2dcd00f58198f918064f4a1c8562410b33e84155bd55b02b419d73d9391`.
The digest fixes the installed runtime files and package-manager metadata.
The frozen `tlpkg/texlive.tlpdb` has SHA-256
`58628e984b172571c9eaa0c86961e720068bc03a1968064ef87bd011b10c2b41`.
This image omits the separate `source/` and `doc/` trees. The following
18 source archives have been retrieved and verified against their frozen
package revisions, byte counts and SHA-512 checksums. In particular,
`latex.ltx` does not replace its documented `.dtx` sources; those original
sources and the other docstrip source members have been checked.

| Archive | Revision | Bytes | SHA-512 |
|---|---:|---:|---|
| atbegshi.source.tar.xz | 77677 | 13352 | `fed07bc139e863b76dcabecfdc3aae8426269a42a28f69fcacb1364fed776eca8605ee425c0bee1e57d52de238da661551656aed335a86f0f624699e2a1f3c9d` |
| atveryend.source.tar.xz | 77677 | 4276 | `67d66faa2362adeed99d46a8a53d3491484c07a19a7a2ed11cb9fe0d3b728c6d6e4a2521c64d744d0beddceca96b06c3109c2a8178851c162f5913c9052a8521` |
| babel.source.tar.xz | 77821 | 964612 | `6653e236972a65588487ac487c8c8c1ce2527f54cc9b81c0b72b2a3a1c2831f917a7aa95fee565964c2d524d2618cfd2274e50087d9c46038da755c85b29307b` |
| firstaid.source.tar.xz | 76740 | 11340 | `85505fcd12977c4ec7deaa424f047901d8199b04f1cdc0799d36c178bf7d147e1f05fb3ca757af3e596e050da55a7763d4312c16f0228a90cd7190e37bce3206` |
| graphics.source.tar.xz | 75374 | 57432 | `7841f053d5cdec21c1c5278a3629aa97161f4f454074837f063dca1865922da91a928e2d421fd0a10c1616b77b513f6128d8183fffe57aae906a57dcdfe5da73` |
| hyph-utf8.source.tar.xz | 74823 | 36100 | `e78358a34bb900ae0534203fdf0fa6385063c67b492f3e40e60f9386eb85a95bd3c2b6d75784ac795eff1b63cb5a8c19e067cd2c9d08d35160ed7d97480c6118` |
| hyphen-armenian.source.tar.xz | 73410 | 1196 | `91c046f97002d9d7aa3f93cb00dfcc617494158805407d9ca19a19c23338ffd81eac946acd6455226b679849e20ecf515d88b8d5e9d9017d5845a8067efad062` |
| hyphen-basque.source.tar.xz | 73410 | 2540 | `ab616fef4f1e3cecf6bf8aef4f9c83b89c7b7fbf67b080dbcdb6395bda8b41b1923106019f25805cf6883479131c22bb4da0573247ec2bd0fddb39425c64c27a` |
| hyphen-ethiopic.source.tar.xz | 73410 | 2616 | `9a2f7feb676233d34bee698f30ff7f194872d2b573e124c9cce1090dcad1be3ac3ba2788fc146954e628c442cce6d215334933602de18a86272c3b84e8970be2` |
| hyphen-galician.source.tar.xz | 73410 | 6768 | `5eb265b139472702757f3667354376073630419982d6436a7ebfcb7c633f7ae07478307abe3cbc71366273ec0cd454e81f3a62f9a4ed89abc41deaf46e68ff8a` |
| hyphen-spanish.source.tar.xz | 75447 | 7912 | `a898bb71058a7f662c2319e36b0c1ad1bf7072c617adadb4a4901ae64d385e6b4e6df54596379a2eba08a4892b8791033f7fa597ef8cc3566e49664ab6fcafb1` |
| hyphen-turkish.source.tar.xz | 73410 | 2724 | `f5a69877b90f51d3974f7aeba3dbbbd5f3c16170999d235a8f9d8137e64e44dceee71d721a06aea171e4e2a7660e59ef5369aa423d317fe0a0799f56f32ffdf6` |
| hyphen-turkmen.source.tar.xz | 73410 | 1676 | `710bf8c2190168e2209dd887c716118b9f0d41075895057689db25a841f1656a2ada7a85f3aa55325d0fd8daaabee089d9e06f131eeaff035ea1b4a46962fabf` |
| l3kernel.source.tar.xz | 77438 | 647680 | `52a62426b14956e8be17423760b5faebb39e7b156ca9cf2202f835b4f3bd1f1baf662d7ea940d1d5c18ea83f697e6b74e0c16eac69842658a98748b53f1dd7ea` |
| latex.source.tar.xz | 76924 | 823188 | `bf145c57aa6f20da69e2fdd14838bde5693e561ac420c401a1327fc8f7778154075689a3faf0733e489d1f588434457e3efc94c6049439d03201f44e8cbf986e` |
| pgfplots.source.tar.xz | 77677 | 488212 | `da445151220946e6ed13ca4c58d7e6b26dd2e27873e339823aa240fea2664fe49301e5e60fb2e275e6465a6a67bd4ce983b831e62524ef69bc83f97ececef45d` |
| ruhyphen.source.tar.xz | 21081 | 13656 | `df587bb8c81e73f70a93146d6c3a50c2a66b16084e8eab0b01e0aefb3ce073c6b6e812cfd8c5a1520f98ca58e2e2e0634877ca2987742eccc4d7340a7d62e23b` |
| xcolor.source.tar.xz | 77677 | 77232 | `4bd373c51c8a42a46495e77e5a3ec304fed1420496b4eac08241acd80b7b9feb82f9c9af069f4f74d3369341a7f95a6dc4b071096940add7c7ddabb68f0c8e8f` |

The 18 source archives total 3,162,512 bytes. The official historical
mirror index is https://tug.org/historic/ . The archive directory actually
used and verified is
https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2025/tlnet-final/archive/ .
Each archive URL is that directory followed by its filename in the table.

PGF 3.1.11a (revision 78116) provides its TeX source in the runtime package;
those format-input bytes are retained. Its separate documentation archive
and the pgfplots documentation archive have also been retrieved and checked:

| Archive | Revision | Bytes | SHA-512 |
|---|---:|---:|---|
| pgf.doc.tar.xz | 78116 | 10281484 | `267dea4eb097ba684547c7feeaea16a02e75e9961dc6919fbdbcdd23f3def11612aa80eb6125fbd4252ba30bf56dac0159151d2f753c40d8b6970bd62cc3a3b3` |
| pgfplots.doc.tar.xz | 77677 | 12997780 | `f777d7158045945d50c68bdb07a2836b9023a24f87ebe97fff1ab52d4de0183496434ad31f85601ce5b8ab2187a0491d2f5e8da1bda779688d4faccc75ed7571` |

The engine-v1 local-install provenance remains historical.

The package and font files in `texfiles.tar.gz` remain verbatim. Its
`pdftex.map` is generated during packing: the trimmer selects entries whose
TFM names are closure members, removes comments and blank lines, normalizes
line endings and preserves the selected entry order. It does not rewrite
the font programs. The relevant font-package license notices and the
attributions above continue to apply.

## Combined-license conclusion

The distribution presents overall as: **a combination of GPL-3.0 (poppler,
the or-later option in effect) and AGPL-3.0 (SwiftLaTeX, plugin side)**, with
the GPLv3 §13 network-interaction clause applying — the corresponding source
is offered publicly through this repository (build scripts + pins + patches)
and the upstream pins. `texfiles.tar.gz` aggregates original TeX package/font files and a
build-generated trimmed map: the majority are LPPL (notice retention
fulfills them); the original ten non-LPPL families and the added endfloat and
algorithms components (GPL / LGPL / CC-BY-4.0, dedicated tables) are fulfilled through verbatim distribution + in-file notice retention
+ the attribution record in this file, and do not form a derivative
combination with the engine wasm; the permissive items
(OFL/Knuth/other-free/CC0/MIT/Apache and the separately described GUST fonts) carry notice-retention duties only.
The format carries its own component and source obligations as described
above, separately from the source-file tarball. The remaining components
(MIT/LGPL-2.1/FTL/zlib/IJG) are permissive or
file-level licenses, fulfilled by notice retention via the public source
tree/repository, with no further copyleft effect.
