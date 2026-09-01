// Build swiftlatexpdftex.fmt on TeX Live 2025 via the worker's compileformat
// path (the same flow the upstream playground uses):
//
//   boot:  load build/swiftlatexpdftex.node.worker.js behind a fake `self` in
//          classic-script scope (rationale in tests/smoke-worker.mjs:
//          the vendored worker shape rejects require() under ESM)
//   build: send {cmd:"compileformat"} -> engine runs initex
//          (*pdflatex.ini -> pdftexconfig.tex -> latex.ltx -> \dump ->
//           /work/pdflatex.fmt). Every file request travels the harness
//          protocol {cmd:"downloadFromCTAN"} -> {cmd:"sendCTANFiles"} and is
//           answered from the LOCAL TeX Live 2025 tree via kpsewhich
//          (same mechanism as the smoke closure supply).
//   out:   the reply's `pdf` field IS the format file (upstream reuses the
//          compile reply channel for fmt bytes; compileFormatRoutine in the
//          patched pre.js) -> <out>.fmt + <out>.meta.json.
//
// Determinism note: storefmtfile() embeds \year/\month/\day in the format
// banner and the eqtb dump carries the date/time registers, so two builds on
// different wall-clock times can differ. build-fmt.sh double-builds and
// byte-compares; FMT_PIN_DATE (below) is the documented knob if the raw
// double-run is not byte-identical.
//
// Run: node scripts/build-fmt.mjs <outPrefix>
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const WORKER = process.env.FMT_WORKER
  ? path.resolve(process.env.FMT_WORKER)
  : path.join(root, "build", "swiftlatexpdftex.node.worker.js");
// Corpus knobs (A/B debugging): FMT_KPSE overrides the kpsewhich binary
// (e.g. the TL2024 one used by the spike), FMT_KPSE_MAP="from|to" rewrites
// the paths it returns (e.g. Windows drive-letter prefixes).
const KPSEWHICH = process.env.FMT_KPSE ||
  path.join(process.env.HOME, "texlive/2025/bin/x86_64-linux/kpsewhich");
const KPSE_MAP = (process.env.FMT_KPSE_MAP || "").split("|");
// When set (format "YYYY.M.D.minutes"), pdflatex.ini is served with the
// date/time registers pinned ahead of \input pdftexconfig.tex, making the
// dumped format clock-independent. Empty = stock pdflatex.ini.
const FMT_PIN_DATE = process.env.FMT_PIN_DATE || "";

// The fmt preload set. Single source — closure/fmt-preload.txt
// also drives the acceptance matrix. Empty/absent file = stock format.
const PRELOAD_LIST = path.join(root, "closure", "fmt-preload.txt");

function preloadTeX() {
  if (!fs.existsSync(PRELOAD_LIST)) return "";
  const pkgs = [];
  const libs = [];
  for (const raw of fs.readFileSync(PRELOAD_LIST, "utf8").split("\n")) {
    const entry = raw.split("#")[0].trim();
    if (!entry) continue;
    const colon = entry.indexOf(":");
    if (colon === -1) throw new Error(`fmt-preload.txt: malformed entry ${raw}`);
    const kind = entry.slice(0, colon);
    const name = entry.slice(colon + 1).trim();
    if (kind === "pkg") pkgs.push(name);
    else if (kind === "lib") libs.push(name);
    else throw new Error(`fmt-preload.txt: unknown entry kind ${raw}`);
  }
  if (libs.length > 0 && !pkgs.includes("tikz")) {
    throw new Error("fmt-preload.txt: lib: entries need pkg:tikz (usetikzlibrary requires tikz)");
  }
  const lines = [];
  for (const pkg of pkgs) lines.push(`\\RequirePackage{${pkg}}`);
  if (libs.length > 0) lines.push(`\\usetikzlibrary{${libs.join(",")}}`);
  return lines.join("\n");
}

const PRELOAD_TEX = preloadTeX();

async function buildFmt(outPrefix) {
  let readyResolve, compileResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  const compileDone = new Promise((r) => { compileResolve = r; });
  const state = { requested: [], served: [], missed: [], kpseMs: 0, pinned: !!FMT_PIN_DATE };
  let compileResult = null;

  const route = (data) => {
    if (data.result === "ok" && data.cmd === undefined) { readyResolve(); return; }
    if (data.cmd === "compile") {
      compileResult = {
        ok: data.result === "ok",
        status: data.status,
        log: data.log,
        fmt: data.pdf ? Buffer.from(data.pdf) : null,
      };
      compileResolve(compileResult);
      return;
    }
    if (data.cmd === "downloadFromCTAN") { serveKpse(data); return; }
    // writefile / mkdir / other acks: nothing to do
  };

  const selfFake = {
    postMessage: (data) => route(data),
    close: () => process.exit(0),
    mainfile: "main.tex",
    memlog: "",
  };
  globalThis.self = selfFake;
  const send = (data) => selfFake.onmessage({ data });
  const reply = (id, result, error) => send({ cmd: "sendCTANFiles", id, result, error });

  function serveKpse({ filename, id }) {
    if (process.env.FMT_TRACE) console.error(`[kpse] ${filename}`);
    state.requested.push(filename);
    const m = new Map();
    try {
      let bytes = null;
      if (filename.endsWith(".fmt")) {
        // iniTeX builds a format; it must not ask for one. Nothing to serve —
        // recorded as a miss so a regression shows up in the meta.
      } else if (filename === "pdflatex.ini" && FMT_PIN_DATE) {
        const stock = fs.readFileSync(kpsewhich("pdflatex.ini"));
        // Preamble runs before pdftexconfig.tex / latex.ltx can redefine
        // anything; \dump leaves these register values in eqtb and the
        // format banner (storefmtfile prints \year.\month.\day).
        const [y, mo, d, mi] = FMT_PIN_DATE.split(".");
        const pre = `\\year=${y} \\month=${mo} \\day=${d}` +
          (mi !== undefined ? ` \\time=${mi}` : "") + "\n";
        bytes = Buffer.concat([Buffer.from(pre, "utf8"), stock]);
      } else if (filename === "latex.ltx" && PRELOAD_TEX !== "") {
        // Inject the preload block right before latex.ltx's final \dump so
        // the packages load INSIDE the format: classless \RequirePackage is
        // the legal format-generation form, \makeatother has already
        // restored normal catcodes, and the package machinery is complete
        // at the tail of latex.ltx. Fail loudly if the layout surprises us
        // — silently building a format WITHOUT the preload would ship a
        // slow engine that passes every gate.
        const stock = fs.readFileSync(kpsewhich("latex.ltx"), "utf8");
        const at = stock.lastIndexOf("\\dump");
        if (at === -1) {
          throw new Error("latex.ltx carries no \\dump — preload injection point missing");
        }
        bytes = Buffer.from(stock.slice(0, at) + PRELOAD_TEX + "\n" + stock.slice(at), "utf8");
      } else {
        const loc = kpsewhich(filename);
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

  function kpsewhich(filename) {
    const t = Date.now();
    const res = spawnSync(KPSEWHICH, ["-progname=pdflatex", filename], { timeout: 60000 });
    state.kpseMs += Date.now() - t;
    if (res.status !== 0) return "";
    let loc = res.stdout.toString().trim();
    if (KPSE_MAP.length === 2) loc = loc.replaceAll(KPSE_MAP[0], KPSE_MAP[1]);
    return loc;
  }

  const t0 = Date.now();
  const workerSrc = fs.readFileSync(WORKER, "utf8");
  const workerRequire = createRequire(WORKER);
  new Function("require", "module", "exports", "__filename", "__dirname", workerSrc)(
    workerRequire, { exports: {} }, {}, WORKER, path.dirname(WORKER));
  await ready;
  const bootMs = Date.now() - t0;

  send({ cmd: "compileformat" });
  const watchdog = new Promise((_, rej) => setTimeout(() => rej(new Error("compileformat watchdog (15 min)")), 900000));
  const r = await Promise.race([compileDone, watchdog]);
  const buildMs = Date.now() - t0 - bootMs;

  if (!r.ok || !r.fmt) {
    fs.writeFileSync(outPrefix + ".log", r.log || "");
    console.error(`[build-fmt] FAILED status=${r.status} log -> ${outPrefix}.log`);
    console.error((r.log || "").slice(-3000));
    process.exit(2);
  }
  fs.writeFileSync(outPrefix + ".fmt", r.fmt);
  fs.writeFileSync(outPrefix + ".log", r.log || "");
  fs.writeFileSync(outPrefix + ".meta.json", JSON.stringify({
    worker: WORKER, pinned: state.pinned, fmtBytes: r.fmt.length,
    sha256: createHash("sha256").update(r.fmt).digest("hex"),
    filesRequested: state.requested.length, filesServed: state.served.length,
    filesMissed: state.missed,
    filesServedList: [...state.served],
    bootMs, buildMs, kpseMs: state.kpseMs,
  }, null, 2));
  console.error(`[build-fmt] ok fmt=${r.fmt.length}B files=${state.served.length}/${state.requested.length} missed=${state.missed.length} build=${buildMs}ms kpse=${state.kpseMs}ms`);
  // The loaded engine keeps the node event loop alive — exit explicitly.
  process.exit(0);
}

await buildFmt(path.resolve(process.argv[2] || path.join(root, "build", "fmt-out", "fmt-run")));
