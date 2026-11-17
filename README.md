# texkit-swiftlatex

Deterministic build chain for the TeXKit (Obsidian plugin) pdfTeX WASM
engine. From pinned upstream sources it produces four release assets —
`swiftlatexpdftex.worker.js`, `swiftlatexpdftex.fmt`, `pdftocairo.js`
(wasm-opt stripped) and `texfiles.tar.gz` — verifies them against size
and determinism gates, and publishes them as a GitHub release (`engine-vN`)
together with a sha256+bytes manifest.

## Build

Prerequisite: Docker. The builder combines the emsdk 6.0.8 and frozen TeX
Live 2025 images pinned by digest in `toolchain.lock.json`. It supplies the
compiler, Node and TeX inputs; no local TeX installation is needed. Run from
the repository root:

```sh
bash scripts/in-builder.sh -- bash scripts/fetch-sources.sh
bash scripts/in-builder.sh --network none -- bash scripts/build-pdftex.sh all
bash scripts/check-pdftex.sh
```

The build writes four assets and `engine-manifest.json` under
`build/engine-v2/`. The worker compiles synchronously without Asyncify, the
format preloads pgfplots, and the 1,416-member closure has its font map trimmed
to the fonts it contains. `pdftocairo.js` retains the verified engine-v1 bytes.

| Asset | Bytes |
|---|---:|
| swiftlatexpdftex.worker.js | 2,080,266 |
| swiftlatexpdftex.fmt | 22,616,021 |
| pdftocairo.js | 5,630,761 |
| texfiles.tar.gz | 15,664,679 |
| **Total** | **45,991,727 (43.86 MiB)** |

Hashes and reproducibility records are in `docs/determinism.md`. The
release input manifest is `release/engine-manifest.json`.

Releases are built and published by CI after an authorized push of the exact
`engine-v2` tag. The workflow compares its built manifest with the committed
release manifest before publishing, then verifies public downloads. The
legacy `scripts/publish.sh` entry point is retired.

## CI

The workflows in `.github/workflows/` use actions pinned to commit SHA and
restrict token permissions to each job's needs.

- **static-guard** runs script syntax and `tests/privacy-gate.sh` on every
  push and pull request.
- **closure-repro** independently materializes and packs the closure twice
  with the frozen builder, compares their bytes and checks the recorded
  trimmed-map baseline.
- **pdftex-build** builds the four assets from fixed sources, runs all
  release gates and compares the committed manifest. It publishes only for
  a push of `refs/tags/engine-v2` to `WeMingT/texkit-swiftlatex`.

## Mirror policy

Public updates follow release drops, with one linear commit per version.
Published version tags remain fixed. Issues are welcome; submit proposed
patches in issues. Pull requests are not accepted. Forks can rerun the
repository's build and verification workflows.

## Gates

- **Protocol** checks 64 cases against the release worker: initialization,
  request validation, files, repeated compilation, filesystem boundaries
  and runtime faults. See `docs/pdftex-worker-protocol.md`.
- **Corpus** checks 68 cases by pages, actual PDF bytes, fonts, references
  and SVG structure, plus the error path and warm compilation; stable
  results are in `docs/corpus-gate.md`. CI uses `--check` without rewriting
  this record.
- **Determinism** requires byte-identical format double builds and assets
  built from different checkout paths. See `docs/determinism.md`.
- **Identity** scans asset content and metadata, including decoded wasm.
- **Size** limits the four assets to 50 MiB.
- **Converter** uses the engine-v1 single-file converter, previously built
  with `wasm-opt --strip-debug --strip-producers` and checked for unchanged
  SVG output before and after stripping.

## Supported output

- The engine is pdfTeX and produces single-page static figures. Documents
  that produce multiple pages are outside this contract.
- Each request runs one compilation pass. Cross-references, shared legends
  (`legend to name`) and cross-picture positions (`remember picture`) that
  need another pass remain incomplete in the first result.
- External programs and shell escape are unavailable: TikZ externalization,
  gnuplot and minted are unsupported.
- Lua is unavailable, including TikZ graph drawing.
- Default text and math remain Computer Modern. T1 and TS1 text use Latin
  Modern; loading `lmodern` explicitly also selects its other supported faces.
  Specialized T1 Computer Modern families such as `cmdh` can substitute
  another family. Their original faces are not supplied.
- Chinese, Japanese and Korean text belongs to the separate engine for
  those scripts.
- `algpseudocode` and `algorithm2e` work inside a `minipage` in a standalone
  document. The `algorithm` float with `algpseudocode` needs outer paragraph
  mode, such as an `article` document; it cannot be placed directly in the
  standalone wrapper.

The closure includes `bm`, `booktabs`, `multirow`, `makecell`, `tabularx`,
`dcolumn`, `hhline`, `bigstrut`, `bigdelim`, `forest`, `mhchem` and `braket`,
the tikzlings animal packages and circuitikz's romano, legacy and example
styles. `cancel` is not supplied. Font coverage includes Palatino small
caps, Pazo blackboard bold and the retained Latin Modern Type 1 faces at all
optical sizes for OT1, T1, TS1 and math. Other Latin Modern encodings are
outside the supplied subset.

## Upstream pins

Single source of truth: `toolchain.lock.json`.
Upstream trees live in `src/` (gitignored — re-fetched, never versioned);
the one carried patch is `patches/0001-pdftex-harness-kpse-protocol.patch`.
License attribution for everything that ships: `THIRD-PARTY-NOTICES.md`.

## Layout

| Path | Purpose |
|---|---|
| `scripts/` | build / gate / publish entry points (shell, node, python) |
| `tests/` | protocol and corpus checks, frozen input corpora |
| `closure/` | committed closure name-list snapshot (byte-identity gate target) |
| `docs/` | verification records (determinism, gate, comparisons, decisions) |
| `worker/` | synchronous worker frontends and format-only file supply |
| `release/` | committed asset manifest and release notes |
| `patches/` | the one carried SwiftLaTeX patch |
| `build/` | generated outputs only (gitignored) — assets, staging, scratch |

## License

The repository itself is AGPL-3.0 (see `LICENSE`). The release bundles
combine SwiftLaTeX (AGPL-3.0), poppler (GPL-2.0-or-later) and a TeX Live
2025 file closure (LPPL majority plus the named exceptions in
`THIRD-PARTY-NOTICES.md`).
