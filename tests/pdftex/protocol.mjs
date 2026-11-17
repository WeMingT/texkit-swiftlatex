// Run the portable suite with the thread-based classic-script worker host.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { startWorker } from "./worker-host.mjs";
import { cases } from "./protocol-suite.mjs";

export function loadAssets(closure, fmt) {
  const archive = gunzipSync(readFileSync(closure));
  const files = [];
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    if (header.toString("ascii", 257, 262) !== "ustar") throw new Error("closure requires ustar");
    const field = (a, b) => header.toString("utf8", a, b).split("\0")[0];
    const size = Number.parseInt(field(124, 136).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > archive.length)
      throw new Error("truncated closure");
    if (header[156] === 0 || header[156] === 48) {
      const prefix = field(345, 500);
      const name = (prefix ? prefix + "/" : "") + field(0, 100);
      files.push([name.replace(/^\.\//, ""), new Uint8Array(archive.subarray(offset + 512, offset + 512 + size))]);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return { files, fmt: new Uint8Array(readFileSync(fmt)) };
}

async function main() {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (!["--only", "--worker", "--closure", "--fmt"].includes(key) || !process.argv[i + 1])
      throw new Error(`invalid option ${key}`);
    options[key.slice(2)] = process.argv[i + 1];
  }
  for (const key of ["worker", "closure", "fmt"]) if (!options[key]) throw new Error(`missing --${key}`);
  const assets = loadAssets(resolve(options.closure), resolve(options.fmt));
  const selected = options.only ? options.only.split(",") : cases.map((c) => c.id);
  if (selected.some((id) => !cases.some((c) => c.id === id))) throw new Error("unknown case id");
  const results = [];
  for (const test of cases.filter((c) => selected.includes(c.id))) {
    const start = performance.now();
    try {
      await test.run({ ...assets, startWorker: () => startWorker(resolve(options.worker), { fixtures: test.fixtures }) });
      results.push({ id: test.id, passed: true, wallMs: performance.now() - start });
      console.log(`PASS ${test.id}`);
    } catch (error) {
      results.push({ id: test.id, passed: false, error: String(error) });
      console.error(`FAIL ${test.id}: ${error}`);
      break;
    }
  }
  console.log(JSON.stringify({ worker: options.worker, results }));
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
