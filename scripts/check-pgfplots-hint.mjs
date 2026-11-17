// Check the format's default hint setting and the document override.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startWorker } from "../tests/pdftex/worker-host.mjs";
import { loadAssets } from "../tests/pdftex/protocol.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.resolve(process.argv[2] || path.join(root, "build/engine-v2"));
const output = path.resolve(process.argv[3] || path.join(root, "build/pgfplots-hint-check"));
fs.mkdirSync(output, { recursive: true });
const assets = loadAssets(path.join(directory, "texfiles.tar.gz"), path.join(directory, "swiftlatexpdftex.fmt"));
const cases = [
  { name: "tikz-only", hint: false, preamble: "\\usepackage{tikz}", body: "\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}" },
  { name: "pgfplots-default", hint: false, preamble: "\\usepackage{pgfplots}", body: "\\begin{tikzpicture}\\begin{axis}\\addplot coordinates {(0,0) (1,1)};\\end{axis}\\end{tikzpicture}" },
  { name: "pgfplots-opt-in", hint: true, preamble: "\\usepackage{pgfplots}\n\\pgfplotsset{compat/show suggested version=true}", body: "\\begin{tikzpicture}\\begin{axis}\\addplot coordinates {(0,0) (1,1)};\\end{axis}\\end{tikzpicture}" },
];
const results = [];
for (const c of cases) {
  const source = `\\documentclass{article}\n${c.preamble}\n\\begin{document}\n${c.body}\n\\end{document}\n`;
  const host = startWorker(path.join(directory, "swiftlatexpdftex.worker.js"));
  try {
    const fmt = assets.fmt.slice().buffer;
    const files = assets.files.map(([name, bytes]) => [name, bytes.slice().buffer]);
    host.post({ type: "init", fmt, files }, [fmt, ...files.map(([, bytes]) => bytes)]);
    await host.next("ready");
    host.post({ type: "compile", id: 0, source });
    const result = await host.next("result");
    const log = result.log || "";
    const hint = /Package pgfplots Warning: running in backwards compatibility mode/.test(log);
    const compiled = result.id === 0 && result.status === "ok" && result.exitCode === 0 && result.pdf?.byteLength > 0;
    const record = { case: c.name, compiled, expectedHint: c.hint, hint, pass: compiled && hint === c.hint };
    results.push(record);
    const prefix = path.join(output, c.name);
    fs.writeFileSync(prefix + ".tex", source);
    fs.writeFileSync(prefix + ".log", log);
    fs.writeFileSync(prefix + ".pdf", result.pdf ? Buffer.from(result.pdf) : Buffer.alloc(0));
    console.log(JSON.stringify(record));
  } finally { await host.terminate(); }
}
fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
process.exitCode = results.every((r) => r.pass) ? 0 : 1;
