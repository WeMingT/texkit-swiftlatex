# Determinism Gate — same-source double run (2026-08-31)

**Date:** 2026-08-31 (repo main)
**Result:** **PASS** — run A and run B are byte-identical for all four release assets.
**Total size:** 28,255,282 B (26.95 MiB) ≤ 35 MiB red line. [Correction 2026-09-01 (S1 gate review): this figure predates the closure baseline move below — it sums the pre-move 195-file tarball (1,796,461 B). With the table's post-move tarball (1,811,520 B) that round's assets total 28,270,341 B. Original figure kept; see the S1 section for the corrected comparison.]

## Protocol

Each run = full clean of all four build lines → rebuild → sha256 of the four assets.
Run B is an independent full clean rebuild (different wall-clock window).

| Line | Clean command | Build command | Asset |
| --- | --- | --- | --- |
| worker | `rm -rf build/worker build/swiftlatexpdftex.worker.js build/swiftlatexpdftex.node.worker.js` | `bash scripts/build-worker.sh` | `build/swiftlatexpdftex.worker.js` |
| fmt | `rm -rf build/fmt-out build/swiftlatexpdftex.fmt` | `bash scripts/build-fmt.sh` (self double-build + byte gate) | `build/swiftlatexpdftex.fmt` |
| closure | `rm -rf build/closure-staging build/texfiles.tar.gz` | `python3 scripts/materialize-closure.py && sh scripts/pack-closure.sh` | `build/texfiles.tar.gz` |
| poppler | `rm -rf build/stamps build/out build/{freetype,pixman,fontconfig,cairo,poppler,prefix}` | `bash scripts/build-pdftocairo.sh` | `build/out/pdftocairo.stripped.js` |

Parallelism: poppler line ran in the background (longest, tens of minutes); worker → fmt → closure ran
in the foreground (fmt depends on the worker line's node twin). Asset dirs are disjoint, so no
cross-line interference.

## Per-asset sha256, run A vs run B

| Asset (release name) | bytes | run A sha256 | run B sha256 | match |
| --- | --- | --- | --- | --- |
| swiftlatexpdftex.worker.js | 3,157,498 | `ea25dc714172036732f50deb5ec402fd48522f808e264f19873f76721aa15cc9` | `ea25dc714172036732f50deb5ec402fd48522f808e264f19873f76721aa15cc9` | ✅ |
| swiftlatexpdftex.fmt | 17,670,154 | `345c540765bdedfb8bd01e5e7b2f280109d53865407c9e28c0c005ddc9691775` | `345c540765bdedfb8bd01e5e7b2f280109d53865407c9e28c0c005ddc9691775` | ✅ |
| pdftocairo.js | 5,631,169 | `60299ad26888e6b8c3caa9966db72c5e7f9ab8d94abc336568bbf990533fed84` | `60299ad26888e6b8c3caa9966db72c5e7f9ab8d94abc336568bbf990533fed84` | ✅ |
| texfiles.tar.gz | 1,811,520 | `63b58cbdc13159ffd5971ae432147bd334d7eeaa408bdad215a77d9069b4d18a` | `63b58cbdc13159ffd5971ae432147bd334d7eeaa408bdad215a77d9069b4d18a` | ✅ |

All four hashes also equal the pre-gate baselines recorded when each build line
first went green (worker/fmt/closure in this file's history; pdftocairo in the
spike-era vendored manifest). A==B == baseline → the committed source tree
rebuilds deterministically to the released artifacts.

*(2026-09-01: the pdftocairo row above is superseded by the checkout-path
independence fix — see the last section of this file. The worker, fmt and
closure rows stand.)*


Closure baseline moved 2026-08-31: the probe-union closure (195 files, `554e41d4...`)
was incomplete — packages preloaded in the probe format generate no file request, so
epstopdf-base.sty shipped without its hard RequirePackage targets and amsmath-family
blocks failed on-device with "File infwarerr.sty not found". The closure name list now
unions a hand-audited SUPPLEMENT (infwarerr, grfext, kvoptions, pdftexcmds, ltxcmds,
kvsetkeys, kvdefinekeys — see scripts/materialize-closure.py) → 202 files, new baseline
`63b58cbd...`. Worker/fmt/pdftocairo lines are untouched, so their baselines stand.

## Timings (observed)

| Line | run A | run B |
| --- | --- | --- |
| worker | ~227 s | ~227 s |
| fmt (2 internal runs) | ~140 s | ~140 s |
| closure (materialize + pack) | ~27 s | ~27 s |
| poppler (full line) | ~7 min (see note) | ~6.5 min (see note) |

## Poppler-line fixes required for clean replay (2026-08-31 round)

The committed `scripts/build-pdftocairo.sh` was **not cleanly replayable**; that
round made three changes.
Each is product-neutral (verified: final artifact byte-identical to the pre-gate baseline hash above):

1. **cairo libpng resolution pinned to the emsdk sysroot port (1.6.58).** Without a `libpng.pc`
   shim, meson falls back to cairo's vendored libpng subproject (1.6.37). That (a) compiles
   cairo's png code against 1.6.37 headers while the final link provides sysroot 1.6.58 — a real
   (small) artifact difference vs the pre-gate artifact — and (b) adds a `pngtest` executable whose emcc
   link cannot resolve `__resumeException` (objects compiled with `-fexceptions` reference the JS-EH
   symbol; meson's link line omits the exception runtime; emsdk 6.0.8 defaults
   `DISABLE_EXCEPTION_CATCHING=1`). Fix: stage_cairo writes `$PREFIX/lib/pkgconfig/libpng.pc`
   (sysroot shim) and passes `--wrap-mode=nofallback` → system libpng 1.6.58, pngtest absent.
2. **poppler object check path.** CMake emits sibling poppler objects under
   `utils/CMakeFiles/pdftocairo.dir/__/poppler/` (its `..` encoding); the committed check looked
   for `../poppler/`. Fixed to `__/poppler/` (matches what stage_link already used).
3. **Restored `local OBJ=`** declaration in stage_poppler (lost during that round's editing; the check loop
   needs it).

## Post-review verification (first fix pass)

Review finding: the committed tree was not self-contained — `build/cross/emscripten-crossfile.meson`
(the meson cross file all four meson stages read) was an untracked, hand-created input, so a fresh
clone could not replay the poppler line at all. **Fix:** the script now emits the cross file itself
(heredoc at startup, byte-identical to the file it replaces; `build/cross/` stays gitignored).

Covering verification (closes the cross-file finding and the "no uninterrupted full-clean run of
the final script" finding together): one **uninterrupted** full-clean invocation of the exact HEAD
script with `build/cross/` deleted up front —

```
rm -rf build/stamps build/out build/{freetype,pixman,fontconfig,cairo,poppler,prefix,cross}
bash scripts/build-pdftocairo.sh        # rc=0, 382 s, no manual intervention
sha256sum build/out/pdftocairo.stripped.js
# 60299ad26888e6b8c3caa9966db72c5e7f9ab8d94abc336568bbf990533fed84  (5,631,169 B — matches the table)
```

The cross file was regenerated by the script; every stage ran from scratch in one process; the
artifact hash equals the gate table above and the pre-gate baseline. The committed tree is now
self-contained for the poppler line.

## Known concern (honest)

During that round's editing the poppler line's `cmake --build "$B" --target pdftocairo || true` step was
accidentally deleted (edit churn), so the first clean runs configured poppler but never built its
objects; the gate round recovered by running that build step manually before `link strip`. The step
was restored in the final commit and the full script poppler path re-validated (configure → build →
link → strip → artifact hash matches the table above). Root cause of the intermediate failures was the deleted line, not the toolchain.

## S1 closure re-pack gate — 2026-09-01

**Date:** 2026-09-01 (repo main)
**Result:** **PASS** — closure-line double run byte-identical and equal to the committed
tarball; the three untouched lines still hash to their 2026-08-31 baselines; engine-v1 fingerprint
recorded.
**Scope (honest):** only the closure line was rebuilt (the S1 plan changed nothing else).
Worker/fmt/pdftocairo are untouched since that round, so per its precedent ("untouched lines →
their baselines stand") the 2026-08-31 double run remains their determinism evidence; this gate
re-asserts their artifact hashes instead of rebuilding them (~15 min poppler rebuild would
add zero new information).

### Protocol actually run

Closure double run (same per-line commands as the table above, closure row):

- **Run A** — `rm -rf build/closure-staging build/texfiles.tar.gz` → `python3
  scripts/materialize-closure.py && sh scripts/pack-closure.sh` →
  `pack ok: files=619 bytes=3792364 sha256=a60d17ab…` (~85 s)
- **Run B** — full clean of the closure line again, independent wall-clock window →
  identical `pack ok` line; A==B byte-identical (sha256 diff empty) (~103 s)
- **Committed-bytes assertion** — run A equals the committed tarball (3,792,364 B,
- **Derive re-assertion** — `python3 scripts/derive-closure.py` → `git diff --quiet --
  closure/closure-list.txt` passes: regenerated list (619 names, sha256 `0b2ee353…`) is
  byte-identical to the committed snapshot.
- **Standing-baseline assertions** — sha256 of the current worker/fmt/pdftocairo artifacts
  equals the 2026-08-31 table (below); no mismatch → no drift → no rebuild.

Both materialize runs printed `list=619 materialized=619 missing=0`, `basename_fallback=0`,
`staging_bytes=19172105` (18.28 MiB), `staging_tree_files=619 == list OK` (202 files took
~27 s for the 202-file era; 619 take ~85–103 s).

### Per-asset sha256 + evidence source

| Asset (release name) | bytes | sha256 | evidence |
| --- | --- | --- | --- |
| swiftlatexpdftex.worker.js | 3,157,498 | `ea25dc714172036732f50deb5ec402fd48522f808e264f19873f76721aa15cc9` | unchanged through the 2026-09-03 rebuild (pinned as unchanged-asset) |
| swiftlatexpdftex.fmt | 18,188,217 | `7e6c2adc478d1eee4b90e26b1c689497816272d1732056c7c3c0f25f7ee5baf9` | 2026-09-03 rebuild: TL2025 preload set, arrows.meta demoted to runtime-only |
| pdftocairo.js | 5,630,761 | `3d5a1d4e4da59d45478451ef2c2e4fc5e519b6c9872187ddcd98358f796a26c3` | unchanged through the 2026-09-03 rebuild (pinned as unchanged-asset) |
| texfiles.tar.gz | 6,807,706 | `246c5df8aca5450462b79503ccec691abafb12a89a1e946866491d447742836d` | 2026-09-03 rebuild: 972-member closure (619-name list union font whitelist) |

### engine-v1 manifest (generated after run B)

`bash scripts/make-manifest.sh` → `build/engine-manifest.json` (gitignored; values recorded
here, file ships as a release attachment). engineVersion `swiftpdftex-v1`, baseUrl
`https://github.com/WeMingT/texkit-swiftlatex/releases/download/engine-v1/`.

hashes above = `b853f8c70b4197ee83f86946497b1d4f9cbf7dce583c83e043fbcab0950ba519`
(regenerated 2026-09-03 by the engine-v1 rebuild - the TL2025 preload fmt and
the 972-member font-mirror closure; `0867ec1d…` and its predecessors are
superseded with it).

### Total size vs limits

**30,250,763 B = 28.85 MiB** — under the 30 MiB warning line (headroom 1,206,517 B ≈
1.15 MiB) and the 35 MiB red line (headroom 6,449,397 B ≈ 6.15 MiB). vs the
pre-fix total 30,251,185 B the change is −422 B: the pdftocairo swap
5,631,169 → 5,630,761 B (shorter fixed constants) and the tarball swap
3,792,364 → 3,792,350 B (sanitized map header). Worker and fmt are unchanged.

### Reconciliation vs the plan's predictions

Full detail lives in docs/closure-tl2025-delta.md (the "S1 maximal closure
materialization" and "Supplement notes" sections);
not duplicated here.

| Metric | predicted (plan) | actual | deviation |
|---|---|---|---|
| closure files | ~572 | 619 | +47 = 18 supplement blind spots + 20 PSTricks option-gated + siunitx chain + TL2025 restructures |
| texfiles.tar.gz | ~3.1 MiB | 3,792,364 B (3.62 MiB) | ≈ +16% (compression-ratio shift; measured +16.2% at 601 files) |
| four-asset total | ~28.4 MiB | 28.85 MiB | ≈ +1.5%, absorbed by estimate headroom; warning line untouched |

## pdftocairo checkout-path independence — 2026-09-01

**Date:** 2026-09-01 (repo main)
**Result:** **PASS** — the pdftocairo asset builds byte-identically from
three different checkout paths; path-derived strings eliminated.

**Finding.** A cold-start verification (fresh clone of the release tree into
an empty directory, complete build from scratch) produced a pdftocairo.js
that differed from the standing baseline (+117 B in the wasm). Root cause:
compile-time constants baked the build prefix into the binary —

- fontconfig: `FONTCONFIG_PATH` = `<prefix>/etc/fonts`, `FC_CACHEDIR` =
  `<prefix>/var/cache/fontconfig`, the template dir
  `<prefix>/share/fontconfig/conf.avail`, and the fonts.conf template
  carrying the same values;
- poppler: `POPPLER_DATADIR` = `<prefix>/share/poppler`.

A same-path double run cannot see this class — both runs embed the same
absolute path — which is why the 2026-08-31 gate passed while the artifact
was still path-dependent. The finding also closed a privacy gap: the
previous artifact embedded the build machine's home directory (inside the
wasm, base64-wrapped in the single-file js).

**Fix** (`scripts/build-pdftocairo.sh`):

- fontconfig configures with a fixed `--prefix /usr --sysconfdir /etc` and
  `-Dcache-dir=/var/cache/fontconfig`, so every baked constant is a fixed
  neutral string; the actual install is staged via
  `meson install --destdir build/fontconfig-stage` and consumed from there
  (staged `.pc` files rewired to the staging tree so cairo/poppler resolve
  headers and libs normally);
- `--force-fallback-for=expat` pins the expat dependency to the wrap
  subproject — pkg-config could otherwise pick up a stale expat from an
  earlier build under `$PREFIX`, which the destdir staging would not carry;
- poppler passes `-DPOPPLER_DATADIR=/usr/share/poppler`.

**Verification** — three full from-scratch builds of the poppler line
(freetype, pixman, fontconfig, cairo, poppler, link, strip — all stamps
cleared each time) at three different checkout paths:

| checkout path | pdftocairo.stripped.wasm | pdftocairo.stripped.js |
|---|---|---|
| cold-start clone A | `c9cb8293e868acf7fec886e3b74bcd32287120ef400cb5b39c13c49d689432f6` | `3d5a1d4e4da59d45478451ef2c2e4fc5e519b6c9872187ddcd98358f796a26c3` (5,630,761 B) |
| clone A moved to a second path, full re-clean | identical | identical |
| main tree | identical | identical |

`strings` over the wasm: zero occurrences of any checkout path; the neutral
constants (`/etc/fonts`, `/var/cache/fontconfig`,
`/usr/share/fontconfig/conf.avail`, `/usr/share/poppler`) present.
Functional parity on the rebuilt artifact: pdftocairo smoke 4/4 byte-identity
checks true; corpus gate full run **Overall PASS**; the other three assets
are path-free (the worker rebuilt byte-identically inside the cold start
itself).

### Superseded values

| Item | superseded (2026-08-31 baseline) | current |
|---|---|---|
| pdftocairo.js | `60299ad2…` (5,631,169 B) | `3d5a1d4e…` (5,630,761 B) |
| fingerprint | `4a3a9dc5…` | `cb48c338…` |

*(The `cb48c338…` fingerprint above was itself superseded later the same day
by the pdftex.map header sanitization — see the next section.)*

## texfiles closure: pdftex.map header sanitization — 2026-09-01

**Date:** 2026-09-01 (repo main)
**Result:** **PASS** — machine-identity strings eliminated from the closure
tarball; double-run byte-identical; corpus gate full run Overall PASS.

**Finding.** The pre-release audit (four read-only agents over the release
surfaces: tracked text, binary attachments, docs/scripts, repo shape) found
that `pdftex.map` — the only updmap-generated file in the closure — carries
its generating environment as comment header lines:
`% /home/<user>/texlive/2025/texmf-var/...` (the map's own path and the
updmap log path). Same leak class as the pdftocairo path leak: the strings
are deterministic on the build machine, so same-machine rebuild gates are
blind to them. Everything else scanned clean (all 74 tracked files, the
other four release attachments including decoded base64 payloads, tar
metadata — normalized uid/gid 0, empty uname/gname, epoch mtimes — and the
commit identity).

**Fix** (`scripts/materialize-closure.py`):

- staged `*.map` files get `%`-comment lines containing the build machine's
  absolute home path rewritten to a fixed neutral note (map parsers ignore
  comment lines — functionally neutral, verified below);
- a new leak gate scans every staged file's bytes for the build machine's
  home path and hostname (all derived at runtime) and fails the run on any
  hit — this class of leak is now a build failure, not an audit finding.
  *(Refinement 2026-09-01, from the first CI run of the closure-repro
  workflow: the original gate also scanned the bare username, which
  false-positived on the CI container — its username is `root`, a common
  word present in 38 upstream TeX files, and TeX macro names like
  `\uproot@` collide with any user@host-shaped pattern. The username now
  rides only inside the home-path needle; user@host leaks remain covered
  by the hostname needle, and tar uname is normalized empty by
  pack-closure.sh. Poison-fixture re-verified: a home-path canary still
  fails the gate, a simulated container identity passes it clean.)*

**Verification** — full clean double run:

```
python3 scripts/materialize-closure.py   # sanitized_map_header: pdftex.map (2 comment line(s))
                                         # identity_scan: staging clean (...)
sh scripts/pack-closure.sh               # pack ok: files=619 bytes=3792350 sha256=22017883…
```

Run A == run B byte-identical (`22017883…`); derive re-check byte-identical
(619 names unchanged); independent scan of all 620 tar members for
home/username/hostname/workspace strings: zero hits; corpus gate full run on
the sanitized tarball: **Overall PASS** (compiles and SVG outputs unchanged —
the comment rewrite is functionally neutral).

### Superseded values

| Item | superseded | current |
|---|---|---|
| texfiles.tar.gz | `a60d17ab…` (3,792,364 B) | `22017883…` (3,792,350 B) |
| fingerprint | `cb48c338…` | `0867ec1d…` |

## CI closure reproduction — 2026-09-01

**Result:** **PASS** (third run) — the closure line rebuilds byte-identically
on a foreign GitHub runner inside the digest-pinned frozen TL2025 image
(`texlive/texlive@sha256:f25ee2dc…`, tlnet-final), proving the closure
tarball carries no build-machine identity. The two earlier runs are part of
this record: the first exposed a real gate design flaw (below), the second
produced the baseline delta data.

**Gate false-positive finding (run 1).** The leak gate originally scanned
the bare username; on the CI container the username is `root` — a common
word present in 38 upstream TeX files — so the gate failed on clean
content (TeX macro names like `\uproot@` also collide with any
user@host-shaped pattern). On the author machine the needle (`mingwei`)
never collides, which is why the gate looked clean locally. Fixed by
dropping the bare-username needle (see the refinement note in the map
sanitization section); poison-fixture re-verified both directions.

**Baseline delta (run 2).** The frozen-image build vs the released
tarball: released-only 0, built-only 0, content-differing **1** —
`pdftex.map`. The 618 upstream package files are byte-identical across
the author's 2025-11 TL2025 tree (revision 76773) and the frozen
tlnet-final tree; `pdftex.map` is an updmap-generated per-install state
file (texmf-var), regenerated by each installation's updmap run, so it
differs between any two installs.

**Two baselines, deliberately.** The engine-v1 release tarball
(`246c5df8…`, 6,807,706 B) was built on the author's 2025-11 tree,
coherent with the fmt asset built on the same tree. The CI gate pins the
frozen-image baseline (`4d9242b0…`, 6,807,723 B) — reproducible by anyone
via the pinned digest. The one-member delta is reported informationally
on every CI run. A future engine release may re-baseline fmt and closure
together on the frozen image (fmt would have to be rebuilt too — it embeds
the same-tree pdflatex state); that is deliberately deferred so the
release assets keep single-tree coherence.

Re-measured for the rebuilt closure on 2026-09-04: the frozen baseline
digest was derived without a local docker pull by streaming the pinned
image's 2.2 GB tree layer from the registry and extracting the 972 staging
sources — 971 of 972 byte-identical to the author tree, `pdftex.map` the
only difference (its image copy carries /usr/local header paths and
groff-encoding body lines the author's updmap run lacks, so it stages
unmodified where the author's needs header sanitization). The gate's
expected digest follows from that one swapped member plus the
deterministic pack.
