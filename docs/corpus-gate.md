# Corpus gate — 32 figures, new worker + new fmt + TL2025 closure

Command: `node tests/corpus-gate.mjs`

- figures: 32 (13 frozen spike-probe figures from union-summary.json + 19 extension figures from tests/corpus)
- worker: `build/swiftlatexpdftex.node.worker.js` (node twin of the shipped `swiftlatexpdftex.worker.js`; same engine build, ENVIRONMENT also allows node)
- fmt: `build/swiftlatexpdftex.fmt` (TL2025)
- closure: `build/closure-staging` (== `texfiles.tar.gz` payload, 972 files, TL2025, from `scripts/materialize-closure.py`)
- supply: every `downloadFromCTAN` answered from the closure tree; `.fmt` from the TL2025 fmt. Misses below are worker probing requests outside the closure (standing precedent: not failures).
- per figure: PASS = ok, status=0, PDF >0 B, >=1 page and PDF size matching the pdfTeX log line. SVG via the pdftocairo line recorded on top.
- warm-worker scenario (always runs — also under `--only`): one instance, `09-amsmath` twice — both compiles green + zero log-level file-not-found required; probe/artifact-class misses recorded per the standing precedent

| figure | verdict | status | wall ms | compile ms | pages | PDF B | SVG B | served/req | misses |
|---|---|---|---|---|---|---|---|---|---|
| 01-baseline | PASS | 0 | 2114 | 1443 | 1 | 18563 | 5418 | 19/25 | main.aux, epstopdf.cfg, cmr10.vf, cmmi10.vf |
| 02-arrows-meta | PASS | 0 | 1489 | 712 | 1 | 1289 | 4602 | 17/22 | tikzlibraryarrows.meta.code.tex, main.aux, epstopdf.cfg |
| 03-positioning | PASS | 0 | 2084 | 1029 | 1 | 10683 | 3605 | 18/23 | main.aux, epstopdf.cfg, cmr10.vf |
| 04-calc | PASS | 0 | 2189 | 1496 | 1 | 10760 | 4242 | 18/23 | main.aux, epstopdf.cfg, cmr10.vf |
| 05-patterns | PASS | 0 | 1540 | 607 | 1 | 2472 | 255060 | 18/22 | main.aux, epstopdf.cfg |
| 06-shapes-geometric | PASS | 0 | 1417 | 869 | 1 | 14463 | 17453 | 18/23 | main.aux, epstopdf.cfg, cmr10.vf |
| 07-decorations-pathmorphing | PASS | 0 | 1361 | 574 | 1 | 2357 | 5822 | 20/24 | main.aux, epstopdf.cfg |
| 08-matrix | PASS | 0 | 1446 | 773 | 1 | 10745 | 10562 | 19/24 | main.aux, epstopdf.cfg, cmmi10.vf |
| 09-amsmath | PASS | 0 | 1370 | 879 | 1 | 73151 | 28872 | 42/55 | main.aux, epstopdf.cfg, msbm10.vf, cmmi7.vf, cmmi10.vf, cmsy10.vf, cmex10.vf, cmr7.vf, cmr10.vf, msam10.vf, cmr5.vf |
| 10-pgfplots | PASS | 0 | 1697 | 1558 | 1 | 28904 | 16213 | 63/71 | tikzlibrarypgfplots.surfshading.code.tex, main.aux, epstopdf.cfg, cmsy10.vf, cmr10.vf, cmmi10.vf |
| 11-mathpazo | PASS | 0 | 1329 | 833 | 1 | 47398 | 46889 | 48/58 | main.aux, epstopdf.cfg, pplr8r.vf, pplri8r.vf, cmr10.vf, fplmri.vf, pplb8r.vf |
| 12-xcolor | PASS | 0 | 1359 | 756 | 1 | 13644 | 14291 | 19/24 | main.aux, epstopdf.cfg, cmr10.vf |
| 13-foreach | PASS | 0 | 1459 | 877 | 1 | 11685 | 17964 | 18/23 | main.aux, epstopdf.cfg, cmr10.vf |
| 14-circuitikz-basic | PASS | 0 | 1905 | 1753 | 1 | 18499 | 9671 | 40/47 | tikzlibraryarrows.meta.code.tex, main.aux, epstopdf.cfg, cmmi10.vf, cmr7.vf |
| 15-circuitikz-siunitx | PASS | 0 | 2091 | 1945 | 1 | 13477 | 12014 | 51/59 | tikzlibraryarrows.meta.code.tex, main.aux, epstopdf.cfg, translations-basic-dictionary-english.trsl, cmr10.vf |
| 16-chemfig | PASS | 0 | 1876 | 1430 | 1 | 19843 | 7104 | 23/30 | tikzlibraryarrows.meta.code.tex, main.aux, epstopdf.cfg, cmr10.vf, cmr7.vf |
| 17-tikz-cd | PASS | 0 | 2097 | 1573 | 1 | 18515 | 10348 | 24/31 | tikzlibraryarrows.meta.code.tex, main.aux, epstopdf.cfg, cmmi10.vf, cmmi7.vf |
| 18-tikz-3dplot | PASS | 0 | 2149 | 1551 | 1 | 10075 | 8062 | 23/28 | main.aux, epstopdf.cfg, cmmi10.vf |
| 19-tikz-feynhand | PASS | 0 | 3032 | 2872 | 1 | 4519 | 10189 | 39/44 | tikzlibraryarrows.meta.code.tex, main.aux, epstopdf.cfg |
| 20-quantikz | PASS | 0 | 2025 | 1902 | 1 | 26372 | 12294 | 60/68 | tikzlibraryarrows.meta.code.tex, main.aux, epstopdf.cfg, cmsy10.vf, cmr10.vf, cmmi10.vf |
| 21-tkz-euclide | PASS | 0 | 1640 | 1501 | 1 | 10505 | 8613 | 86/92 | tikzlibraryarrows.meta.code.tex, main.aux, epstopdf.cfg, cmmi10.vf |
| 22-tkz-fct | PASS | 0 | 1999 | 1856 | 1 | 31315 | 28976 | 86/96 | tikzlibraryarrows.meta.code.tex, numprint.cfg, main.aux, epstopdf.cfg, cmmi10.vf, cmsy10.vf, cmr10.vf |
| 23-tkz-tab | PASS | 0 | 1975 | 1730 | 1 | 29906 | 18634 | 26/33 | main.aux, epstopdf.cfg, cmmi10.vf, cmr10.vf, cmsy10.vf |
| 24-tikzlings | PASS | 0 | 1666 | 940 | 1 | 2128 | 4848 | 27/31 | main.aux, epstopdf.cfg |
| 25-fonts-five | PASS | 0 | 1646 | 1087 | 1 | 23966 | 21122 | 48/59 | main.aux, epstopdf.cfg, rsfs10.vf, eufm10.vf, eusm10.vf, eurm7.vf, euex10.vf, eurm10.vf, rsfs7.vf |
| 26-pgfplots-libs | PASS | 0 | 1731 | 1613 | 1 | 17354 | 48987 | 66/72 | tikzlibrarypgfplots.surfshading.code.tex, main.aux, epstopdf.cfg, cmr10.vf |
| 27-tier-a-spotcheck | PASS | 0 | 1389 | 972 | 1 | 15940 | 26461 | 30/35 | main.aux, epstopdf.cfg, cmr10.vf |
| 28-catcode-parity | PASS | 0 | 1369 | 814 | 1 | 13420 | 13450 | 18/23 | main.aux, epstopdf.cfg, cmr10.vf |
| 28-option-clash | PASS | 0 | 1891 | 1626 | 1 | 50674 | 12891 | 48/59 | tikzlibraryarrows.meta.code.tex, main.aux, epstopdf.cfg, cmmi10.vf, cmmi7.vf, cmmi5.vf, cmsy5.vf, cmsy7.vf, cmr7.vf |
| 29-bfseries-tabular | PASS | 0 | 1497 | 911 | 1 | 23033 | 16304 | 20/26 | main.aux, epstopdf.cfg, cmr10.vf, cmbx10.vf |
| font-matrix-palatino.generated | PASS | 0 | 1520 | 1123 | 1 | 98934 | 511119 | 78/187 | main.aux, epstopdf.cfg, pplri8r.vf, cmsy10.vf, cmr10.vf, fplmr.vf, pplr8r.vf, cmex10.vf, fplmri.vf, pplbi8r.vf, cmbsy10.vf, pplro8r.vf, pplb8r.vf |
| font-matrix.generated | PASS | 0 | 2389 | 2254 | 1 | 1459500 | 2856289 | 478/745 | main.aux, epstopdf.cfg, cmb10.vf, cmbsy10.vf, cmbsy5.vf, cmbsy6.vf, cmbsy7.vf, cmbsy8.vf, cmbsy9.vf, cmbx10.vf, cmbx12.vf, cmbx5.vf, cmbx6.vf, cmbx7.vf, cmbx8.vf, cmbx9.vf, cmbxsl10.vf, cmbxti10.vf, cmcsc10.vf, cmcsc8.vf, cmcsc9.vf, cmdunh10.vf, cmex10.vf, cmex7.vf, cmex8.vf, cmex9.vf, cmff10.vf, cmfi10.vf, cmfib8.vf, cminch.vf, cmitt10.vf, cmmi10.vf, cmmi12.vf, cmmi5.vf, cmmi6.vf, cmmi7.vf, cmmi8.vf, cmmi9.vf, cmmib10.vf, cmmib5.vf, cmmib6.vf, cmmib7.vf, cmmib8.vf, cmmib9.vf, cmr10.vf, cmr12.vf, cmr17.vf, cmr5.vf, cmr6.vf, cmr7.vf, cmr8.vf, cmr9.vf, cmsl10.vf, cmsl12.vf, cmsl8.vf, cmsl9.vf, cmsltt10.vf, cmss10.vf, cmss12.vf, cmss17.vf, cmss8.vf, cmss9.vf, cmssbx10.vf, cmssdc10.vf, cmssi10.vf, cmssi12.vf, cmssi17.vf, cmssi8.vf, cmssi9.vf, cmssq8.vf, cmssqi8.vf, cmsy10.vf, cmsy5.vf, cmsy6.vf, cmsy7.vf, cmsy8.vf, cmsy9.vf, cmtcsc10.vf, cmtex10.vf, cmtex8.vf, cmtex9.vf, cmti10.vf, cmti12.vf, cmti7.vf, cmti8.vf, cmti9.vf, cmtt10.vf, cmtt12.vf, cmtt8.vf, cmtt9.vf, cmu10.vf, cmvtt10.vf, euex10.vf, euex7.vf, euex8.vf, euex9.vf, eufb10.vf, eufb5.vf, eufb6.vf, eufb7.vf, eufb8.vf, eufb9.vf, eufm10.vf, eufm5.vf, eufm6.vf, eufm7.vf, eufm8.vf, eufm9.vf, eurb10.vf, eurb5.vf, eurb6.vf, eurb7.vf, eurb8.vf, eurb9.vf, eurbo10.vf, eurm10.vf, eurm5.vf, eurm6.vf, eurm7.vf, eurm8.vf, eurm9.vf, eurmo10.vf, eusb10.vf, eusb5.vf, eusb6.vf, eusb7.vf, eusb8.vf, eusb9.vf, eusm10.vf, eusm5.vf, eusm6.vf, eusm7.vf, eusm8.vf, eusm9.vf, fplmb.vf, fplmbb.vf, fplmbi.vf, fplmr.vf, fplmri.vf, msam10.vf, msam5.vf, msam6.vf, msam7.vf, msam8.vf, msam9.vf, msbm10.vf, msbm5.vf, msbm6.vf, msbm7.vf, msbm8.vf, msbm9.vf, pplb8r.vf, pplbj8r.vf, pplbi8r.vf, pplbij8r.vf, pplbo8r.vf, pplbu8r.vf, pplr8r.vf, pplr8rn.vf, pplrc8r.vf, pplri8r.vf, pplrij8r.vf, pplro8r.vf, pplrr8re.vf, pplru8r.vf, psyr.vf, rsfs10.vf, rsfs5.vf, rsfs7.vf |

## Compile error path (deliberately broken figure)

`err-nonexistent-pkg` (`\usepackage{nonexistent-xyz}`): ok=false status=1 pdf=0B compile=411ms — **PASS** (structured failure, error in log, no hang)

log tail: `l.3 \begin ⏎           {document}^^M ⏎ !  ==> Fatal error occurred, no output PDF file produced! ⏎ Transcript written on main.log.`

## Warm-worker scenario (direct test)

`--drive-warm 09-amsmath 09-amsmath`: ONE worker instance, two sequential compiles of the same figure (plan-sanctioned). The second compile inherits the instance's session state — the virtual FS (`/tex` file cache, `/work` artifacts) and the worker's served-file cache — while the engine heap is restored per compile (see verdict below). 09-amsmath's request set includes the trigger family (`pdftex.def` → `\AtBeginDocument` → `epstopdf-base.sty`).

| compile | ok | status | pages | PDF B | compile ms | served/req | misses |
|---|---|---|---|---|---|---|---|
| 1 (fresh instance) | ok | 0 | 1 | 73151 | 1321 | 42/55 | main.aux, epstopdf.cfg, msbm10.vf, cmmi7.vf, cmmi10.vf, cmsy10.vf, cmex10.vf, cmr7.vf, cmr10.vf, msam10.vf, cmr5.vf |
| 2 (same instance) | ok | 0 | 1 | 73151 | 557 | 0/11 | epstopdf.cfg, msbm10.vf, cmmi7.vf, cmmi10.vf, cmsy10.vf, cmex10.vf, cmr7.vf, cmr10.vf, msam10.vf, cmr5.vf |

Request-set analysis:

- compile 2 requested-but-unserved: 10 name(s) — `epstopdf.cfg` [optional config/dictionary probe (user-local or not in TL)]; 9× virtual-font probe (.pfb+.tfm shipped, .vf deliberately unshipped): msbm10.vf, cmmi7.vf, cmmi10.vf, cmsy10.vf, cmex10.vf, cmr7.vf, cmr10.vf, msam10.vf, cmr5.vf.
- real file-not-found (log-level error lines): compile 1 = 0, compile 2 = 0 — zero required (a load-bearing miss is a LaTeX error line; the only `not found` error anywhere in the corpus logs is the error figure's deliberate one).
- request-set diff: compile 2 requested **0** name(s) compile 1 did not; compile 1 requested 43 name(s) compile 2 did not (every previously-served file — fmt, packages, fonts — answered from session FS state with no host request).
- FS-cache dominance: compile 2's request set is exactly compile 1's misses minus the self-generated `/work` artifacts — misses are not cached engine-side, so failed probes re-fire, while `main.aux` becomes locally resident and is no longer probed.
- PDF output: compile 2 same byte size as compile 1 (73151 B — a faithful full recompile; sha256 differs only via /CreationDate).
- trigger family in compile 1: epstopdf-base.sty, epstopdf-sys.cfg, supp-pdf.mkii; oberdiek 7 in compile 1: 0/7 — the fresh compile takes `epstopdf-base.sty` v2.11's options-empty branch (`\def\pdf@strcmp{\pdfstrcmp}` direct pdfTeX primitives), not the `\RequirePackage{infwarerr,...}` branch.

**Hypothesis verdict (the warm-worker hypothesis test): not reproduced by the node twin — and the mechanism is excluded for this engine family (refuted).**

Source grounds: (1) `pre.js` snapshots the WASM heap once after boot (`self.initmem`, `postRun`, src/swiftlatex/pdftex.wasm/pre.js:69-72) and `prepareExecutionContext()` restores it before EVERY `ccall('compileLaTeX')` (pre.js:62-67, invoked at the top of `compileLaTeXRoutine`, pre.js:113-117) — per-compile TeX macro state, any residual `\pdf@strcmp` included, cannot survive from one compile to the next. (2) The C entry re-runs the full TeX main body per call (`compileLaTeX` → `_compile()` → `mainbody()`, src/swiftlatex/pdftex.wasm/main.c:555-562; the wasm `main()` at boot only prints, main.c:591-593), re-loading the .fmt from the session FS each time. (3) `restoreHeapMemory` is upstream SwiftLaTeX code (untouched by the TeXKit patch), so the on-device spike engine — same upstream — resets per-compile engine state identically. (4) Independently of the engine: in `epstopdf-base.sty` v2.11 (TL2024 and TL2025 ship the same 2020-01-24 file; verified against a local TL2024 tree) the `\RequirePackage{infwarerr,grfext,kvoptions,pdftexcmds}` branch (lines 177-181) is the `\else` of the load-time-options check `\ifx\@curroptions\@empty` (line 151), not of the `\pdf@strcmp` check (line 158); the latter only guards the primitive-wrapper `\def`s inside the options-empty branch, so a residual `\pdf@strcmp` would skip four definitions and request nothing.

Empirically (this run): compile 2 requested 10 name(s), served 0, 0 file-not-found error line(s); the trigger family loaded in compile 1 without the oberdiek 7 (0/7). The FS cache — not TeX macro state — dominates what the second compile requests, so its request set is unrepresentative of a fresh worker (the durable signals are the new-names diff and the log-level miss count above). Conclusion: the node-twin warm scenario does not reproduce the on-device divergence mechanism, and the hypothesis as stated (warm-worker `\pdf@strcmp` residue flipping `epstopdf-base.sty` into the RequirePackage branch) is refuted for this engine family. The surviving explanation for the on-device `infwarerr.sty` request is a document-level load of the oberdiek chain — e.g. `\usepackage{epstopdf}`: `epstopdf.sty` unconditionally `\RequirePackage`s infwarerr/grfext/kvoptions/pdftexcmds before `epstopdf-base` (epstopdf.sty:149-153) — a class the probe corpus never exercised and which static BFS (the S1 closure method) covers: all 7 oberdiek files and `epstopdf.sty` are in the 972-file closure. The warm scenario stays in the gate as a regression guard for session-FS-state-dependent behavior.

## Four-asset size budget (red line 50 MiB)

| asset | bytes |
|---|---|
| swiftlatexpdftex.worker.js | 3157498 |
| swiftlatexpdftex.fmt | 18188217 |
| pdftocairo.stripped.js | 5630761 |
| texfiles.tar.gz | 6807706 |
| **total** | **33784182** (32.22 MiB) |

Budget: **within**

## Verdict

- figures: 32/32 pass
- error path: PASS
- warm-worker scenario: PASS — compile 2 ok=true, status=0, 1 page(s), bytesMatch=true, log-level file-not-found=0, new names vs compile 1=0
- size budget: PASS

**Overall (full run): PASS**
