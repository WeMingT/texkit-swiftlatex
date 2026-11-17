# Corpus gate

Command: `node tests/corpus-gate.mjs --check`

Figures: 68/68. Closure members: 1416.

The release worker receives the complete format and closure in one init message.
Elapsed times, PDF sizes and SVG conversion details are printed with each run.

## Asset identities

| asset | bytes | sha256 |
|---|---:|---|
| swiftlatexpdftex.worker.js | 2080266 | 7bd90f2e76eb19171f2ca63b222114eb66c55a2ff81cbe36e4c1d5e7eb85df46 |
| swiftlatexpdftex.fmt | 22616021 | 1972b46331c9d39a7a3db852367a134dbc214b1a5c718904abb1ba3263d0e451 |
| pdftocairo.js | 5630761 | 3d5a1d4e4da59d45478451ef2c2e4fc5e519b6c9872187ddcd98358f796a26c3 |
| texfiles.tar.gz | 15664679 | f45cde7d3c05032b1dfb3d84627006dc4d4bce38a4e3d0cbd4bd7d36315f8efc |

## Figure correctness

The shared checker reads each saved log, PDF, SVG and metadata file. Success, declared limitations and expected compile failures use separate result criteria.

| figure | expectation | reasons | verdict |
|---|---|---|---|
| 01-baseline | success | none | PASS |
| 02-arrows-meta | success | none | PASS |
| 03-positioning | success | none | PASS |
| 04-calc | success | none | PASS |
| 05-patterns | success | none | PASS |
| 06-shapes-geometric | success | none | PASS |
| 07-decorations-pathmorphing | success | none | PASS |
| 08-matrix | success | none | PASS |
| 09-amsmath | success | none | PASS |
| 10-pgfplots | success | none | PASS |
| 11-mathpazo | success | none | PASS |
| 12-xcolor | success | none | PASS |
| 13-foreach | success | none | PASS |
| 14-circuitikz-basic | success | none | PASS |
| 15-circuitikz-siunitx | success | none | PASS |
| 16-chemfig | success | none | PASS |
| 17-tikz-cd | success | none | PASS |
| 18-tikz-3dplot | success | none | PASS |
| 19-tikz-feynhand | success | none | PASS |
| 20-quantikz | success | none | PASS |
| 21-tkz-euclide | success | none | PASS |
| 22-tkz-fct | success | none | PASS |
| 23-tkz-tab | success | none | PASS |
| 24-tikzlings | success | none | PASS |
| 25-fonts-five | success | none | PASS |
| 26-pgfplots-libs | success | none | PASS |
| 27-tier-a-spotcheck | success | none | PASS |
| 28-catcode-parity | success | none | PASS |
| 28-option-clash | success | none | PASS |
| 29-bfseries-tabular | success | none | PASS |
| 30-pazo-bb | success | none | PASS |
| 31-pazo-sc | success | none | PASS |
| 32-pazo-euro | success | none | PASS |
| 33-ts1-text | success | none | PASS |
| 34-ts1-sizes | success | none | PASS |
| 35-siunitx-micro | success | none | PASS |
| 36-fontenc-t1 | success | none | PASS |
| 37-inputenc-utf8 | success | none | PASS |
| 38-lmodern-first | success | none | PASS |
| 39-lmodern-last | success | none | PASS |
| 40-circuitikz-styles | success | none | PASS |
| 41-bm | success | none | PASS |
| 42-booktabs | success | none | PASS |
| 43-multirow | success | none | PASS |
| 44-makecell | success | none | PASS |
| 45-tabularx | success | none | PASS |
| 46-dcolumn | success | none | PASS |
| 47-hhline | success | none | PASS |
| 48-bigstrut | success | none | PASS |
| 49-bigdelim | success | none | PASS |
| 50-forest | success | none | PASS |
| 51-mhchem | success | none | PASS |
| 52-braket | success | none | PASS |
| 53-cancel | failure | empty-pdf, exit-code, page-count, svg-parse | PASS |
| 54-algpseudocode | success | none | PASS |
| 55-algorithm-algpseudocode | success | none | PASS |
| 56-algorithm2e | success | none | PASS |
| 60-unsupported-clickable | failure | empty-pdf, exit-code, page-count, svg-parse | PASS |
| 61-unsupported-graphdrawing | failure | empty-pdf, exit-code, page-count, svg-parse | PASS |
| 62-unsupported-externalize | failure | empty-pdf, exit-code, page-count, svg-parse | PASS |
| 70-limit-ref | limitation | rerun-requested, unresolved-reference | PASS |
| 71-limit-legend-ref | limitation | rerun-requested, unresolved-reference | PASS |
| 72-limit-two-pages | limitation | page-count, svg-pageset | PASS |
| 73-limit-t1-cmdh | limitation | font-substitution | PASS |
| font-matrix-lm.generated | success | none | PASS |
| font-matrix-nfss.generated | success | none | PASS |
| font-matrix-palatino.generated | success | none | PASS |
| font-matrix.generated | success | none | PASS |

## Compile error path

err-nonexistent-pkg: PASS.
A structured nonzero failure with a LaTeX error in its log is required.

## Warm-worker scenario

One instance compiles 09-amsmath twice. Both compiles must pass the figure checks and have no file-not-found error lines.

| compile | verdict | ok | exit code | PDF nonempty | pages >= 1 | logged bytes match | file-not-found errors |
|---|---|---|---:|---|---|---|---:|
| 1 | PASS | true | 0 | true | true | true | 0 |
| 2 | PASS | true | 0 | true | true | true | 0 |

## Verdict

- figures: 68/68 pass
- error path: PASS
- warm-worker scenario: PASS
- size budget: PASS (45991727 / 52428800 bytes)

**Overall (full run): PASS**
