# Smoke comparison: newly built pdftocairo vs the vendored baseline

Date: 2026-08-31 · Verdict: **PASS (all three rounds byte-identical)**

## Method

Node v24.14.0 runs the emcc glue directly (link flags
`-sENVIRONMENT=web,worker,node`; node is in the support list, so the real wasm
engine runs without a browser). Each conversion round instantiates a fresh
Module (reason: finding ② below); the protocol is the path-B shape ruled by
the decision doc:

```js
mod.FS.writeFile("input.pdf", pdfBytes);
const rc = mod.callMain(["-svg", "input.pdf", "output.svg"]);   // rc === 0
const svg = mod.FS.readFile("output.svg", { encoding: "utf8" });
```

Three rounds:

| Round | wasm source | Notes |
|---|---|---|
| stripped | `build/out/pdftocairo.stripped.wasm` (4,155,378 B) | release artifact; bytes fed via `instantiateWasm` (emsdk 6.x default INCOMING_MODULE_JS_API lacks `wasmBinary`) |
| unstripped | `build/out/pdftocairo.wasm` (4,155,378 B) | pre-strip control |
| singlefile | `build/out/pdftocairo.stripped.js`, embedded base64 data URI | no `instantiateWasm` override, no external .wasm — the glue takes its own web load path (fetch data URI → instantiateStreaming falls back on MIME → ArrayBuffer instantiation). Under node, `process.versions.node = ""` makes the glue take the `ENVIRONMENT_IS_WEB` branch (undici fetch supports data: URLs; the property must remain a string — deleting it breaks node's internal undici) |

Baseline: the spike browser harness's vendored (gboyd 32 MB edition)
`output.svg` (5,418 B, read-only; vendored in-repo at
`tests/spike-harness/`). Input PDF: the same harness's `output.pdf`
(18,562 B). Script: `tests/smoke.mjs` (`node tests/smoke.mjs`,
exit 0 = all assertions pass).

## Byte comparison results (smoke-result.json)

| Round | rc | Time | SVG bytes | Byte-identical to vendored baseline |
|---|---|---|---|---|
| stripped | 0 | 93 ms | 5,418 | **yes** (`Buffer.compare === 0`) |
| unstripped | 0 | 19 ms | 5,418 | **yes** |
| singlefile (self-loading) | 0 | 339 ms | 5,418 | **yes** |

- stripped vs unstripped output: **byte-identical** (the strip assertion
  passes).
- Single-file JS (release shape) gate: **5,631,169 B ≤ 8.5 MB ✅** (vs the
  vendored strip baseline of 8,267,182 B measured during the probe: the new
  build line is smaller — emsdk 6.0.8 link + no DWARF).
  *(superseded 2026-09-01 by the checkout-path-independence fix:
  5,630,761 B — see docs/determinism.md)*
- Embedded payload integrity: the data-URI base64 decodes to 4,155,378 B,
  byte-identical to the stripped.wasm file.

## Strip assertion

`wasm-opt --strip-debug --strip-producers` (wasm-opt version 132) output has
the **same md5 as the input** (`3c95bc7e3055116bb65e6dee32d34612`): the emcc
link used no `-g`, so the artifact has no DWARF / name / producers custom
sections to begin with (the section table holds only standard sections 1–12)
— strip is a guarding no-op. The mandatory strip stays in the build line so
future flag changes cannot smuggle debug info into the artifact. Together
with the pre/post-strip conversion outputs being byte-identical, the
assertion holds.

## Findings and difference analysis

The pre-registered "same-pin mismatch = build-line difference" case **did not
occur**: with poppler 24.03.0 / cairo 1.17.8 / fontconfig 2.15.0 all pinned
to the vendored versions, the output is byte-identical to vendored — the
build line's equivalence verification passes.

1. **`wasm-opt --all-features` corrupts the artifact (fixed)**: it also
   enables `--enable-compact-imports`, rewriting the import section into a
   non-standard compact encoding — wasm-opt's own validator still passes, but
   V8 throws `CompileError: unknown import kind 0x7f @+1904` (node and
   browser, same engine, both refuse). The predecessor's artifact carried
   this damage. Fix: explicit feature flags `--enable-bulk-memory
   --enable-sign-ext --enable-nontrapping-float-to-int --enable-threads`
   (every feature this binary actually uses); strip does only strip. Lesson:
   after strip, validate by compiling with the **target engine** (not
   wasm-opt itself).
2. **callMain single-shot contract**: `utils/pdftocairo.cc` L995
   `useCropBox = !noCrop` sets the static to true after a successful run, so
   a second `callMain` on the same Module instance triggers
   `checkInvalidPrintOption(useCropBox, "-cropbox")` → `exit(99)` (observed
   on stderr). Path B does not modify upstream sources, so the contract is
   **one fresh Module per conversion** (measured init ~100 ms, acceptable).
   A protocol note for the plugin side.
3. **emsdk 6.0.8 disables exception catching by default** (found earlier):
   the link already carries `-fexceptions
   -sNO_DISABLE_EXCEPTION_CATCHING`; poppler's C++ exception paths work
   (rc=0 is the normal-exit path).

## Browser-side verification (note)

The node simulation already covers the single-file artifact's real browser
load path (glue web branch → fetch data URI → instantiateStreaming MIME
refusal → ArrayBuffer fallback → instantiation → conversion byte-identical).
No real-browser run was performed; for a manual re-check: copy (do not
overwrite) `build/out/pdftocairo.stripped.js` next to the spike harness's
`index.html` and follow its flow — the expected SVG matches the `output.svg`
baseline.
