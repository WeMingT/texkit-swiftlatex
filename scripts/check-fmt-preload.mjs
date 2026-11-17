// Check declared preloads against the complete format supply and closure.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

function main() {
  if (process.argv.length !== 4) throw new Error("usage: check-fmt-preload.mjs <meta.json> <closure-list>");
  const meta = JSON.parse(readFileSync(process.argv[2], "utf8"));
  if (!Array.isArray(meta.filesServedList) || meta.filesServedList.some((name) => typeof name !== "string"))
    throw new Error("filesServedList must contain file names");
  const served = new Set(meta.filesServedList);
  const closure = new Set(readFileSync(process.argv[3], "utf8").split("\n").map((line) => line.trim()).filter(Boolean));
  const declared = [];
  const inlined = [];
  const entries = [];
  const root = fileURLToPath(new URL("../", import.meta.url));
  const preloadPath = fileURLToPath(new URL("../closure/fmt-preload.txt", import.meta.url));
  for (const raw of readFileSync(preloadPath, "utf8").split("\n")) {
    const entry = raw.split("#")[0].trim();
    if (!entry) continue;
    const [kind, name, extra] = entry.split(":");
    if (!name || extra !== undefined || !["pkg", "lib", "inline"].includes(kind)) throw new Error(`invalid preload: ${entry}`);
    entries.push(entry);
    if (kind === "inline") {
      if (path.isAbsolute(name) || name.split("/").includes("..")) throw new Error(`invalid inline path: ${name}`);
      const bytes = readFileSync(path.join(root, name));
      const record = { path: name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
      const matches = (meta.inlined || []).filter((item) => item.path === name);
      if (matches.length !== 1 || matches[0].bytes !== record.bytes || matches[0].sha256 !== record.sha256)
        throw new Error(`inline metadata differs from source: ${name}`);
      if (closure.has(name) || closure.has(path.basename(name))) throw new Error(`inline file is a closure member: ${name}`);
      inlined.push(record);
      continue;
    }
    const filename = kind === "pkg" ? `${name}.sty` : `tikzlibrary${name}.code.tex`;
    if (!served.has(filename)) throw new Error(`declared preload was not supplied: ${filename}`);
    if (!closure.has(filename)) throw new Error(`declared preload is outside the closure: ${filename}`);
    declared.push(filename);
  }
  if (inlined.filter((item) => item.path === "closure/fmt-font-redirect.tex").length !== 1)
    throw new Error("missing inline:closure/fmt-font-redirect.tex preload");
  if (!Array.isArray(meta.inlined) || meta.inlined.length !== inlined.length)
    throw new Error("inline metadata has undeclared files");
  if (entries[0] !== "inline:closure/fmt-font-redirect.tex")
    throw new Error("font redirect must be the first preload");
  if (entries.indexOf("inline:closure/fmt-pgfplots-hint.tex") !== entries.indexOf("pkg:pgfplots") + 1)
    throw new Error("compatibility hint setting must follow pgfplots");
  if (JSON.stringify(meta.inlined) !== JSON.stringify(inlined))
    throw new Error("inline metadata order differs from preload order");
  console.log(JSON.stringify({ declared, inlined, filesServed: meta.filesServedList.length, checked: true }));
}
try { main(); } catch (error) { console.error(String(error)); process.exitCode = 1; }
