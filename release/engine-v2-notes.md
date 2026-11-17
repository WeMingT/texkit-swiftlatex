# Engine v2

The four single-file engine assets are built from digest-pinned emsdk 6.0.8
and frozen TeX Live 2025 inputs. Asset SHA-256 values, byte sizes, the
fingerprint and the download base URL are in the attached
`engine-manifest.json`.

- `swiftlatexpdftex.worker.js`: synchronous pdfTeX worker without Asyncify;
  initializes its format and closure once and accepts compilation requests
  with optional files. See `docs/pdftex-worker-protocol.md` for the protocol.
- `swiftlatexpdftex.fmt`: LaTeX format with pgfplots preloaded without options
  and T1/TS1 Computer Modern text declarations routed to Latin Modern.
- `pdftocairo.js`: PDF-to-SVG converter retaining engine-v1 bytes exactly
  (SHA-256 `3d5a1d4e4da59d45478451ef2c2e4fc5e519b6c9872187ddcd98358f796a26c3`).
- `texfiles.tar.gz`: 1,416-member TeX and font closure with a font map trimmed
  to the TFM names in the archive.

The four assets total 45,991,727 B (43.86 MiB), below the 50 MiB limit. CI
builds from fixed sources, checks the release worker and corpus, scans the
decoded wasm and other asset content, and compares the committed manifest
before creating the release. Public downloads are verified after creation.

SwiftLaTeX is AGPL-3.0; poppler uses the GPL-3.0 route of GPL-2.0-or-later.
The precompiled format includes GPL-3.0-or-later pgfplots and dependencies
with their individual LPPL or other file-level terms. Package and font
sources retain their notices, and the generated map is documented separately.
See the attached `THIRD-PARTY-NOTICES.md` for attribution, format-distribution
obligations and the fixed sources and complete build recipes.

Default OT1 text and math remain Computer Modern. T1 and TS1 text use Latin
Modern, including micro, degree and euro symbols. The Latin Modern subset
retains every optical size for OT1, T1, TS1 and math. Palatino small caps and
Pazo blackboard bold are supplied, including `mathpazo`'s own `\mathbb`.

Added package coverage includes `bm`, `booktabs`, `multirow`, `makecell`,
`tabularx`, `dcolumn`, `hhline`, `bigstrut`, `bigdelim`, `forest`, `mhchem`,
`braket`, the tikzlings animals and circuitikz's romano, legacy and example
styles. `algpseudocode` and `algorithm2e` work inside a `minipage` in a
standalone document; the `algorithm` float with `algpseudocode` requires
outer paragraph mode, such as an `article` document.

The supported output is one static pdfTeX page per request, compiled once.
Multiple pages and features requiring another pass, including cross-references,
shared legends and cross-picture positioning, are incomplete. External
programs and shell escape (externalization, gnuplot, minted), Lua graph
drawing and `cancel` are unsupported. Specialized T1 CM families such as
`cmdh` may substitute another family. Chinese, Japanese and Korean use the
separate engine for those scripts. See the README support contract.

The release includes `tex-sources.tar.gz` with all stock format inputs and
verified original TeX package source archives; its identity is recorded in
`release/tex-sources.json`.
