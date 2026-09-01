// Smoke: new swiftlatexpdftex worker vs the vendored (spike harness) worker.
//
// Both workers run the SAME harness flow in-process (fake `self`, classic
// script scope): writefile main.tex (spike input.tex) -> setmainfile ->
// compilelatex, with file supply over the harness postMessage protocol:
//   {cmd:"downloadFromCTAN", filename, id}  <->  {cmd:"sendCTANFiles", id, result: Map, error}
// .fmt comes from the vendored harness fmt; every other file is resolved with
// the local TeXLive 2025 kpsewhich (the spike browser harness used TL2024).
// Each worker runs in its own child process (global `self` isolation).
//
// Verdict gates:
//   AB     — SVG(new worker) byte-identical to SVG(vendored worker) under the
//            same fmt + closure: proves the source build == vendored build.
//   base   — SVG(new worker) vs the spike browser baseline output.svg
//            (recorded; may legitimately differ through TL2025-vs-TL2024
//             closure drift — see compare-worker.md before judging).
// PDFs are structurally compared only (pdfTeX embeds timestamps/IDs; the
// probe report proved same-source compiles are never byte-identical).
//
// Run: node tests/smoke-worker.mjs           (orchestrator)
//      node tests/smoke-worker.mjs --drive <worker.js> <outPrefix>
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const root = path.resolve(here, "..");
// Spike harness baselines, vendored in-repo (input.tex, output.svg,
// output.pdf — verbatim copies from the spike harness run).
const SPIKE = path.join(here, "spike-harness");
const TEX = fs.readFileSync(path.join(SPIKE, "input.tex"), "utf8");
// The spike-era vendored engine pair (TL2024 worker + fmt) is NOT carried
// in this repository (~20 MB of historical binaries). Point SMOKE_FMT /
// SPIKE_WORKER at a local copy to run the new-vs-vendored comparison.
const FMT_FILE = process.env.SMOKE_FMT
  ? path.resolve(process.env.SMOKE_FMT)
  : path.join(SPIKE, "swiftlatexpdftex.fmt");
const BASELINE_SVG = fs.readFileSync(path.join(SPIKE, "output.svg"));
const BASELINE_PDF = fs.readFileSync(path.join(SPIKE, "output.pdf"));
const VENDORED_WORKER = process.env.SPIKE_WORKER
  ? path.resolve(process.env.SPIKE_WORKER)
  : path.join(SPIKE, "swiftlatexpdftex.worker.js"); // node-env variant
const NEW_WORKER = path.join(root, "build", "swiftlatexpdftex.node.worker.js");
const KPSEWHICH = path.join(process.env.HOME, "texlive/2025/bin/x86_64-linux/kpsewhich");
const OUTDIR = process.env.SMOKE_OUT
  ? path.resolve(process.env.SMOKE_OUT)
  : path.join(here, "worker-out");

// ---------------------------------------------------------------- driver ---
async function drive(workerPath, outPrefix) {
  let readyResolve, compileResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  const state = {
    requested: [], served: [], missed: [],
    kpseMs: 0, bootMs: 0, compileMs: 0,
  };
  let compileResult = null;
  const compileDone = new Promise((r) => { compileResolve = r; });

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
    if (cmd === "downloadFromCTAN") { serveKpse(data); return; }
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

  function reply(id, result, error) {
    send({ cmd: "sendCTANFiles", id, result, error });
  }

  function serveKpse({ filename, id }) {
    if (process.env.SMOKE_TRACE) console.error(`[kpse ${(Date.now() - t0) / 1000 | 0}s] ${filename}`);
    state.requested.push(filename);
    const m = new Map();
    try {
      let bytes = null;
      if (filename.endsWith(".fmt")) {
        bytes = fs.readFileSync(FMT_FILE);
      } else {
        const t = Date.now();
        const res = spawnSync(KPSEWHICH, ["-progname=pdflatex", filename], { timeout: 60000 });
        state.kpseMs += Date.now() - t;
        const loc = res.status === 0 ? res.stdout.toString().trim() : "";
        if (loc) bytes = fs.readFileSync(loc);
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

  const t0 = Date.now();
  // Load the worker as a classic script. The vendored worker sits in a
  // "type": "module" package (require() would reject its bare `require`), so
  // both workers are evaluated in a CJS-shaped scope instead.
  const workerSrc = fs.readFileSync(workerPath, "utf8");
  const workerRequire = createRequire(workerPath);
  new Function("require", "module", "exports", "__filename", "__dirname", workerSrc)(
    workerRequire, { exports: {} }, {}, workerPath, path.dirname(workerPath));
  await ready;
  state.bootMs = Date.now() - t0;

  // harness main flow (index.html): writefile, setmainfile, compilelatex
  send({ cmd: "writefile", url: "main.tex", src: TEX });
  send({ cmd: "setmainfile", url: "main.tex" });
  const tc = Date.now();
  send({ cmd: "compilelatex" });
  const watchdog = new Promise((_, rej) => setTimeout(() => rej(new Error("compile watchdog (10 min)")), 600000));
  const r = await Promise.race([compileDone, watchdog]);
  state.compileMs = Date.now() - tc;

  fs.writeFileSync(outPrefix + ".pdf", r.pdf || Buffer.alloc(0));
  fs.writeFileSync(outPrefix + ".log", r.log || "");
  fs.writeFileSync(outPrefix + ".meta.json", JSON.stringify({
    worker: workerPath, ok: r.ok, status: r.status, pdfBytes: r.pdf ? r.pdf.length : 0,
    filesRequested: state.requested.length, filesServed: state.served.length,
    filesMissed: state.missed, bootMs: state.bootMs, compileMs: state.compileMs,
    kpseMs: state.kpseMs,
  }, null, 2));
  console.error(`[drive] ${path.basename(workerPath)} ok=${r.ok} status=${r.status} pdf=${r.pdf ? r.pdf.length : 0}B files=${state.served.length}/${state.requested.length} compile=${state.compileMs}ms`);
  if (!r.ok) {
    console.error((r.log || "").slice(-2500));
  }
  // The loaded engine keeps the node event loop alive — exit explicitly or
  // the parent's spawnSync waits out its full timeout.
  process.exit(r.ok ? 0 : 2);
}

// ---------------------------------------------------------- pdftocairo ------
// Pattern: instantiate the single-file artifact's factory, feed the wasm
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

// ------------------------------------------------------------ orchestrator --
function pdfStructure(buf) {
  const s = buf.toString("latin1");
  return {
    bytes: buf.length,
    objects: (s.match(/\d+ 0 obj/g) || []).length,
    pages: (s.match(/\/Type\s*\/Page[^s]/g) || []).length,
    mediaBox: (s.match(/\/MediaBox\s*\[[^\]]*\]/) || [""])[0].trim(),
    fonts: (s.match(/\/BaseFont\s*\/[A-Za-z0-9+\-]+/g) || []).sort(),
  };
}

async function main() {
  for (const p of [VENDORED_WORKER, FMT_FILE]) {
    if (!fs.existsSync(p)) {
      console.error(`error: vendored spike artifact missing: ${p}
This tool compares the current build against the spike-era (TL2024)
vendored pair, which is not carried in the repository. Provide it via
SPIKE_WORKER=<swiftlatexpdftex.worker.js> and/or SMOKE_FMT=<swiftlatexpdftex.fmt>.`);
      process.exit(2);
    }
  }
  fs.mkdirSync(OUTDIR, { recursive: true });
  const runs = { new: {}, vendored: {} };
  for (const [name, worker] of Object.entries({ new: NEW_WORKER, vendored: VENDORED_WORKER })) {
    const t = Date.now();
    const out = path.join(OUTDIR, name);
    const r = spawnSync(process.execPath, [path.join(here, "smoke-worker.mjs"),
      "--drive", worker, out], { stdio: ["ignore", "ignore", "inherit"], timeout: 660000 });
    if (r.status !== 0) throw new Error(`driver for ${name} failed (exit ${r.status})`);
    runs[name].meta = JSON.parse(fs.readFileSync(out + ".meta.json", "utf8"));
    runs[name].wallMs = Date.now() - t;
  }

  const conv = {};
  for (const name of ["new", "vendored"]) {
    const t = Date.now();
    conv[name] = await pdfToSvg(fs.readFileSync(path.join(OUTDIR, name + ".pdf")));
    conv[name].ms = Date.now() - t;
    fs.writeFileSync(path.join(OUTDIR, name + ".svg"), conv[name].svg);
  }

  const eq = (a, b) => Buffer.compare(a, b) === 0;
  const newMeta = runs.new.meta, vendMeta = runs.vendored.meta;
  const verdict = {
    abSvgByteIdentical: eq(conv.new.svg, conv.vendored.svg),
    abLogByteIdentical: eq(
      fs.readFileSync(path.join(OUTDIR, "new.log")),
      fs.readFileSync(path.join(OUTDIR, "vendored.log"))),
    newVsBaselineSvgByteIdentical: eq(conv.new.svg, BASELINE_SVG),
    vendoredVsBaselineSvgByteIdentical: eq(conv.vendored.svg, BASELINE_SVG),
    svgBytes: { new: conv.new.svg.length, vendored: conv.vendored.svg.length, baseline: BASELINE_SVG.length },
    newSvgPathCount: (conv.new.svg.toString().match(/<path/g) || []).length,
    pdfStructure: {
      new: pdfStructure(fs.readFileSync(path.join(OUTDIR, "new.pdf"))),
      vendored: pdfStructure(fs.readFileSync(path.join(OUTDIR, "vendored.pdf"))),
      baseline: pdfStructure(BASELINE_PDF),
    },
    closure: {
      new: { served: newMeta.filesServed, requested: newMeta.filesRequested, missed: newMeta.filesMissed.length },
      vendored: { served: vendMeta.filesServed, requested: vendMeta.filesRequested, missed: vendMeta.filesMissed.length },
      identicalMisses: JSON.stringify(newMeta.filesMissed) === JSON.stringify(vendMeta.filesMissed),
    },
    compile: {
      new: { ok: newMeta.ok, status: newMeta.status, compileMs: newMeta.compileMs, bootMs: newMeta.bootMs, kpseMs: newMeta.kpseMs },
      vendored: { ok: vendMeta.ok, status: vendMeta.status, compileMs: vendMeta.compileMs, bootMs: vendMeta.bootMs, kpseMs: vendMeta.kpseMs },
    },
    pdftocairoRc: { new: conv.new.rc, vendored: conv.vendored.rc },
  };
  const pass = verdict.abSvgByteIdentical && newMeta.ok && vendMeta.ok;
  console.log(JSON.stringify(verdict, null, 2));
  fs.writeFileSync(path.join(OUTDIR, "smoke-worker-result.json"), JSON.stringify(verdict, null, 2) + "\n");
  process.exit(pass ? 0 : 1);
}

if (process.argv[2] === "--drive") {
  await drive(path.resolve(process.argv[3]), process.argv[4]);
} else {
  await main();
}
