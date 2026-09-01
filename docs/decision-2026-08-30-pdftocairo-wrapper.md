# Decision: pdftocairo wrapper recipe (path A / path B)

Date: 2026-08-30 · Evidence subject: the un-stripped `pdftocairo.wasm`
(24,071,457 B) left behind by the spike probe

## Ruling: path B — upstream poppler (unmodified sources) + emcc `callMain`

Host-side call shape (replacing the vendored `_convertPdfToSvg()`):

```js
mod.FS.writeFile("input.pdf", pdfBytes);
mod.callMain(["pdftocairo", "-svg", "input.pdf", "output.svg"]);
const svg = mod.FS.readFile("output.svg", { encoding: "utf8" });
```

**Pin-strategy deviation from the brief's "latest stable tag"**: pin instead
to the vendored artifact's exact versions (poppler 24.03.0 etc., below).
Rationale: the smoke assertion is "newly built vs vendored output SVG
byte-identical"; pinning a newer version would make poppler/cairo version
differences a confounding variable — on mismatch one could not distinguish
"build line not reproducible" from "upstream behavior changed". Pinning the
same versions turns the smoke into a pure build-line equivalence test. The
upstream pin still satisfies the global constraint (fixed tag + recorded in
`toolchain.lock.json`).

## Step 1 evidence chain (DWARF + strings, quoted verbatim)

Analysis command: `~/emsdk/upstream/bin/llvm-dwarfdump --debug-info <wasm>`
(shipped with emsdk 6.0.8; no system llvm needed). Output: 4,668,346 lines /
500 compile units.

### ① Where `_convertPdfToSvg` comes from: a function gboyd compiled into poppler's own sources — not a standalone wrapper file, and not poppler's own

The host-JS export `_convertPdfToSvg` corresponds to the C++ symbol
`convertPdfToSvg` (in the JS glue, `_convertPdfToSvg =
Module['_convertPdfToSvg'] = ... wasmExports['convertPdfToSvg']`). DWARF,
verbatim:

```
0x0000b58b:   DW_TAG_subprogram
                DW_AT_low_pc	(0x000006f4)
                DW_AT_high_pc	(0x00002edd)
                DW_AT_name	("convertPdfToSvg")
                DW_AT_decl_file	("/home/gboyd/programs/poppler/utils/pdftocairo.cc")
                DW_AT_decl_line	(925)
                DW_AT_type	(0x0000834e "int")
                DW_AT_external	(true)
```

Containing compile unit:

```
0x000033d2: Compile Unit: length = 0x0000e3bb, format = DWARF32, version = 0x0004, ...
0x000033dd: DW_TAG_compile_unit
              DW_AT_producer	("clang version 19.0.0git (https://github.com/llvm/llvm-project e769fb8699e3fa8e40623764f7713bfc783b0330)")
              DW_AT_language	(DW_LANG_C_plus_plus_14)
              DW_AT_name	("/home/gboyd/programs/poppler/utils/pdftocairo.cc")
              DW_AT_stmt_list	(0x0000128f)
              DW_AT_comp_dir	("/home/gboyd/programs/poppler/build/utils")
              DW_AT_low_pc	(0x00000000)
```

Key inference:

- The function's locals are **same-named and same-ordered** as poppler
  `main()`'s locals (`argc` L927 / `argv` L928 / `str1` L929 / `str2` L931 /
  `fileName` L936 / `outputName` L937 / `outputFileName` L938 /
  `imageFileName` L939 / `ownerPW` `userPW` L940 / `cairoOut` L941 / `pg`
  L942, with `doc` still matching upstream 24.03.0's main() line numbering at
  L1157) — a function that **copied main()'s body with a hardcoded argv**,
  inserted into `pdftocairo.cc` at L925 (adjacent to `main()`).
- Constant evidence for `str1`: `DW_AT_location ... DW_OP_constu 0x6776732d`,
  little-endian bytes `2d 73 76 67` = `"-svg"` — the wrapper builds its own
  argv = `["-svg", "input.pdf", ...]`, exactly matching the host side's
  hardcoded "input.pdf → output.svg".
- Upstream poppler 24.03.0's `utils/pdftocairo.cc` has no such symbol
  (checked against this repo's clone: `-o` is the odd-pages flag in the arg
  table; the output file is a **positional** `<PDF-file> [<output-file>]`);
  the function has no linkage name (a C++ name, not an extern "C" wrapper).
- **Conclusion: `_convertPdfToSvg` is gboyd's private source patch to
  `utils/pdftocairo.cc`; the suspicion registered at plan time is
  confirmed.**

### ② Versions and build environment (strings inside the wasm + DWARF paths, quoted)

| Component | Version | Evidence, verbatim |
|---|---|---|
| poppler | **24.03.0** | string `24.03.0`; `Copyright 2005-2024 The Poppler Developers - http://poppler.freedesktop.org`; CU names `/home/gboyd/programs/poppler/poppler/*.cc` (231 source paths) |
| fontconfig | **2.15.0** | CU name `("../src/fcinit.c")`, comp_dir `/home/gboyd/programs/fontconfig-2.15.0/builddir` (meson out-of-tree build, release-tarball layout) |
| expat | **2.2.6** | CU name `("../subprojects/expat-2.2.6/lib/xmlparse.c")` (fontconfig meson wrap subproject, matching its release tarball's expat.wrap) |
| cairo | **1.17.8** | string `1.17.8`; header path `/home/gboyd/programs/pango-cairo-wasm/cairo/src/cairo.h` (no cairo .c CU — cairo linked as a precompiled static library without debug info) |
| zlib | 1.2.13 | CU names `/home/gboyd/programs/emsdk/.../cache/ports/zlib/zlib-1.2.13/adler32.c` etc. (emscripten port) |
| libpng | 1.6.39 | same, `cache/ports/libpng/libpng-1.6.39/png.c` etc. |
| libjpeg | 9c | same, `cache/ports/libjpeg/jpeg-9c/jcapimin.c` etc. |
| freetype | 2.13.x (no .c CU; exact version not recoverable) | only the header path `fontconfig-2.15.0/subprojects/freetype2/include/freetype/freetype.h` |
| Compiler | clang 19.0.0git (e769fb8699…) | the only producer string; emsdk 3.1.6x era (its cache/build/libc++-noexcept-tmp paths are the old layout) |
| C++ runtime | libc++ (`std::__2::`), exceptions enabled | glue contains `invoke_ii/iii/...` (JS EH); poppler CUs have no pthread symbols and the glue has no pthread code → **no pthreads** |

**Identity of `pango-cairo-wasm`**: the GitHub repository
`VitoVan/pango-cairo-wasm` ("PangoCairo on the Web", WTFPL build.sh). Its
cairo submodule pin `c3b672634f0635af1ad0ffa8c15b34fc7c1035cf` has not
changed since 2023-04-22 (repo commit 658f64b); that commit is cairo's
"Release Cairo 1.17.8 (snapshot)" (2023-02-02) — **an exact match with the
wasm's `1.17.8`**, pinning down that gboyd's cairo came from that repo's
submodule pin. gboyd separately built fontconfig from the 2.15.0 release
tarball (meson), not from that repo's fontconfig submodule.

### ③ Wrapper-source availability search (the path-A verdict)

| Search location | Result |
|---|---|
| `gboyd068/obsidian-swiftlatex-render` (origin of the vendored pdftocairo.js, GPL-3.0) | GitHub API full tree, 34 files: `pdftocairo.js` (compiled artifact), TS plugin sources, esbuild/rollup configs. **No C/C++ sources, no build scripts, no patch files** |
| `gboyd068/SwiftLaTeX` fork (716-file full tree) | same as upstream (pdftex/xetex/dvipdfm wasm), **no poppler** |
| all gboyd068 repositories (GitHub API lists 7) and gists | no poppler build line |
| `VitoVan/pango-cairo-wasm` full tree | has cairo/fontconfig/freetype/pixman/zlib… submodules and build.sh, **no poppler** |
| GitHub code search: `convertPdfToSvg` | 3 hits, all unrelated Java from bigbluebutton (`SvgImageCreatorImp.java`); note: the index's coverage is unreliable for this case (even `repo:SwiftLaTeX/SwiftLaTeX compileLaTeX` returns 0), so corroborative only |
| grep.app | blocked by a Vercel security interstitial; no evidence taken (recorded as-is; does not affect the conclusion a priori) |

**Conclusion: gboyd's `pdftocairo.cc` patch source is unavailable → path A
is out.**

## Path-B feasibility and design verification (measured)

On emsdk 6.0.8, `callMain` semantics measured with a minimal C program
(`-sMODULARIZE=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=callMain,FS`):

- **Three consecutive callMain invocations all execute** (argv passed
  correctly each time, `./this.program` auto-unshifted); the runtime stays
  alive and accepts further calls — emsdk 6.0.8 has no `calledMain`
  single-shot guard.
- Exit codes travel via `exitJS` → `ExitStatus` exception →
  `handleException` → returned as the call's value (with `EXIT_RUNTIME=0`
  the runtime is not destroyed). Failure detection: a non-zero return /
  `FS.readFile("output.svg")` throwing.
- **The one protocol change on the plugin side**:
  `mod._convertPdfToSvg()` →
  `mod.callMain(["pdftocairo","-svg","input.pdf","output.svg"])`. The FS
  read/write (`writeFile("input.pdf",…)` / `readFile("output.svg")`) and the
  filename conventions are unchanged.

## This repo's pins (recorded in toolchain.lock.json)

| Component | Pin | Source |
|---|---|---|
| poppler | `481ee336d15bdf6b2b6084dddcd1617b032d2cd5` (tag `poppler-24.03.0`) | gitlab.freedesktop.org/poppler/poppler |
| cairo | `c3b672634f0635af1ad0ffa8c15b34fc7c1035cf` (1.17.8 snapshot) | same as vendored (VitoVan/pango-cairo-wasm submodule pin) |
| fontconfig | `72b9a48f57de6204d99ce1c217b5609ee92ece9b` (tag 2.15.0, release tarball) | same as vendored |
| freetype | `de8b92dd7ec634e9e2b25ef534c54a3537555c11` (2.13) | VitoVan pin (the vendored freetype version is not recoverable; FT_Outline_Decompose is stable across versions — no effect on SVG bytes) |
| pixman | `37216a32839f59e8dcaa4c3951b3fcfc3f07852c` (0.42.2) | VitoVan pin (a cairo dependency, not on the SVG output path) |
| zlib/libpng/libjpeg | emscripten ports (this machine's emsdk 6.0.8: zlib 1.3.2 etc.) | vendored also uses ports (1.2.13/1.6.39/9c); version deltas do not affect SVG output for vector PDFs |

## Licensing

poppler GPL-2+ (choosing "or later" → the GPL-3.0 branch, GPLv3 §13 combined
with the plugin's AGPL-3.0); cairo LGPL-2.1/MPL-1.1; fontconfig MIT;
freetype FTL/MIT; pixman MIT; expat MIT; zlib/libpng/libjpeg under their own
licenses. Obligations are consolidated in THIRD-PARTY-NOTICES.md (ships with
the release).
