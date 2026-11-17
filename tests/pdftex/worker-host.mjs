// Execute the release worker as a classic script in an isolated thread.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

// Retain compiled code in the parent while worker instances come and go.
// The complete script hash prevents reuse after an artifact is rebuilt.
const compiledModules = new Map();

export function startWorker(workerPath, { fixtures = [] } = {}) {
  const workerSource = readFileSync(workerPath, "utf8");
  const key = createHash("sha256").update(workerSource).digest("hex");
  const thread = new Worker(new URL(import.meta.url), {
    workerData: { workerPath, fixtures, workerSource, compiledModule: compiledModules.get(key) },
    resourceLimits: { maxYoungGenerationSizeMb: 8 },
  });
  const messages = [];
  const queued = [];
  const waiting = [];
  const fixtureWaiters = new Map();
  let sequence = 0;
  let failure;
  function fail(error) {
    failure = error;
    for (const waiter of waiting.splice(0)) waiter.reject(error);
    for (const waiter of fixtureWaiters.values()) waiter.reject(error);
    fixtureWaiters.clear();
  }
  thread.on("error", fail);
  thread.on("exit", (code) => { if (code !== 0) fail(new Error(`worker exited ${code}`)); });
  thread.on("message", (message) => {
    if (message.__compiledModule) { compiledModules.set(key, message.__compiledModule); return; }
    if (message.__fixtureReply !== undefined) {
      const waiter = fixtureWaiters.get(message.__fixtureReply);
      fixtureWaiters.delete(message.__fixtureReply);
      if (message.error) waiter?.reject(new Error(message.error));
      else waiter?.resolve(message.value);
      return;
    }
    messages.push(message);
    const index = waiting.findIndex((waiter) => waiter.type === message.type);
    if (index >= 0) waiting.splice(index, 1)[0].resolve(message);
    else queued.push(message);
  });
  return {
    messages,
    post(message, transfer = []) { thread.postMessage(message, transfer); },
    next(type) {
      if (failure) return Promise.reject(failure);
      const index = queued.findIndex((message) => message.type === type);
      if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve, reject };
        waiting.push(waiter);
        const timeout = setTimeout(() => {
          const index = waiting.indexOf(waiter);
          if (index >= 0) waiting.splice(index, 1);
          reject(new Error(`timeout waiting for ${type}`));
        }, 30000);
        waiter.resolve = (value) => { clearTimeout(timeout); resolve(value); };
        waiter.reject = (error) => { clearTimeout(timeout); reject(error); };
      });
    },
    fixture(name, ...args) {
      if (failure) return Promise.reject(failure);
      const id = sequence++;
      return new Promise((resolve, reject) => {
        fixtureWaiters.set(id, { resolve, reject });
        thread.postMessage({ __fixture: { id, name, args } });
      });
    },
    terminate() { return thread.terminate(); },
  };
}

if (!isMainThread) {
  globalThis.self = globalThis;
  globalThis.WorkerGlobalScope = class WorkerGlobalScope {};
  globalThis.location = { href: pathToFileURL(workerData.workerPath).href };
  globalThis.importScripts = () => { throw new Error("unexpected importScripts"); };
  globalThis.postMessage = (message, transfer = []) => parentPort.postMessage(message, transfer);
  globalThis.close = () => parentPort.close();
  const instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = async (bytes, imports, ...options) => {
    if (workerData.compiledModule) return { module: workerData.compiledModule,
      instance: await instantiate(workerData.compiledModule, imports) };
    const result = await instantiate(bytes, imports, ...options);
    parentPort.postMessage({ __compiledModule: result.module });
    return result;
  };
  const fixtures = installFixtures(workerData.fixtures);
  parentPort.on("message", async (message) => {
    if (message.__fixture) {
      const { id, name, args } = message.__fixture;
      try { parentPort.postMessage({ __fixtureReply: id, value: await fixtures(name, ...args) }); }
      catch (error) { parentPort.postMessage({ __fixtureReply: id, error: String(error) }); }
    } else globalThis.onmessage({ data: message });
  });
  runInThisContext(workerData.workerSource, { filename: workerData.workerPath });
}

// This function is also serialized into the browser test worker. It depends
// only on standard JavaScript APIs and the classic-script runtime globals.
export function installFixtures(allowed) {
  const g = globalThis;
  let releaseRuntime;
  let timingDuration = 0;
  let timingInstalled = false;
  let deviceSteps = [];
  if (allowed.includes("runtime-barrier")) {
    const gate = new Promise((resolve) => { releaseRuntime = resolve; });
    const original = WebAssembly.instantiate;
    WebAssembly.instantiate = async (...args) => {
      const result = await original(...args);
      await gate;
      return result;
    };
  }
  function wrapCompile(callback) {
    const original = g.Module._compileLaTeX;
    g.Module._compileLaTeX = g._compileLaTeX = (...args) => callback(original, args);
  }
  function wasmAbort() {
    // Release dlmalloc removes its abort checks. Enter the actual runtime's
    // abort path so the real onAbort hook and RuntimeError both execute.
    g.abort("fixture abort");
  }
  function workPaths(dir = "/work") {
    const paths = [];
    for (const name of g.FS.readdir(dir).filter((n) => n !== "." && n !== "..")) {
      const path = dir + "/" + name;
      paths.push(path);
      if (g.FS.isDir(g.FS.lstat(path).mode)) paths.push(...workPaths(path));
    }
    return paths.sort();
  }
  return async (name, ...args) => {
    if (name === "barrier") return true;
    if (name === "runtime-state" && allowed.includes("runtime-barrier"))
      return { ready: g.texkitRuntimeReady, queued: g.texkitQueue.length };
    if (name === "release-runtime" && allowed.includes("runtime-barrier")) { releaseRuntime(); return true; }
    if (!allowed.includes(name)) throw new Error(`fixture not enabled: ${name}`);
    if (name === "stream-count") return { streams: g.FS.streams.filter((s) => s && s.fd > 2).length, paths: workPaths() };
    if (name === "stack-pointer") return { current: g.stackSave(), snapshot: g.texkitStack };
    if (name === "tex-hash") {
      const result = [];
      for (const file of g.FS.readdir("/tex").filter((n) => n !== "." && n !== "..").sort()) {
        const bytes = g.FS.readFile("/tex/" + file);
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        result.push(file + ":" + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""));
      }
      return result.join("\n");
    }
    if (name === "abort-in-compile" && args[0] === "init") {
      const original = g.FS.writeFile;
      g.FS.writeFile = function(path, ...rest) {
        if (path === "/tex/swiftlatexpdftex.fmt") wasmAbort();
        return original.call(this, path, ...rest);
      };
    } else if (name === "abort-in-compile") {
      wrapCompile(() => { g.Module.print("before-fault"); wasmAbort(); });
    } else if (name === "trap-in-compile") {
      wrapCompile((original, values) => {
        g.Module.print("before-fault");
        g.stackRestore(g.wasmMemory.buffer.byteLength + 1048576);
        return original(...values);
      });
    } else if (name === "exception-in-compile") {
      wrapCompile(() => { g.Module.print("before-fault"); throw new Error("fixture exception"); });
    } else if (name === "drop-pdf") {
      const original = g.FS.readFile;
      g.FS.readFile = function(path, ...rest) {
        if (path === "/work/main.pdf") throw new Error("fixture PDF read failure");
        return original.call(this, path, ...rest);
      };
    } else if (name === "fail-prepare") {
      const original = g.FS.writeFile;
      g.FS.writeFile = function(path, ...rest) {
        if (path === "/work/main.tex") throw new Error("fixture prepare failure");
        return original.call(this, path, ...rest);
      };
    } else if (name === "fail-cleanup") {
      const original = g.FS.unlink;
      g.FS.unlink = function(path, ...rest) {
        if (path === "/work/main.tex") throw new Error("fixture cleanup failure");
        return original.call(this, path, ...rest);
      };
    } else if (name === "symlink-after-main") {
      const original = g.FS.writeFile;
      g.FS.writeFile = function(path, ...rest) {
        const result = original.call(this, path, ...rest);
        if (path === "/work/main.tex") g.FS.symlink("/tex", "/work/link");
        return result;
      };
    } else if (name === "device-write") {
      if (args[0] === "read") return deviceSteps;
      wrapCompile((original, values) => {
        deviceSteps = [];
        function record(step, returned) {
          deviceSteps.push({ step, guardActive: g.texkitInCompile === true,
            returned: returned === undefined ? { type: "undefined" } : returned });
          if (g.texkitInCompile !== true) throw new Error("device fixture outside compile guard");
        }
        record("compile-entry", true);
        const stream = g.FS.open("/dev/null", "w");
        record("open-null", { fd: stream.fd, path: g.FS.getPath(stream.node), flags: stream.flags });
        const bytes = new Uint8Array([1, 2, 3]);
        const written = g.FS.write(stream, bytes, 0, bytes.length);
        record("write-null", written);
        if (written !== bytes.length) throw new Error("short device write");
        record("close-null", g.FS.close(stream));
        const line = new TextEncoder().encode("device-fixture-stdout\n");
        const stdoutWritten = g.FS.write(g.FS.getStreamChecked(1), line, 0, line.length);
        record("write-stdout", stdoutWritten);
        if (stdoutWritten !== line.length) throw new Error("short stdout write");
        return original(...values);
      });
    } else if (name === "timing") {
      if (args[0] === "read") return timingDuration;
      if (!timingInstalled) {
        wrapCompile((original, values) => {
          const begin = performance.now();
          try { return original(...values); } finally { timingDuration = performance.now() - begin; }
        });
        timingInstalled = true;
      }
      return true;
    } else throw new Error(`unknown fixture ${name}`);
    return true;
  };
}
