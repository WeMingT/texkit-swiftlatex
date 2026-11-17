// Build a pinned format synchronously with local TeX Live file supply.
// Run: node scripts/build-fmt.mjs <outPrefix>
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKER = process.env.FMT_WORKER
  ? path.resolve(process.env.FMT_WORKER)
  : path.join(root, "build", "engine-v2", "swiftlatexpdftex.node.worker.js");
// YYYY.M.D.minutes pins the format's date/time registers.
const FMT_PIN_DATE = process.env.FMT_PIN_DATE || "";
const PRELOAD_LIST = path.join(root, "closure", "fmt-preload.txt");
const INLINED = [];

function preloadTeX() {
  if (!fs.existsSync(PRELOAD_LIST)) return Buffer.alloc(0);
  const chunks = [];
  const pkgs = [];
  const libs = [];
  for (const raw of fs.readFileSync(PRELOAD_LIST, "utf8").split("\n")) {
    const entry = raw.split("#")[0].trim();
    if (!entry) continue;
    const colon = entry.indexOf(":");
    if (colon === -1) throw new Error(`fmt-preload.txt: malformed entry ${raw}`);
    const kind = entry.slice(0, colon);
    const name = entry.slice(colon + 1).trim();
    if (kind === "pkg") {
      pkgs.push(name);
      chunks.push(Buffer.from(`\\RequirePackage{${name}}\n`));
    }
    else if (kind === "lib") {
      libs.push(name);
      chunks.push(Buffer.from(`\\usetikzlibrary{${name}}\n`));
    }
    else if (kind === "inline") {
      if (!name || path.isAbsolute(name) || name.split("/").includes(".."))
        throw new Error(`fmt-preload.txt: invalid inline path ${name}`);
      const bytes = fs.readFileSync(path.join(root, name));
      chunks.push(bytes, Buffer.from("\n"));
      INLINED.push({ path: name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    else throw new Error(`fmt-preload.txt: unknown entry kind ${raw}`);
  }
  if (libs.length > 0 && !pkgs.includes("tikz")) {
    throw new Error("fmt-preload.txt: lib: entries need pkg:tikz (usetikzlibrary requires tikz)");
  }
  return Buffer.concat(chunks);
}
const PRELOAD_TEX = preloadTeX();

function transform(filename, stock) {
  if (filename === "pdflatex.ini" && FMT_PIN_DATE) {
    const [y, mo, d, mi] = FMT_PIN_DATE.split(".");
    const pre = `\\year=${y} \\month=${mo} \\day=${d}` +
      (mi !== undefined ? ` \\time=${mi}` : "") + "\n";
    return Buffer.concat([Buffer.from(pre, "utf8"), stock]);
  }
  if (filename === "latex.ltx" && PRELOAD_TEX.length !== 0) {
    const at = stock.lastIndexOf("\\dump");
    if (at === -1) throw new Error("latex.ltx carries no \\dump — preload injection point missing");
    return Buffer.concat([stock.subarray(0, at), PRELOAD_TEX, Buffer.from("\n"), stock.subarray(at)]);
  }
  return stock;
}

async function buildFmt(outPrefix) {
  globalThis.self = { postMessage() {}, close() {} };
  globalThis.texkitFormatTransform = transform;
  const workerRequire = createRequire(WORKER);
  const begin = performance.now();
  new Function("require", "module", "exports", "__filename", "__dirname", fs.readFileSync(WORKER, "utf8"))(
    workerRequire, { exports: {} }, {}, WORKER, path.dirname(WORKER));
  await globalThis.texkitFormatReady;
  const bootMs = performance.now() - begin;
  const buildBegin = performance.now();
  const result = globalThis.texkitCompileFormat();
  const buildMs = performance.now() - buildBegin;
  fs.writeFileSync(outPrefix + ".log", result.log);
  if (result.status !== 0 || !result.fmt.byteLength) {
    console.error(`[build-fmt] FAILED status=${result.status} log -> ${outPrefix}.log`);
    console.error(result.log.slice(-3000));
    process.exitCode = 2;
    return;
  }
  fs.writeFileSync(outPrefix + ".fmt", result.fmt);
  fs.writeFileSync(outPrefix + ".meta.json", JSON.stringify({
    worker: WORKER, pinned: !!FMT_PIN_DATE, fmtBytes: result.fmt.byteLength,
    sha256: createHash("sha256").update(result.fmt).digest("hex"),
    filesServed: result.served.length, filesServedList: result.served,
    inlined: INLINED,
    bootMs, buildMs,
  }, null, 2) + "\n");
  console.error(`[build-fmt] ok fmt=${result.fmt.byteLength}B files=${result.served.length} build=${buildMs}ms`);
}
await buildFmt(path.resolve(process.argv[2] || path.join(root, "build", "engine-v2", "fmt-out", "fmt-run")));
