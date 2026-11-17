// Run the complete corpus with the release worker and preloaded assets.
// Saved figure outputs are judged by the shared result checker. Warm compiles require no
// file-not-found errors. The deliberate error requires a structured failure
// with a LaTeX error in its log. SVG conversions and elapsed times are
// recorded per run; the committed record contains only stable results.
// Run: node tests/corpus-gate.mjs [--check] [--only <prefixes-or-globs>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { startWorker } from "./pdftex/worker-host.mjs";
import { loadAssets } from "./pdftex/protocol.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(import.meta.url);
const CORPUS = path.join(here, "spike-corpus");
const W_CORPUS = path.join(here, "corpus");
const ASSET_DIR = path.join(root, "build", "engine-v2");
const WORKER = path.join(ASSET_DIR, "swiftlatexpdftex.worker.js");
const FMT_FILE = path.join(ASSET_DIR, "swiftlatexpdftex.fmt");
const CLOSURE = path.join(ASSET_DIR, "texfiles.tar.gz");
const CONVERTER = path.join(ASSET_DIR, "pdftocairo.js");
const OUTDIR = path.join(here, "corpus-out");
const GATE_MD = path.join(root, "docs", "corpus-gate.md");
const EXPECT_FILE = path.join(W_CORPUS, "expectations.json");
const NAMES = ["swiftlatexpdftex.worker.js", "swiftlatexpdftex.fmt", "pdftocairo.js", "texfiles.tar.gz"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const frozenFigs = Object.keys(JSON.parse(fs.readFileSync(path.join(CORPUS, "union-summary.json"), "utf8")).perFig);
const extensionFigs = fs.existsSync(W_CORPUS)
  ? fs.readdirSync(W_CORPUS).filter((f) => f.endsWith(".tex")).map((f) => f.slice(0, -4)) : [];
const FIGS = [...new Set([...frozenFigs, ...extensionFigs])].sort();
const ERROR_FIG = "err-nonexistent-pkg";
const ERROR_TEX = ["\\documentclass{standalone}", "\\usepackage{nonexistent-xyz}",
  "\\begin{document}", "x", "\\end{document}"].join("\n");
const WARM_FIG = "09-amsmath";

function parseOnly(spec) {
  if (!spec) return null;
  const pats = spec.split(",").map((s) => s.trim()).filter(Boolean);
  if (!pats.length) return null;
  return (name) => pats.some((p) =>
    p.includes("*") || p.includes("?")
      ? new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$").test(name)
      : name.startsWith(p));
}

let assets;
async function createWorkerSession(workerPath) {
  assets ??= loadAssets(CLOSURE, FMT_FILE);
  const start = performance.now();
  const host = startWorker(workerPath);
  async function next(type) {
    const deadline = performance.now() + 600000;
    for (;;) {
      try { return await host.next(type); }
      catch (error) {
        if (String(error) !== `Error: timeout waiting for ${type}` || performance.now() >= deadline) throw error;
      }
    }
  }
  const fmt = assets.fmt.slice().buffer;
  const files = assets.files.map(([name, bytes]) => [name, bytes.slice().buffer]);
  host.post({ type: "init", fmt, files }, [fmt, ...files.map(([, bytes]) => bytes)]);
  try { await next("ready"); }
  catch (error) { await host.terminate(); throw error; }
  const state = { bootMs: performance.now() - start, compileMs: 0, filesPreloaded: files.length };
  let id = 0;
  return {
    state,
    async compile(source) {
      const currentId = id++;
      const start = performance.now();
      host.post({ type: "compile", id: currentId, source });
      const result = await next("result");
      if (result.id !== currentId) throw new Error("compile result id mismatch");
      state.compileMs = performance.now() - start;
      return { ok: result.status === "ok", status: result.exitCode,
        resultStatus: result.status, reason: result.reason, log: result.log,
        pdf: result.pdf ? Buffer.from(result.pdf) : null };
    },
    terminate: () => host.terminate(),
  };
}

function writeArtifacts(outPrefix, r, state, extra = {}) {
  fs.writeFileSync(outPrefix + ".pdf", r.pdf || Buffer.alloc(0));
  fs.writeFileSync(outPrefix + ".log", r.log || "");
  const meta = { ok: r.ok, status: r.status, resultStatus: r.resultStatus, reason: r.reason,
    pdfBytes: r.pdf ? r.pdf.length : 0, ...state, ...extra };
  fs.writeFileSync(outPrefix + ".meta.json", JSON.stringify(meta, null, 2) + "\n");
  console.log(JSON.stringify({ case: path.basename(outPrefix), ...meta }));
  return meta;
}

async function drive(workerPath, source, outPrefix) {
  const session = await createWorkerSession(workerPath);
  try { return writeArtifacts(outPrefix, await session.compile(source), session.state); }
  finally { await session.terminate(); }
}

async function driveWarm(workerPath, sourceA, sourceB, outA, outB) {
  const session = await createWorkerSession(workerPath);
  try {
    writeArtifacts(outA, await session.compile(sourceA), session.state, { warm: "compile 1 of 2" });
    writeArtifacts(outB, await session.compile(sourceB), session.state, { warm: "compile 2 of 2" });
  } finally { await session.terminate(); }
}

let converterModule;
async function pdfToSvg(pdfBytes) {
  const source = fs.readFileSync(CONVERTER, "utf8");
  const embedded = /data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/.exec(source);
  if (!embedded) throw new Error("pdftocairo embedded wasm is missing");
  converterModule ??= await WebAssembly.compile(Buffer.from(embedded[1], "base64"));
  const create = require(CONVERTER);
  const mod = await create({ print: () => {}, printErr: () => {},
    instantiateWasm: (info, receiveInstance) => {
      const instance = new WebAssembly.Instance(converterModule, info);
      receiveInstance(instance, converterModule);
      return instance.exports;
    },
  });
  mod.FS.writeFile("input.pdf", pdfBytes);
  const rc = mod.callMain(["-svg", "input.pdf", "output.svg"]);
  const svg = Buffer.from(mod.FS.readFile("output.svg"));
  if (rc !== 0 || svg.length === 0) throw new Error("pdftocairo conversion failed");
  return { rc, svgBytes: svg.length, sha256: sha256(svg), svg };
}

function logPages(log, pdfBytes) {
  const m = /Output written on \S+ \((\d+) pages?, (\d+) bytes\)/.exec(log || "");
  if (!m) return { pages: 0, logBytes: 0, bytesMatch: false };
  return { pages: +m[1], logBytes: +m[2], bytesMatch: +m[2] === pdfBytes };
}
const realNotFound = (log) => log.split("\n").filter((l) => /^!.*\b(?:not found|can't find file)\b/i.test(l));
const warmGreen = (w) => w.meta.ok && w.meta.status === 0 && w.meta.pdfBytes > 0
  && w.pages >= 1 && w.bytesMatch;
const figPass = (r) => r.judgement.pass;

async function main() {
  let onlyArg = null;
  let check = false;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--check") check = true;
    else if (process.argv[i] === "--only" && process.argv[i + 1]) onlyArg = process.argv[++i];
    else throw new Error("usage: corpus-gate.mjs [--check] [--only <patterns>]");
  }
  if (check && onlyArg) throw new Error("--check requires the complete corpus");
  const onlyMatch = parseOnly(onlyArg);
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(path.join(OUTDIR, ERROR_FIG + ".tex"), ERROR_TEX);
  const texOf = (fig) => {
    const extension = path.join(W_CORPUS, fig + ".tex");
    return fs.existsSync(extension) ? extension : path.join(CORPUS, fig + ".tex");
  };
  const figs = onlyMatch ? FIGS.filter(onlyMatch) : FIGS;
  const cases = figs.map((fig) => ({ fig, texPath: texOf(fig) }));
  if (!onlyMatch || onlyMatch(ERROR_FIG)) cases.push({ fig: ERROR_FIG, texPath: path.join(OUTDIR, ERROR_FIG + ".tex") });
  if (onlyMatch && cases.length === 0) {
    console.error("error: --only matched no figures");
    process.exitCode = 2;
    return;
  }
  const expectations = JSON.parse(fs.readFileSync(EXPECT_FILE, "utf8")).cases;
  for (const fig of figs) if (!Object.hasOwn(expectations, fig))
    throw new Error(`missing corpus expectation: ${fig}`);
  const identities = NAMES.map((name) => {
    const bytes = fs.readFileSync(path.join(ASSET_DIR, name));
    return { name, bytes: bytes.length, sha256: sha256(bytes) };
  });
  const pinned = JSON.parse(fs.readFileSync(path.join(root, "toolchain.lock.json"), "utf8")).engineV1Assets["pdftocairo.js"];
  if (identities[2].bytes !== pinned.bytes || identities[2].sha256 !== pinned.sha256)
    throw new Error("pdftocairo does not match the pinned input");

  const rows = [];
  for (const c of cases) {
    const out = path.join(OUTDIR, c.fig);
    fs.writeFileSync(out + ".svg", Buffer.alloc(0));
    const start = performance.now();
    const meta = await drive(WORKER, fs.readFileSync(c.texPath, "utf8"), out);
    const log = fs.readFileSync(out + ".log", "utf8");
    const row = { fig: c.fig, meta, log, ...logPages(log, meta.pdfBytes) };
    if (meta.ok && meta.pdfBytes > 0) {
      try {
        const converted = await pdfToSvg(fs.readFileSync(out + ".pdf"));
        fs.writeFileSync(out + ".svg", converted.svg);
        row.svg = { rc: converted.rc, svgBytes: converted.svgBytes, sha256: converted.sha256 };
      } catch (error) { row.svg = { error: String(error) }; }
    }
    row.wallMs = performance.now() - start;
    fs.writeFileSync(out + ".meta.json", JSON.stringify({ ...meta, wallMs: row.wallMs, svg: row.svg }, null, 2) + "\n");
    console.log(JSON.stringify({ case: c.fig, wallMs: row.wallMs, svg: row.svg }));
    rows.push(row);
  }
  const checkDir = fs.mkdtempSync(path.join(OUTDIR, "check-results-"));
  for (const fig of figs) for (const ext of ["log", "pdf", "svg", "meta.json"])
    fs.copyFileSync(path.join(OUTDIR, fig + "." + ext), path.join(checkDir, fig + "." + ext));
  const selectedExpectations = { cases: Object.fromEntries(figs.map((fig) => [fig, expectations[fig]])) };
  const checkExpect = path.join(checkDir, "expectations.json");
  fs.writeFileSync(checkExpect, JSON.stringify(selectedExpectations, null, 2) + "\n");
  const checked = spawnSync("python3", [path.join(here, "check-results.py"), "--out", checkDir, "--expect", checkExpect], { encoding: "utf8" });
  if (checked.error || ![0, 1].includes(checked.status))
    throw new Error(`result checker failed: ${checked.error || checked.stderr}`);
  const judgements = JSON.parse(checked.stdout);
  for (const row of rows) if (row.fig !== ERROR_FIG) {
    if (!Object.hasOwn(judgements, row.fig)) throw new Error(`missing result verdict: ${row.fig}`);
    row.judgement = judgements[row.fig];
  }
  const warmOut = [1, 2].map((i) => path.join(OUTDIR, `warm-${WARM_FIG}.c${i}`));
  const warmSource = fs.readFileSync(texOf(WARM_FIG), "utf8");
  await driveWarm(WORKER, warmSource, warmSource, ...warmOut);
  const warm = warmOut.map((out) => {
    const meta = JSON.parse(fs.readFileSync(out + ".meta.json", "utf8"));
    const log = fs.readFileSync(out + ".log", "utf8");
    return { meta, log, ...logPages(log, meta.pdfBytes) };
  });
  const warmPass = warm.every(warmGreen) && warm.every((w) => realNotFound(w.log).length === 0);
  const figRows = rows.filter((r) => r.fig !== ERROR_FIG);
  const errRow = rows.find((r) => r.fig === ERROR_FIG);
  const errorPasses = !!errRow && !errRow.meta.ok && errRow.meta.status !== 0
    && /LaTeX Error|nonexistent-xyz|not found/i.test(errRow.log);
  const totalBytes = identities.reduce((s, a) => s + a.bytes, 0);
  const withinBudget = totalBytes <= 50 * 1024 * 1024;
  const allPass = figRows.every(figPass) && (!errRow || errorPasses) && withinBudget && warmPass;

  const lines = ["# Corpus gate", "", "Command: `node tests/corpus-gate.mjs --check`", "",
    `Figures: ${figRows.length}/${FIGS.length}. Closure members: ${assets.files.length}.`, "",
    "The release worker receives the complete format and closure in one init message.",
    "Elapsed times, PDF sizes and SVG conversion details are printed with each run.", "",
    "## Asset identities", "", "| asset | bytes | sha256 |", "|---|---:|---|",
    ...identities.map((a) => `| ${a.name} | ${a.bytes} | ${a.sha256} |`), "",
    "## Figure correctness", "",
    "The shared checker reads each saved log, PDF, SVG and metadata file. Success, declared limitations and expected compile failures use separate result criteria.", "",
    "| figure | expectation | reasons | verdict |",
    "|---|---|---|---|",
    ...figRows.map((r) => `| ${r.fig} | ${r.judgement.expect} | ${r.judgement.reasons.join(", ") || "none"} | ${figPass(r) ? "PASS" : "FAIL"} |`), "",
    "## Compile error path", "",
    `${ERROR_FIG}: ${!errRow ? "skipped (filtered run)" : errorPasses ? "PASS" : "FAIL"}.`,
    "A structured nonzero failure with a LaTeX error in its log is required.", "",
    "## Warm-worker scenario", "",
    `One instance compiles ${WARM_FIG} twice. Both compiles must pass the figure checks and have no file-not-found error lines.`, "",
    "| compile | verdict | ok | exit code | PDF nonempty | pages >= 1 | logged bytes match | file-not-found errors |",
    "|---|---|---|---:|---|---|---|---:|",
    ...warm.map((w, i) => `| ${i + 1} | ${warmGreen(w) && realNotFound(w.log).length === 0 ? "PASS" : "FAIL"} | ${w.meta.ok} | ${w.meta.status} | ${w.meta.pdfBytes > 0} | ${w.pages >= 1} | ${w.bytesMatch} | ${realNotFound(w.log).length} |`), "",
    "## Verdict", "", `- figures: ${figRows.filter(figPass).length}/${figRows.length} pass`,
    `- error path: ${!errRow ? "skipped (filtered run)" : errorPasses ? "PASS" : "FAIL"}`,
    `- warm-worker scenario: ${warmPass ? "PASS" : "FAIL"}`,
    `- size budget: ${withinBudget ? "PASS" : "FAIL"} (${totalBytes} / 52428800 bytes)`, "",
    `**Overall (${onlyArg ? "filtered run" : "full run"}): ${allPass ? "PASS" : "FAIL"}**`, ""];
  if (onlyArg) lines.splice(2, 0, `> FILTERED SUBSET RUN: --only ${onlyArg}.`, "");
  const record = lines.join("\n");
  if (check) {
    if (fs.readFileSync(GATE_MD, "utf8") !== record) throw new Error("corpus gate stable record differs; regenerate the complete record");
  } else fs.writeFileSync(GATE_MD, record);
  console.log(`Run: ${new Date().toISOString()}`);
  console.log(record);
  process.exitCode = allPass ? 0 : 1;
}

if (process.argv[2] === "--drive") {
  await drive(path.resolve(process.argv[3]), fs.readFileSync(process.argv[4], "utf8"), path.resolve(process.argv[5]));
} else if (process.argv[2] === "--drive-warm") {
  await driveWarm(path.resolve(process.argv[3]), fs.readFileSync(process.argv[4], "utf8"),
    fs.readFileSync(process.argv[5], "utf8"), path.resolve(process.argv[6]), path.resolve(process.argv[7]));
} else await main();
