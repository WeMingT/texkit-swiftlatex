#!/usr/bin/env node
// Re-embed a (stripped) wasm binary into an emscripten single-file JS glue as
// a base64 data URI, matching the vendored artifact's distribution shape.
// Usage: embed-wasm.js <in.js> <in.wasm> <out.js>
const fs = require("fs");
const [inJs, inWasm, outJs] = process.argv.slice(2);
if (!inJs || !inWasm || !outJs) {
  console.error("usage: embed-wasm.js <in.js> <in.wasm> <out.js>");
  process.exit(1);
}
let js = fs.readFileSync(inJs, "utf8");
const b64 = fs.readFileSync(inWasm).toString("base64");
const dataUri = "data:application/octet-stream;base64," + b64;
const marker = "var wasmBinaryFile;";
if (!js.includes(marker)) {
  console.error("marker not found in " + inJs);
  process.exit(1);
}
js = js.replace(marker, marker + " wasmBinaryFile = '" + dataUri + "';");
fs.writeFileSync(outJs, js);
console.log(outJs, fs.statSync(outJs).size, "bytes");
