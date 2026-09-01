# Smoke comparison: newly built swiftlatexpdftex worker vs the vendored baseline

Date: 2026-08-31 · Verdict: **PASS (A/B and baseline SVG byte-identical)**

## Method

`node tests/smoke-worker.mjs` (exit 0 = all assertions pass).

One driver (the `--drive` submode: faked `self` + classic-script scope loading)
drives both workers through the harness main flow: `writefile main.tex` (the
spike `input.tex`) → `setmainfile` → `compilelatex`, with file supply over the
harness protocol (`{cmd:"downloadFromCTAN",filename,id}` ⇄
`{cmd:"sendCTANFiles",id,result:Map,error}`). The fmt is the spike-era vendored
`swiftlatexpdftex.fmt` (15.5 MB — the vendored pair is not carried in this
repo; it is supplied via `SMOKE_FMT` from the spike harness copy); closure
files come from the local TeX Live 2025 kpsewhich (the spike browser harness
used TL2024 back then; both workers read the same source, so the A/B
comparison is unaffected). The two workers run in separate child processes
(`self` global isolation); PDF → SVG uses this repo's
`build/out/pdftocairo.stripped.{js,wasm}` (a fresh Module per round,
`callMain(["-svg",...])`).

| Round | worker | Result | Compile | Closure |
|---|---|---|---|---|
| new | `build/swiftlatexpdftex.node.worker.js` (built from this repo's pinned sources, ENVIRONMENT=web,worker,node variant) | ok status=0, PDF 18,562 B | 15.8 s | 91 served / 97 requested / 6 miss |
| vendored | spike harness `swiftlatexpdftex.worker.js` (behavioral baseline, node variant, supplied via `SPIKE_WORKER`) | ok status=0, PDF 18,562 B | 16.9 s | 91 / 97 / 6 miss (miss sets identical item by item) |

(The kpsewhich subprocess accounts for ~15 s of compile wall time, charged
equally to both rounds — not an engine difference.)

## Byte comparison results (worker-out/smoke-worker-result.json)

| Comparison | Verdict |
|---|---|
| SVG: new vs vendored (same fmt + same TL2025 closure) | **byte-identical** (5,418 B, 7 `<path>`, 0 `<text>`, no font references) |
| TeX log: new vs vendored | **byte-identical** (3,074 B) |
| SVG: new vs the spike browser baseline `output.svg` | **byte-identical** (5,418 B) |
| SVG: vendored (re-run through this driver) vs baseline | **byte-identical** (environment-equivalence self-proof) |
| PDF: new / vendored / baseline | all 18,562 B, same object count (8). PDFs are inherently not byte-deterministic (timestamps/IDs, established during the probe); SVG is the criterion |

A/B byte-identity proves: **the artifact of the pinned sources + the 0001
patch + this build line is equivalent to the vendored behavioral baseline**.
Agreement with the baseline additionally proves that the TL2025 closure
produces no output difference vs the original TL2024 closure for this sample.

## Build summary

- Upstream pin: `87dfb950eb9c8e9dcd4ee2a3ac97fbbbacfc618a` (master HEAD; see
  `toolchain.lock.json` swiftlatexCommit)
- Source patch: `patches/0001-pdftex-harness-kpse-protocol.patch`
  (pre.js / library.js / kpseemu.c; the XHR supply replaced by the harness
  postMessage protocol; replayable against a clean pinned tree, verified)
- Artifacts: `build/swiftlatexpdftex.worker.js` (3,157,498 B, single-file
  embedded wasm, `-sENVIRONMENT=web,worker`) and the node-driven twin
  `build/swiftlatexpdftex.node.worker.js` (same object set, used for smoke)
- Full flags and upstream Makefile deltas: the `scripts/build-worker.sh` header
  comment + link function

## Findings and difference analysis

1. **Upstream master (2024-06) has no harness protocol yet**: the pinned
   pre.js talks to `texlive2.swiftlatex.com` directly via synchronous XHR
   (fileid header); no `downloadFromCTAN`/`sendCTANFiles`/`fetchfile`/
   `fetchcache`/`writetexfile`/`writecache`. The vendored worker is a
   post-processed newer build. The source patch (0001) implements the harness
   protocol, its shape checked item by item against the vendored active code
   (including `formatToSuffix` suffix completion, the `texlive200_cache` key
   `format+"/"+name`, and Map replies written to `/tex/<filename>`).
2. **`__async: true` generates no Asyncify wrappers under emsdk 6.0.8** (the
   jsifier emits `Asyncify.handleAsync` wrappers only for the string
   `'auto'`; the binary-side instrument list is added either way). Symptom on
   the first link: kpse returns the file but the wasm never suspends, the
   pointer reads as 0 → "I can't find the format file". Confirmed with a
   minimal reproduction, then switched to `'auto'` (the same usage as
   emscripten's bundled libidbstore); A/B identical after the fix. Recorded
   in the 0001 patch's library.js.
3. **The xpdf tree compiles with different flags than upstream** (recorded
   as-is in the build-worker.sh header): upstream's xpdf/Makefile uses bare
   `-O3`; this build compiles the 50 xpdf C++ TUs with the engine's
   COMMON_CFLAGS (additional `-sUSE_ZLIB -sUSE_LIBPNG -fno-rtti
   -fno-exceptions -DWEBASSEMBLY_BUILD`). The smoke byte-identity is produced
   by exactly those flags; replays follow the script.
4. The vendored worker lives in a `"type":"module"` package whose bare
   `require` a plain `require()` would reject: the smoke driver loads both
   workers in classic-script scope (new Function + injected
   require/__dirname).
5. The child process's event loop does not exit once the engine is loaded:
   the driver ends with an explicit `process.exit`, otherwise the parent's
   spawnSync waits out its full timeout.
