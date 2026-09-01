# Compare: self-built TL2025 format (`swiftlatexpdftex.fmt`)

The fmt line builds the format on TeX Live 2025 via the worker's own
`compileformat` path (the upstream playground flow) instead of consuming the
spike's TL2024 artifacts. This file records the build, the determinism
measurements, the smoke comparison against the pre-fmt worker baseline, and
one worker-build defect the format path exposed.

## Build entry and invocation shape

- Engine entry: `compileFormat()` in `pdftex.wasm/main.c` — sets
  `iniversion=1`, bootstraps `*pdflatex.ini`, runs `mainbody()` (iniTeX);
  `latex.ltx` ends with `\dump` → `storefmtfile()` → `/work/pdflatex.fmt`.
- Worker protocol: host sends `{cmd:"compileformat"}` (`compileFormatRoutine`
  in the patched `pre.js`); the reply arrives on the compile channel
  (`{cmd:"compile", result:"ok", pdf: <fmt bytes>, log, status}`) — the fmt
  bytes ride the `pdf` field. Every file request travels the harness protocol
  (`downloadFromCTAN` ⇄ `sendCTANFiles`) and is answered from the local
  TL2025 tree via `kpsewhich -progname=pdflatex`.
- Driver: `scripts/build-fmt.mjs` (node, in-process fake-`self` classic-script
  load of `build/swiftlatexpdftex.node.worker.js` — same pattern as
  `tests/smoke-worker.mjs`). Shell wrapper `scripts/build-fmt.sh` adds the
  double-build determinism gate and installs `build/swiftlatexpdftex.fmt`.
- Full command: `./scripts/build-fmt.sh` (node + TL2025 kpsewhich only; emsdk is
  not needed — no compilation happens, the previously built worker is consumed as built).

## Artifact

| | bytes | sha256 |
|---|---|---|
| `build/swiftlatexpdftex.fmt` (TL2025, pinned) | 17,670,154 | `345c540765bdedfb8bd01e5e7b2f280109d53865407c9e28c0c005ddc9691775` |
| spike vendored fmt (TL2024, reference) | 16,215,321 | — |

Closure used by the build: 236 files served / 245 requested / 9 misses
(`nul:.tex`, `l3opacity.sty`, `babel-pdflatex.cfg`, `omlenc/omxenc/uenc.dfu`
probes — identical across runs; the host `pdflatex -ini` reference build does
not load them either). Build time ≈ 48 s wall (kpsewhich supply ≈ 31 s).
The TL2025 format is +1.45 MB (+9%) over the TL2024 spike format (kernel and
expl3 growth).

## Determinism (double-build gate)

`storefmtfile()` embeds `\year/\month/\day` in the format banner and the eqtb
dump carries `\time/\day/\month/\year`, so the raw dump drifts with the wall
clock. Measured on the unpinned build:

- two builds in the same clock window: byte-identical, `3b951c65…` (×2);
- two builds ≥1 min apart: exactly **one** byte differs (eqtb `\time`
  register, offset 8209312: 0x13C=05:16 → 0x140=05:20); across days the date
  registers and banner follow.

Elimination: `scripts/build-fmt.mjs` `FMT_PIN_DATE` serves `pdflatex.ini` with
`\year=2025 \month=11 \day=1 \time=0` prepended (kernel-release date of the
TL2025 corpus — tied to corpus identity, not to any build day). This affects
only the dumped bytes: the engine re-reads the clock on every compile start
(`dateandtime` in `pdftexini.c` runs after format load), so runtime
`\today`/timestamps are unaffected. With the pin, two builds ≥1 min apart are
byte-identical: `345c5407…` (×2) — this is the shipped artifact and the hash
`build-fmt.sh` gates on.

Cross-check: a `-g` (DWARF) link of the same engine sources produced a fmt of
identical size differing in 9 bytes (string-pool orderings + `\time`) — fmt
bytes are engine-build-specific, which is fine: one worker build ships.

## Worker defect the format path exposed (fixed in the worker build)

The worker as first linked (emcc 6.0.8, `-sASYNCIFY` default buffer) aborted with
`RuntimeError: unreachable` deep in `latex.ltx` (~85% in, right after the
font preload) on **both** TL2024 and TL2025 corpora, while the vendored
worker completed the identical run. Trap stack: the `unreachable` is
binaryen's asyncify buffer assertion (`buffer_start > buffer_end`) — the
emcc 6 default `ASYNCIFY_STACK_SIZE=4096` records too little call-stack state
for the initex path. The vendored baseline worker carries
`Asyncify.StackSize:16384`. Fix: `-sASYNCIFY_STACK_SIZE=16384` added to
`scripts/build-worker.sh` link flags (both artifacts rebuilt). `compilelatex`
never reaches that stack depth, which is why the earlier smoke could not see it.

Regression check on the rebuilt worker (spike fmt, TL2025 closure,
`SMOKE_OUT=tests/worker-out-rebuilt`): `abSvgByteIdentical` ✓,
`abLogByteIdentical` ✓, `newVsBaselineSvgByteIdentical` ✓ (5,418 B) — the fix
is behavior-neutral for compilelatex.

## Smoke: new fmt + new worker + closure vs the earlier baseline

`SMOKE_FMT=build/swiftlatexpdftex.fmt SMOKE_OUT=tests/fmt-out node
tests/smoke-worker.mjs` (the smoke driver with two new env overrides; defaults
unchanged). Same `input.tex` (spike harness), files from TL2025 kpsewhich:

- `newVsBaselineSvgByteIdentical`: **true** — SVG byte-identical to the earlier
  baseline / spike browser baseline (5,418 B, 7 `<path>`, zero `<text>`).
- `abSvgByteIdentical`: **true** — the vendored worker also loads and runs the
  TL2025-built format with identical output (engine-name compatibility).
- `abLogByteIdentical`: **true**; PDF structurally identical to the spike
  baseline PDF (18,562 B, 8 objects — also matches the spike's self-built-fmt
  figure).
- The only observable difference of the fmt swap: the log banner now reads
  `LaTeX2e <2025-11-01>` (earlier baseline: `LaTeX2e <2024-11-01> patch level 1`).

Verdict: the TL2024→TL2025 format swap introduces **no behavioral
difference** for the harness flow; the ideal outcome (byte-identical SVG)
holds.

## Size budget (four-asset estimate, against the ≤35 MB line)

| asset | bytes |
|---|---|
| `build/swiftlatexpdftex.worker.js` (ship) | 3,157,498 |
| `build/out/pdftocairo.stripped.js` | 5,631,169 |
| `build/swiftlatexpdftex.fmt` | 17,670,154 |
| spike closure (reference, not yet rebuilt here) | ~6,800,000 |
| **total** | **≈ 33.26 MB ✓** |

fmt alone: 16.86 MiB, inside its ~24 MB budget. Packaging caveat: the
pdftocairo side-car `pdftocairo.stripped.wasm` (4,155,438 B) is currently
loaded next to the `.js`; if the pair ships together the total becomes
≈ 37.4 MB > 35 MB — that is a packaging decision (embed or compress),
flagged here, not changed by this stage.
