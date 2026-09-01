// Smoke test: new pdftocairo build vs vendored (spike harness) baseline.
// Node-only: the wasm needs a real engine, and emcc's node+web+worker glue
// runs fine under node. Asserts the SVG output of the new build is
// byte-identical to the vendored module's output (harness/output.svg),
// for both the unstripped and the stripped (release) wasm.
//
// Run: node tests/smoke.mjs
//
// One conversion per Module instance: pdftocairo's main() mutates static
// state (utils/pdftocairo.cc L995 `useCropBox = !noCrop` leaves it true
// after a successful run), so a second callMain on the same instance fails
// arg validation with exit(99). Path B pins unmodified upstream sources,
// so the contract is: fresh Module per conversion (plugin-side note).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(import.meta.url);

const PDF = path.join(here, "spike-harness", "output.pdf");
const BASELINE_SVG = path.join(here, "spike-harness", "output.svg");
const NEW_JS = path.join(root, "build", "out", "pdftocairo.stripped.js");
const WASMS = {
  stripped: path.join(root, "build", "out", "pdftocairo.stripped.wasm"),
  unstripped: path.join(root, "build", "out", "pdftocairo.wasm"),
};

const pdf = fs.readFileSync(PDF);
const baseline = fs.readFileSync(BASELINE_SVG);

// Instantiate the single-file artifact's JS glue, feeding the wasm bytes via
// `instantiateWasm` (part of the default INCOMING_MODULE_JS_API; emsdk 6.x
// dropped `Module.wasmBinary` from that default list). Under node the
// embedded base64 data URI cannot be read by the node path of the glue
// (node uses fs, only browsers fetch it) — the browser-side load of the
// single-file artifact is covered by the procedure in compare.md.
// WebAssembly.instantiate(bytes, imports) resolves to {module, instance};
// the glue callback expects the Instance itself.
async function convert(wasmPath) {
  const create = require(NEW_JS);
  const wasmBinary = fs.readFileSync(wasmPath);
  const mod = await create({
    print: () => {},
    printErr: () => {},
    instantiateWasm: (info, receiveInstance) => {
      WebAssembly.instantiate(wasmBinary, info).then((r) => receiveInstance(r.instance));
    },
  });
  mod.FS.writeFile("input.pdf", pdf);
  const rc = mod.callMain(["-svg", "input.pdf", "output.svg"]);
  const svg = mod.FS.readFile("output.svg", { encoding: "utf8" });
  return { rc, svg: Buffer.from(svg, "utf8") };
}

// Single-file artifact self-load: no instantiateWasm override, no external
// wasm — the glue must fetch and instantiate its own embedded base64 data
// URI. This exercises the actual browser load path (fetch + ArrayBuffer
// fallback after instantiateStreaming rejects the octet-stream MIME) under
// node: undici's fetch supports data: URLs. The glue's web branch is selected
// by making its `process.versions.node` check falsy (must stay a string for
// undici's internals). Run last: it spoofs process.versions for the rest of
// the process.
async function convertSingleFile() {
  Object.defineProperty(process.versions, "node", { value: "" });
  globalThis.window = {};
  const create = require(NEW_JS);
  const mod = await create({ print: () => {}, printErr: () => {} });
  mod.FS.writeFile("input.pdf", pdf);
  const rc = mod.callMain(["-svg", "input.pdf", "output.svg"]);
  const svg = mod.FS.readFile("output.svg", { encoding: "utf8" });
  return { rc, svg: Buffer.from(svg, "utf8") };
}

const t0 = Date.now();
const runs = {};
for (const [name, wasm] of Object.entries(WASMS)) {
  const t = Date.now();
  runs[name] = await convert(wasm);
  runs[name].ms = Date.now() - t;
}
{
  const t = Date.now();
  runs.singlefile = await convertSingleFile();
  runs.singlefile.ms = Date.now() - t;
}

fs.writeFileSync(path.join(here, "new-output.svg"), runs.singlefile.svg);

const verdict = {
  artifactJs: fs.statSync(NEW_JS).size,
  artifactWasm: fs.statSync(WASMS.stripped).size,
  baselineBytes: baseline.length,
  runs: Object.fromEntries(
    Object.entries(runs).map(([k, r]) => [
      k,
      { rc: r.rc, ms: r.ms, svgBytes: r.svg.length },
    ]),
  ),
  strippedByteIdenticalToVendored: Buffer.compare(runs.stripped.svg, baseline) === 0,
  unstrippedByteIdenticalToVendored: Buffer.compare(runs.unstripped.svg, baseline) === 0,
  strippedIdenticalToUnstripped: Buffer.compare(runs.stripped.svg, runs.unstripped.svg) === 0,
  singleFileSelfLoadedByteIdenticalToVendored: Buffer.compare(runs.singlefile.svg, baseline) === 0,
};

console.log(JSON.stringify(verdict, null, 2));
fs.writeFileSync(path.join(here, "smoke-result.json"), JSON.stringify(verdict, null, 2) + "\n");
process.exit(
  verdict.strippedByteIdenticalToVendored &&
    verdict.unstrippedByteIdenticalToVendored &&
    verdict.strippedIdenticalToUnstripped &&
    verdict.singleFileSelfLoadedByteIdenticalToVendored &&
    runs.stripped.rc === 0 &&
    runs.unstripped.rc === 0 &&
    runs.singlefile.rc === 0
    ? 0
    : 1,
);
