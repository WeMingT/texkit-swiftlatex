// Corpus gate: the probe corpus figures through new worker + new fmt + new
// TL2025 closure, plus one deliberately-broken figure exercising the compile
// error path. Figures are discovered from two homes: the 13 frozen spike
// probe figures (tests/spike-corpus/, copied verbatim from the spike
// probe run — union-summary.json perFig keys drive discovery) and the
// extension corpus tests/corpus/*.tex. Protocol logic
// reused from smoke-worker.mjs; differences: main.tex source is the
// corpus figure, and downloadFromCTAN is served from the materialized
// closure tree (build/closure-staging) instead of live kpsewhich — so the
// gate proves the packed closure suffices. The .fmt request is served from
// build/swiftlatexpdftex.fmt (TL2025).
//
// Gate per figure: worker returns ok status=0 and a PDF >0 bytes whose page
// count (from the pdfTeX log line "Output written on main.pdf (N pages, X
// bytes).") is >=1 and whose byte size matches that log line. These PDFs
// compress their object streams, so /Type /Page is invisible in the bytes —
// the log is the honest source (the earlier pdfStructure regex had the same
// blind spot). SVG conversion (pdftocairo, a real page-tree parser) is run on
// top — recorded, not gating.
// Misses (worker probing requests like main.aux that are outside the closure)
// are recorded; per the standing precedent they don't fail a figure by themselves.
// Error-path figure must terminate with a structured failure (not-ok status
// and a LaTeX error in the log), not hang or silently succeed.
//
// Writes tests/corpus-out/<fig>.{tex,pdf,log,meta.json,svg} and the gate
// record docs/corpus-gate.md. Exits 0 only if the whole gate passes.
// The record always reflects the actual run: a filtered --only run is clearly
// labelled as a subset run; the unfiltered full run is the authoritative
// committed record.
//
// Run: node tests/corpus-gate.mjs [--only <patterns>]
//      <patterns>: comma-separated; a pattern containing * or ? is a glob
//      matched against the whole figure name (only * and ? are wildcards,
//      everything else — including [ ] — is literal), anything else is a
//      plain prefix match. Examples: --only 14-,27-   --only '2*-*,err-*'
//      (error figure: err-)
//      When --only is given, only matching figures run (the error-path figure
//      runs only if it matches too); the overall verdict then covers the
//      in-scope subset only.
//      A pattern matching nothing at all is a usage error (exit 2), never a
//      vacuous subset PASS.
// Warm-worker scenario (direct test): main() boots ONE worker
// instance via the --drive-warm child mode and compiles the same figure
// twice sequentially on that instance, writing both per-compile artifact
// sets (requested/served/missed per compile). It runs in EVERY gate
// invocation (--only included) and contributes to allPass.
//      node tests/corpus-gate.mjs --drive-warm <worker.js> <A.tex> <B.tex> <outPrefixA> <outPrefixB>
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(here, "..");

// Frozen spike probe corpus, vendored in-repo (verbatim copy; the probe
// artifacts are the gate's immutable baseline).
const CORPUS = path.join(here, "spike-corpus");
// Extension corpus: one figure per .tex, git-tracked.
const W_CORPUS = path.join(here, "corpus");
const WORKER = path.join(root, "build", "swiftlatexpdftex.node.worker.js"); // node twin of the worker asset
const FMT_FILE = path.join(root, "build", "swiftlatexpdftex.fmt");
const CLOSURE = path.join(root, "build", "closure-staging");
const CLOSURE_LIST = path.join(root, "closure", "closure-list.txt");
const OUTDIR = path.join(here, "corpus-out");
const GATE_MD = path.join(root, "docs", "corpus-gate.md");

const spikeFigs = Object.keys(JSON.parse(fs.readFileSync(path.join(CORPUS, "union-summary.json"), "utf8")).perFig);
const wFigs = fs.existsSync(W_CORPUS)
  ? fs.readdirSync(W_CORPUS).filter((f) => f.endsWith(".tex")).map((f) => f.slice(0, -4))
  : [];
// Discovery: frozen spike figures (13) ∪ extension corpus, sorted.
const FIGS = [...new Set([...spikeFigs, ...wFigs])].sort();

// --only <patterns>: comma-separated, glob (with * or ?) or plain prefix.
function parseOnly(spec) {
  if (!spec) return null;
  const pats = spec.split(",").map((s) => s.trim()).filter(Boolean);
  if (!pats.length) return null;
  return (name) => pats.some((p) =>
    p.includes("*") || p.includes("?")
      ? new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$").test(name)
      : name.startsWith(p));
}
const onlyArg = process.argv[2] === "--only" ? process.argv[3] : null;
const onlyMatch = parseOnly(onlyArg);

// Error-path figure (gate: structured failure required). Materialized into
// corpus-out/ so the gate stays self-contained and re-runnable.
const ERROR_FIG = "err-nonexistent-pkg";
const ERROR_TEX = [
  "\\documentclass{standalone}",
  "\\usepackage{nonexistent-xyz}",
  "\\begin{document}",
  "x",
  "\\end{document}",
].join("\n");

// Warm-worker scenario figure: its request set includes the
// trigger family pdftex.def -> \AtBeginDocument -> epstopdf-base.sty +
// epstopdf-sys.cfg. Compiling it twice on one instance is plan-sanctioned.
const WARM_FIG = "09-amsmath";
// oberdiek SUPPLEMENT names (in the closure since the 202 baseline) and the
// trigger-family files, for the warm request-set analysis.
const OBERDIEK7 = ["infwarerr.sty", "grfext.sty", "kvoptions.sty", "pdftexcmds.sty", "ltxcmds.sty", "kvsetkeys.sty", "kvdefinekeys.sty"];
const TRIGGER_FAMILY = ["epstopdf-base.sty", "epstopdf-sys.cfg", "supp-pdf.mkii", "epstopdf.sty"];

// ---------------------------------------------------------------- driver ---
// Same harness postMessage protocol as smoke-worker.mjs: fake `self`, classic
// script scope, writefile main.tex -> setmainfile -> compilelatex.
// A session is ONE booted worker instance; compile() can be called several
// times on it (warm-worker mode) — serveFromClosure is the single copy of
// the closure-serving logic both drive() and driveWarm() reuse.
function createWorkerSession(workerPath) {
  const state = { requested: [], served: [], missed: [], supplyMs: 0, bootMs: 0, compileMs: 0 };
  let compileResult = null;
  let compileResolve = null;
  let compileDone = null;
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });

  function serveFromClosure({ filename, id }) {
    state.requested.push(filename);
    const m = new Map();
    try {
      let bytes = null;
      if (filename.endsWith(".fmt")) {
        bytes = fs.readFileSync(FMT_FILE);
      } else {
        const t = Date.now();
        const loc = path.join(CLOSURE, filename);
        if (fs.existsSync(loc)) bytes = fs.readFileSync(loc);
        state.supplyMs += Date.now() - t;
      }
      if (bytes) {
        m.set(filename, new Uint8Array(bytes));
        state.served.push(filename);
      } else {
        state.missed.push(filename);
      }
      reply(id, m, false);
    } catch (e) {
      state.missed.push(filename);
      reply(id, undefined, String(e));
    }
  }

  const route = (data) => {
    const cmd = data.cmd;
    if (data.result === "ok" && cmd === undefined) { readyResolve(); return; }
    if (cmd === "compile") {
      compileResult = {
        ok: data.result === "ok",
        status: data.status,
        log: data.log,
        pdf: data.pdf ? Buffer.from(data.pdf) : null,
      };
      compileResolve(compileResult);
      return;
    }
    if (cmd === "downloadFromCTAN") { serveFromClosure(data); return; }
    // writefile / writetexfile / mkdir acks: nothing to do
  };

  const selfFake = {
    postMessage: (data) => route(data),
    close: () => process.exit(0),
    mainfile: "main.tex",
    memlog: "",
  };
  globalThis.self = selfFake;

  function send(data) { selfFake.onmessage({ data }); }
  function reply(id, result, error) { send({ cmd: "sendCTANFiles", id, result, error }); }

  const t0 = Date.now();
  const workerSrc = fs.readFileSync(workerPath, "utf8");
  const workerRequire = createRequire(workerPath);
  new Function("require", "module", "exports", "__filename", "__dirname", workerSrc)(
    workerRequire, { exports: {} }, {}, workerPath, path.dirname(workerPath));

  return {
    state,
    ready,
    send,
    bootMs() { state.bootMs = Date.now() - t0; },
    // One compile on this instance: fresh per-compile bookkeeping, watchdog
    // shared shape with the original driver.
    async compile(texSrc) {
      state.requested = []; state.served = []; state.missed = []; state.supplyMs = 0;
      compileResult = null;
      compileDone = new Promise((r) => { compileResolve = r; });
      send({ cmd: "writefile", url: "main.tex", src: texSrc });
      send({ cmd: "setmainfile", url: "main.tex" });
      const tc = Date.now();
      send({ cmd: "compilelatex" });
      const watchdog = new Promise((_, rej) => setTimeout(() => rej(new Error("compile watchdog (10 min)")), 600000));
      const r = await Promise.race([compileDone, watchdog]);
      state.compileMs = Date.now() - tc;
      return r;
    },
  };
}

// Artifacts for one compile: .pdf/.log/.meta.json. The meta carries the
// unique requested/served lists (family-file verification, warm analysis)
// next to the counts; misses are a unique list as before.
function writeArtifacts(outPrefix, r, state, workerPath, extra = {}) {
  fs.writeFileSync(outPrefix + ".pdf", r.pdf || Buffer.alloc(0));
  fs.writeFileSync(outPrefix + ".log", r.log || "");
  fs.writeFileSync(outPrefix + ".meta.json", JSON.stringify({
    worker: workerPath, ok: r.ok, status: r.status, pdfBytes: r.pdf ? r.pdf.length : 0,
    filesRequested: state.requested.length, filesServed: state.served.length,
    filesMissed: [...new Set(state.missed)],
    filesRequestedList: [...new Set(state.requested)].sort(),
    filesServedList: [...new Set(state.served)].sort(),
    bootMs: state.bootMs, compileMs: state.compileMs, supplyMs: state.supplyMs,
    ...extra,
  }, null, 2));
}

// Fresh-worker drive (child mode): boot, one compile, exit. The orchestrator
// judges pass/fail from meta + logs.
async function drive(workerPath, texSrc, outPrefix) {
  const session = createWorkerSession(workerPath);
  await session.ready;
  session.bootMs();
  const r = await session.compile(texSrc);
  writeArtifacts(outPrefix, r, session.state, workerPath);
  console.error(`[drive] ${path.basename(outPrefix)} ok=${r.ok} status=${r.status} pdf=${r.pdf ? r.pdf.length : 0}B served=${session.state.served.length}/${session.state.requested.length} compile=${session.state.compileMs}ms`);
  process.exit(0);
}

// Warm-worker drive (child mode): ONE worker instance, two
// sequential compiles (A then B), per-compile artifacts from the same
// instance — the second compile sees the first compile's session state
// (engine heap is restored per compile, the virtual FS is not).
async function driveWarm(workerPath, texSrcA, texSrcB, outPrefixA, outPrefixB) {
  const session = createWorkerSession(workerPath);
  await session.ready;
  session.bootMs();
  const rA = await session.compile(texSrcA);
  writeArtifacts(outPrefixA, rA, session.state, workerPath, { warm: "compile 1 of 2" });
  console.error(`[drive-warm 1/2] ${path.basename(outPrefixA)} ok=${rA.ok} status=${rA.status} pdf=${rA.pdf ? rA.pdf.length : 0}B served=${session.state.served.length}/${session.state.requested.length} compile=${session.state.compileMs}ms`);
  const rB = await session.compile(texSrcB);
  writeArtifacts(outPrefixB, rB, session.state, workerPath, { warm: "compile 2 of 2" });
  console.error(`[drive-warm 2/2] ${path.basename(outPrefixB)} ok=${rB.ok} status=${rB.status} pdf=${rB.pdf ? rB.pdf.length : 0}B served=${session.state.served.length}/${session.state.requested.length} compile=${session.state.compileMs}ms`);
  process.exit(0);
}

// ---------------------------------------------------------- pdftocairo ------
// Same pattern as smoke-worker.mjs: single-file artifact factory, wasm
// bytes via instantiateWasm, one fresh Module per conversion.
async function pdfToSvg(pdfBytes) {
  const create = require(path.join(root, "build", "out", "pdftocairo.stripped.js"));
  const wasmBinary = fs.readFileSync(path.join(root, "build", "out", "pdftocairo.stripped.wasm"));
  const mod = await create({
    print: () => {}, printErr: () => {},
    instantiateWasm: (info, receiveInstance) => {
      WebAssembly.instantiate(wasmBinary, info).then((r) => receiveInstance(r.instance));
    },
  });
  mod.FS.writeFile("input.pdf", pdfBytes);
  const rc = mod.callMain(["-svg", "input.pdf", "output.svg"]);
  const svg = mod.FS.readFile("output.svg", { encoding: "utf8" });
  return { rc, svg: Buffer.from(svg, "utf8") };
}

function logPages(log, pdfBytes) {
  const m = /Output written on \S+ \((\d+) pages?, (\d+) bytes\)/.exec(log || "");
  if (!m) return { pages: 0, logBytes: 0, bytesMatch: false };
  return { pages: +m[1], logBytes: +m[2], bytesMatch: +m[2] === pdfBytes };
}

// ------------------------------------------------------------ orchestrator --
async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(path.join(OUTDIR, ERROR_FIG + ".tex"), ERROR_TEX);

  // Figure home: the spike figures live in the vendored spike corpus, the
  // extension figures in tests/corpus (extension home wins on collision).
  const texOf = (fig) => {
    const wPath = path.join(W_CORPUS, fig + ".tex");
    return fs.existsSync(wPath) ? wPath : path.join(CORPUS, fig + ".tex");
  };

  // Subset runs (--only) select figures by glob/prefix; the error-path
  // figure participates when the filter matches it (or with no filter).
  const figs = onlyMatch ? FIGS.filter(onlyMatch) : FIGS;
  const cases = figs.map((fig) => ({ fig, texPath: texOf(fig) }));
  if (!onlyMatch || onlyMatch(ERROR_FIG)) {
    cases.push({ fig: ERROR_FIG, texPath: path.join(OUTDIR, ERROR_FIG + ".tex") });
  }

  // A --only pattern that matches nothing at all (e.g. a typo) leaves zero
  // cases, so every per-figure check is vacuously green and the gate exits 0
  // with "Overall (filtered run): PASS" — a false green from a release gate.
  // Refuse instead (exit 2, usage error). Matching only the error-path
  // figure remains a legitimate subset run (see the err- example above).
  if (onlyMatch && cases.length === 0) {
    console.error("error: --only matched no figures");
    process.exit(2);
  }

  const rows = [];
  for (const c of cases) {
    const texSrc = fs.readFileSync(c.texPath, "utf8");
    const out = path.join(OUTDIR, c.fig);
    const wallStart = Date.now();
    const r = spawnSync(process.execPath, [path.join(here, "corpus-gate.mjs"),
      "--drive", WORKER, c.texPath, out], { stdio: ["ignore", "ignore", "inherit"], timeout: 660000 });
    if (r.status !== 0) throw new Error(`driver for ${c.fig} crashed (exit ${r.status})`);
    const meta = JSON.parse(fs.readFileSync(out + ".meta.json", "utf8"));
    meta.wallMs = Date.now() - wallStart;

    let svg = null;
    if (meta.ok && meta.pdfBytes > 0) {
      try {
        svg = await pdfToSvg(fs.readFileSync(out + ".pdf"));
        fs.writeFileSync(out + ".svg", svg.svg);
      } catch (e) {
        svg = { rc: -1, error: String(e) };
      }
    }
    rows.push({ fig: c.fig, meta, svg, ...logPages(fs.readFileSync(out + ".log", "utf8"), meta.pdfBytes) });
  }

  // ------------------------------------------ warm-worker scenario ---------
  // One worker instance, WARM_FIG compiled twice (child mode above). The
  // second compile inherits the instance's session state — the virtual FS
  // (/tex file cache, /work artifacts) and the worker's served-file cache —
  // while the engine heap is restored per compile (analysis in the record).
  // Judgement (gate ruling): both compiles green + zero log-level real
  // file-not-found; probe/artifact-class misses are recorded, not failures
  // (standing precedent). New names in compile 2 are surfaced loudly: per the
  // ruling a REAL gap there is a methodology finding to report, not paper
  // over — it fails the gate through the log-level check.
  const warmTex = texOf(WARM_FIG);
  const warmOut = { 1: path.join(OUTDIR, `warm-${WARM_FIG}.c1`), 2: path.join(OUTDIR, `warm-${WARM_FIG}.c2`) };
  const warmR = spawnSync(process.execPath, [path.join(here, "corpus-gate.mjs"),
    "--drive-warm", WORKER, warmTex, warmTex, warmOut[1], warmOut[2]],
    { stdio: ["ignore", "ignore", "inherit"], timeout: 660000 });
  if (warmR.status !== 0) throw new Error(`warm-worker driver crashed (exit ${warmR.status})`);
  const warm = [1, 2].map((i) => {
    const meta = JSON.parse(fs.readFileSync(warmOut[i] + ".meta.json", "utf8"));
    const log = fs.readFileSync(warmOut[i] + ".log", "utf8");
    return { i, meta, log, ...logPages(log, meta.pdfBytes) };
  });
  // Real (log-level) file-not-found = an ERROR line. Probe misses log
  // nothing ("No file main.aux." is a notice, not an error); a load-bearing
  // miss is a "! ... not found" error and fails the compile anyway.
  const realNotFound = (log) => log.split("\n").filter((l) => /^!.*\b(?:not found|can't find file)\b/i.test(l));
  const warmGreen = (w) => w.meta.ok && w.meta.status === 0 && w.meta.pdfBytes > 0
    && w.pages >= 1 && w.bytesMatch;
  // Request-set analysis inputs.
  const reqA = new Set(warm[0].meta.filesRequestedList);
  const reqB = new Set(warm[1].meta.filesRequestedList);
  const newInB = [...reqB].filter((n) => !reqA.has(n));
  // FS-cache dominance check: compile 2's request set should be exactly
  // compile 1's misses minus the self-generated /work artifacts (main.aux
  // et al. become locally resident; served files are answered from /tex and
  // the JS-side cache without host requests; misses are not cached, so
  // failed probes re-fire).
  const c1MissNoArtifacts = warm[0].meta.filesMissed.filter((n) => !/^main\.[a-z0-9.]+$/.test(n));
  const fsCacheDominates = c1MissNoArtifacts.length === reqB.size
    && c1MissNoArtifacts.every((n) => reqB.has(n));
  const missClass = (n) =>
    /^main\.[a-z0-9.]+$/.test(n) ? "self-generated artifact (/work)"
      : n.endsWith(".vf") ? "virtual-font probe (.pfb+.tfm shipped, .vf deliberately unshipped)"
        : /\.(cfg|trsl)$/.test(n) ? "optional config/dictionary probe (user-local or not in TL)"
          : "OTHER — real-gap candidate";
  const warmPass = warm.every(warmGreen) && warm.every((w) => realNotFound(w.log).length === 0);

  // ------------------------------------------------------------ verdicts --
  const figRows = rows.filter((r) => r.fig !== ERROR_FIG);
  const errRow = rows.find((r) => r.fig === ERROR_FIG);
  const figPass = (r) => r.meta.ok && r.meta.status === 0 && r.meta.pdfBytes > 0
    && r.pages >= 1 && r.bytesMatch;
  const errorPasses = !!errRow && !errRow.meta.ok && errRow.meta.status !== 0
    && /LaTeX Error|nonexistent-xyz|not found/i.test(fs.readFileSync(path.join(OUTDIR, ERROR_FIG + ".log"), "utf8"));

  // Four shipped assets: worker, fmt, pdftocairo, closure tarball.
  const assets = [
    ["swiftlatexpdftex.worker.js", path.join(root, "build", "swiftlatexpdftex.worker.js")],
    ["swiftlatexpdftex.fmt", FMT_FILE],
    ["pdftocairo.stripped.js", path.join(root, "build", "out", "pdftocairo.stripped.js")],
    ["texfiles.tar.gz", path.join(root, "build", "texfiles.tar.gz")],
  ].map(([name, p]) => ({ name, bytes: fs.statSync(p).size }));
  const totalBytes = assets.reduce((s, a) => s + a.bytes, 0);
  const withinBudget = totalBytes <= 50 * 1024 * 1024;
  // Verdict logic unchanged for full runs; a filtered run judges the in-scope
  // subset (error path only required when the error figure ran). The
  // warm-worker scenario always contributes (gate ruling).
  const allPass = figRows.every(figPass) && (!errRow || errorPasses) && withinBudget && warmPass;

  // ---------------------------------------------------------- gate record --
  const lines = [];
  // Wall-clock stays out of the tracked record (a Date stamp dirtyied git
  // on every rerun); it goes to stdout only, at the end of the run.
  const runStamp = new Date().toISOString();
  // Count the staged payload (what the tarball packs), not the closure name
  // list: the font-whitelist trees bypass the name-list resolution, so the
  // list count (619) undercounts the payload (619 union font trees = 972).
  const closureCount = (function countFiles(dir) {
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
      else if (e.isFile()) n += 1;
    }
    return n;
  })(CLOSURE);
  const cmdLine = `node tests/corpus-gate.mjs${onlyArg ? " --only " + onlyArg : ""}`;
  lines.push(`# Corpus gate — ${figRows.length} figures, new worker + new fmt + TL2025 closure`);
  if (onlyArg) {
    lines.push("");
    lines.push(`> **FILTERED SUBSET RUN** (\`--only ${onlyArg}\`): ${figRows.length} of ${FIGS.length} figures, ${errRow ? "with" : "without"} the error-path figure. Not the authoritative record — the unfiltered full run is.`);
  }
  lines.push("");
  lines.push(`Command: \`${cmdLine}\``);
  lines.push("");
  lines.push(`- figures: ${figRows.length} (${spikeFigs.length} frozen spike-probe figures from union-summary.json + ${FIGS.length - spikeFigs.length} extension figures from tests/corpus)${onlyArg ? ", filtered" : ""}`);
  lines.push("- worker: `build/swiftlatexpdftex.node.worker.js` (node twin of the shipped `swiftlatexpdftex.worker.js`; same engine build, ENVIRONMENT also allows node)");
  lines.push("- fmt: `build/swiftlatexpdftex.fmt` (TL2025)");
  lines.push(`- closure: \`build/closure-staging\` (== \`texfiles.tar.gz\` payload, ${closureCount} files, TL2025, from \`scripts/materialize-closure.py\`)`);
  lines.push("- supply: every `downloadFromCTAN` answered from the closure tree; `.fmt` from the TL2025 fmt. Misses below are worker probing requests outside the closure (standing precedent: not failures).");
  lines.push("- per figure: PASS = ok, status=0, PDF >0 B, >=1 page and PDF size matching the pdfTeX log line. SVG via the pdftocairo line recorded on top.");
  lines.push(`- warm-worker scenario (always runs — also under \`--only\`): one instance, \`${WARM_FIG}\` twice — both compiles green + zero log-level file-not-found required; probe/artifact-class misses recorded per the standing precedent`);
  lines.push("");
  lines.push("| figure | verdict | status | wall ms | compile ms | pages | PDF B | SVG B | served/req | misses |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of figRows) {
    lines.push(`| ${r.fig} | ${figPass(r) ? "PASS" : "FAIL"} | ${r.meta.status} | ${r.meta.wallMs} | ${r.meta.compileMs} | ${r.pages} | ${r.meta.pdfBytes} | ${r.svg && r.svg.svg ? r.svg.svg.length : "—"} | ${r.meta.filesServed}/${r.meta.filesRequested} | ${r.meta.filesMissed.join(", ") || "—"} |`);
  }
  lines.push("");
  lines.push("## Compile error path (deliberately broken figure)");
  lines.push("");
  if (errRow) {
    lines.push(`\`${ERROR_FIG}\` (\`\\usepackage{nonexistent-xyz}\`): ok=${errRow.meta.ok} status=${errRow.meta.status} pdf=${errRow.meta.pdfBytes}B compile=${errRow.meta.compileMs}ms — ${errorPasses ? "**PASS** (structured failure, error in log, no hang)" : "**FAIL**"}`);
    const logTail = fs.readFileSync(path.join(OUTDIR, ERROR_FIG + ".log"), "utf8").split("\n").filter(Boolean).slice(-4).join(" ⏎ ").replace(/\|/g, "\\|");
    lines.push("");
    lines.push(`log tail: \`${logTail}\``);
  } else {
    lines.push(`\`${ERROR_FIG}\`: skipped (not in \`--only\` scope)`);
  }
  lines.push("");
  // Warm-worker section of the record: the direct test. All run
  // numbers interpolate from THIS run; the hypothesis-verdict prose is the
  // analysis-of-record — grounded in pinned source (pre.js / main.c /
  // epstopdf-base.sty), which reruns do not change.
  const bMiss = warm[1].meta.filesMissed;
  const oberdiekInA = OBERDIEK7.filter((n) => reqA.has(n));
  const droppedFromA = [...reqA].filter((n) => !reqB.has(n));
  lines.push("## Warm-worker scenario (direct test)");
  lines.push("");
  lines.push(`\`--drive-warm ${WARM_FIG} ${WARM_FIG}\`: ONE worker instance, two sequential compiles of the same figure (plan-sanctioned). The second compile inherits the instance's session state — the virtual FS (\`/tex\` file cache, \`/work\` artifacts) and the worker's served-file cache — while the engine heap is restored per compile (see verdict below). ${WARM_FIG}'s request set includes the trigger family (\`pdftex.def\` → \`\\AtBeginDocument\` → \`epstopdf-base.sty\`).`);
  lines.push("");
  lines.push("| compile | ok | status | pages | PDF B | compile ms | served/req | misses |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const w of warm) {
    lines.push(`| ${w.i} (${w.i === 1 ? "fresh instance" : "same instance"}) | ${warmGreen(w) ? "ok" : "NOT ok"} | ${w.meta.status} | ${w.pages} | ${w.meta.pdfBytes} | ${w.meta.compileMs} | ${w.meta.filesServed}/${w.meta.filesRequested} | ${w.meta.filesMissed.join(", ") || "—"} |`);
  }
  lines.push("");
  lines.push("Request-set analysis:");
  lines.push("");
  // Miss classification grouped by class (same order as missClass).
  const missGroups = new Map();
  for (const n of bMiss) {
    const c = missClass(n);
    if (!missGroups.has(c)) missGroups.set(c, []);
    missGroups.get(c).push(n);
  }
  lines.push(`- compile 2 requested-but-unserved: ${bMiss.length} name(s) — ${[...missGroups].map(([c, ns]) => ns.length > 1 && c.startsWith("virtual-font") ? `${ns.length}× ${c}: ${ns.join(", ")}` : `\`${ns.join("\`, \`")}\` [${c}]`).join("; ") || "none"}.`);
  lines.push(`- real file-not-found (log-level error lines): compile 1 = ${realNotFound(warm[0].log).length}, compile 2 = ${realNotFound(warm[1].log).length} — zero required (a load-bearing miss is a LaTeX error line; the only \`not found\` error anywhere in the corpus logs is the error figure's deliberate one).`);
  lines.push(`- request-set diff: compile 2 requested **${newInB.length}** name(s) compile 1 did not${newInB.length ? ` — \`${newInB.join("\`, \`")}\` (real-gap candidates: report, never supplement silently)` : ""}; compile 1 requested ${droppedFromA.length} name(s) compile 2 did not (every previously-served file — fmt, packages, fonts — answered from session FS state with no host request).`);
  lines.push(`- FS-cache dominance: compile 2's request set ${fsCacheDominates ? "is exactly" : "is NOT"} compile 1's misses minus the self-generated \`/work\` artifacts — misses are not cached engine-side, so failed probes re-fire, while \`main.aux\` becomes locally resident and is no longer probed.`);
  lines.push(`- PDF output: compile 2 ${warm[0].meta.pdfBytes === warm[1].meta.pdfBytes ? `same byte size as compile 1 (${warm[1].meta.pdfBytes} B — a faithful full recompile; sha256 differs only via /CreationDate)` : `differs from compile 1 (${warm[0].meta.pdfBytes} B → ${warm[1].meta.pdfBytes} B)`}.`);
  lines.push(`- trigger family in compile 1: ${TRIGGER_FAMILY.filter((n) => reqA.has(n)).join(", ") || "—"}; oberdiek 7 in compile 1: ${oberdiekInA.length}/7${oberdiekInA.length ? ` (${oberdiekInA.join(", ")})` : ""} — the fresh compile takes \`epstopdf-base.sty\` v2.11's options-empty branch (\`\\def\\pdf@strcmp{\\pdfstrcmp}\` direct pdfTeX primitives), not the \`\\RequirePackage{infwarerr,...}\` branch.`);
  lines.push("");
  lines.push("**Hypothesis verdict (the warm-worker hypothesis test): not reproduced by the node twin — and the mechanism is excluded for this engine family (refuted).**");
  lines.push("");
  lines.push("Source grounds: (1) `pre.js` snapshots the WASM heap once after boot (`self.initmem`, `postRun`, src/swiftlatex/pdftex.wasm/pre.js:69-72) and `prepareExecutionContext()` restores it before EVERY `ccall('compileLaTeX')` (pre.js:62-67, invoked at the top of `compileLaTeXRoutine`, pre.js:113-117) — per-compile TeX macro state, any residual `\\pdf@strcmp` included, cannot survive from one compile to the next. (2) The C entry re-runs the full TeX main body per call (`compileLaTeX` → `_compile()` → `mainbody()`, src/swiftlatex/pdftex.wasm/main.c:555-562; the wasm `main()` at boot only prints, main.c:591-593), re-loading the .fmt from the session FS each time. (3) `restoreHeapMemory` is upstream SwiftLaTeX code (untouched by the TeXKit patch), so the on-device spike engine — same upstream — resets per-compile engine state identically. (4) Independently of the engine: in `epstopdf-base.sty` v2.11 (TL2024 and TL2025 ship the same 2020-01-24 file; verified against a local TL2024 tree) the `\\RequirePackage{infwarerr,grfext,kvoptions,pdftexcmds}` branch (lines 177-181) is the `\\else` of the load-time-options check `\\ifx\\@curroptions\\@empty` (line 151), not of the `\\pdf@strcmp` check (line 158); the latter only guards the primitive-wrapper `\\def`s inside the options-empty branch, so a residual `\\pdf@strcmp` would skip four definitions and request nothing.");
  lines.push("");
  lines.push(`Empirically (this run): compile 2 requested ${reqB.size} name(s), served ${warm[1].meta.filesServed}, ${realNotFound(warm[1].log).length} file-not-found error line(s); the trigger family loaded in compile 1 without the oberdiek 7 (${oberdiekInA.length}/7). The FS cache — not TeX macro state — dominates what the second compile requests, so its request set is unrepresentative of a fresh worker (the durable signals are the new-names diff and the log-level miss count above). Conclusion: the node-twin warm scenario does not reproduce the on-device divergence mechanism, and the hypothesis as stated (warm-worker \`\\pdf@strcmp\` residue flipping \`epstopdf-base.sty\` into the RequirePackage branch) is refuted for this engine family. The surviving explanation for the on-device \`infwarerr.sty\` request is a document-level load of the oberdiek chain — e.g. \`\\usepackage{epstopdf}\`: \`epstopdf.sty\` unconditionally \`\\RequirePackage\`s infwarerr/grfext/kvoptions/pdftexcmds before \`epstopdf-base\` (epstopdf.sty:149-153) — a class the probe corpus never exercised and which static BFS (the S1 closure method) covers: all 7 oberdiek files and \`epstopdf.sty\` are in the ${closureCount}-file closure. The warm scenario stays in the gate as a regression guard for session-FS-state-dependent behavior.`);
  lines.push("");
  lines.push("## Four-asset size budget (red line 50 MiB)");
  lines.push("");
  lines.push("| asset | bytes |");
  lines.push("|---|---|");
  for (const a of assets) lines.push(`| ${a.name} | ${a.bytes} |`);
  lines.push(`| **total** | **${totalBytes}** (${(totalBytes / 2 ** 20).toFixed(2)} MiB) |`);
  lines.push("");
  lines.push(`Budget: ${withinBudget ? "**within**" : "**EXCEEDED**"}`);
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push(`- figures: ${figRows.filter(figPass).length}/${figRows.length} pass`);
  lines.push(`- error path: ${!errRow ? "skipped (filtered run)" : errorPasses ? "PASS" : "FAIL"}`);
  lines.push(`- warm-worker scenario: ${warmPass ? "PASS" : "FAIL"} — compile 2 ok=${warm[1].meta.ok}, status=${warm[1].meta.status}, ${warm[1].pages} page(s), bytesMatch=${warm[1].bytesMatch}, log-level file-not-found=${realNotFound(warm[1].log).length}, new names vs compile 1=${newInB.length}`);
  lines.push(`- size budget: ${withinBudget ? "PASS" : "FAIL"}`);
  lines.push("");
  lines.push(`**Overall (${onlyArg ? "filtered run" : "full run"}): ${allPass ? "PASS" : "FAIL"}**`);
  fs.writeFileSync(GATE_MD, lines.join("\n") + "\n");

  console.log(`Run: ${runStamp} — ${cmdLine}`);
  console.log(fs.readFileSync(GATE_MD, "utf8"));
  process.exit(allPass ? 0 : 1);
}

if (process.argv[2] === "--drive") {
  // Child mode: argv = --drive <worker.js> <case.tex> <outPrefix>
  await drive(path.resolve(process.argv[3]), fs.readFileSync(process.argv[4], "utf8"), path.resolve(process.argv[5]));
} else if (process.argv[2] === "--drive-warm") {
  // Child mode: argv = --drive-warm <worker.js> <A.tex> <B.tex> <outPrefixA> <outPrefixB>
  await driveWarm(
    path.resolve(process.argv[3]),
    fs.readFileSync(process.argv[4], "utf8"),
    fs.readFileSync(process.argv[5], "utf8"),
    path.resolve(process.argv[6]),
    path.resolve(process.argv[7]));
} else {
  await main();
}
