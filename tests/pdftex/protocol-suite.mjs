// Environment-independent protocol checks against the release worker.
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
export function exactBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
export const basic = String.raw`\documentclass{article}
\begin{document}Protocol basic.\end{document}`;
export const texError = String.raw`\documentclass{article}
\begin{document}\undefinedProtocolCommand\end{document}`;
export async function initialize(ctx, host) {
  const fmt = exactBuffer(ctx.fmt);
  const files = ctx.files.map(([name, bytes]) => [name, exactBuffer(bytes)]);
  const transfer = [fmt, ...files.map(([, bytes]) => bytes)];
  host.post({ type: "init", fmt, files }, transfer);
  assert(transfer.every((buffer) => buffer.byteLength === 0), "init buffers must detach");
  const ready = await host.next("ready");
  assert(ready.type === "ready", "init must return ready");
  await host.fixture("barrier");
  assert(host.messages.filter((m) => m.type === "ready").length === 1, "one ready required");
  assert(host.messages.filter((m) => m.type === "result").length === 0, "init must not emit result");
}
export async function compile(host, id, source, files) {
  const request = { type: "compile", id, source };
  if (files !== undefined) request.files = files;
  const transfer = files?.map(([, bytes]) => bytes) ?? [];
  host.post(request, transfer);
  const result = await host.next("result");
  await host.fixture("barrier");
  assert(result.id === id, "result id must match request");
  assert(host.messages.filter((m) => m.type === "result" && m.id === id).length === 1,
    "compile must emit exactly one result");
  return result;
}
async function withWorker(ctx, run) {
  const host = ctx.startWorker();
  try { await run(host); } finally { await host.terminate(); }
}
export const cases = [
  { id: "init-ok", run: (ctx) => withWorker(ctx, (host) => initialize(ctx, host)) },
  { id: "compile-basic", run: (ctx) => withWorker(ctx, async (host) => {
    await initialize(ctx, host);
    const r = await compile(host, 1, basic);
    assert(r.status === "ok" && r.exitCode === 0, "basic must compile successfully");
    assert(r.pdf instanceof ArrayBuffer && r.pdf.byteLength > 0, "PDF must be nonempty");
    assert(r.log.includes("Output written"), "successful log required");
  }) },
  { id: "compile-tex-error", run: (ctx) => withWorker(ctx, async (host) => {
    await initialize(ctx, host);
    const r = await compile(host, 2, texError);
    assert(r.status === "tex-error" && r.exitCode !== 0, "TeX failure required");
    assert(r.pdf === null, "TeX failure must not return PDF");
    assert(r.log.includes("!"), "TeX diagnostic required");
  }) },
];

function initMessage(ctx) {
  return { type: "init", fmt: exactBuffer(ctx.fmt),
    files: ctx.files.map(([name, bytes]) => [name, exactBuffer(bytes)]) };
}
function engineError(r, reason, exitCode = null) {
  assert(r.status === "engine-error" && r.reason === reason && r.exitCode === exitCode && r.pdf === null,
    `expected ${reason}/${exitCode}, got ${JSON.stringify({ ...r, log: r.log?.slice(-500) })}`);
}
async function notReady(host, id = 999) {
  const r = await compile(host, id, basic);
  engineError(r, "not-ready");
  assert(r.log === "", "not-ready must have empty log");
}
async function initFailure(ctx, edit, fixtures = []) {
  const host = ctx.startWorker();
  try {
    const message = initMessage(ctx);
    if (fixtures.includes("abort-in-compile")) await host.fixture("abort-in-compile", "init");
    edit(message);
    host.post(message);
    const r = await host.next("init-error");
    assert(typeof r.message === "string" && r.message.length > 0, "init diagnostic required");
    await host.fixture("barrier");
    assert(host.messages.filter((m) => m.type === "init-error").length === 1, "one init-error required");
    assert(!host.messages.some((m) => m.type === "ready" || m.type === "result"), "invalid init must not emit ready/result");
    await notReady(host);
  } finally { await host.terminate(); }
}
function add(id, run, fixtures = []) { cases.push({ id, run, fixtures }); }
const character = "\u4e00";
const name256 = character.repeat(85) + "a";
const name257 = character.repeat(85) + "aa";

add("init-before-runtime", (ctx) => withWorker(ctx, async (host) => {
  const message = initMessage(ctx);
  host.post(message);
  host.post({ type: "compile", id: 1, source: basic });
  const before = await host.fixture("runtime-state");
  assert(before.ready === false && before.queued === 2, "init and compile must queue before runtime");
  await host.fixture("release-runtime");
  await host.next("ready");
  const r = await host.next("result");
  assert(r.id === 1 && r.status === "ok", "queued compile must follow successful init");
  await host.fixture("barrier");
  assert(host.messages.length === 2 && host.messages[0].type === "ready", "FIFO and unique results required");
}), ["runtime-barrier"]);
for (const [id, edit] of [
  ["init-empty-fmt", (m) => { m.fmt = new ArrayBuffer(0); }],
  ["init-fmt-view", (m) => { m.fmt = new Uint8Array(m.fmt); }],
  ["init-member-view", (m) => { m.files[0][1] = new Uint8Array(m.files[0][1]); }],
  ["init-shared-buffer", (m) => { m.fmt = new SharedArrayBuffer(8); }],
  ...[["empty", ""], ["slash", "a/b"], ["backslash", "a\\b"], ["nul", "a\0b"],
    ["dot", "."], ["dotdot", ".."], ["fmt", "swiftlatexpdftex.fmt"], ["utf8-257", name257]]
    .map(([id, name]) => [`init-name-${id}`, (m) => { m.files.push([name, new ArrayBuffer(0)]); }]),
  ["init-name-duplicate", (m) => { m.files.push(m.files[0]); }],
]) add(id, (ctx) => initFailure(ctx, edit));
for (const [id, name] of [["init-name-utf8-256", name256], ["init-zero-byte-member", "zero.tex"]]) {
  add(id, (ctx) => withWorker(ctx, async (host) => {
    const m = initMessage(ctx); m.files.push([name, new ArrayBuffer(0)]);
    host.post(m); await host.next("ready"); await host.fixture("barrier");
    assert(host.messages.length === 1, "valid init must emit exactly one ready");
  }));
}
add("init-second", (ctx) => withWorker(ctx, async (host) => {
  await initialize(ctx, host);
  const before = await host.fixture("tex-hash");
  const m = initMessage(ctx); m.fmt = new Uint8Array([1]).buffer;
  host.post(m); await host.next("init-error"); await host.fixture("barrier");
  assert(await host.fixture("tex-hash") === before, "second init must preserve mounted bytes");
  assert(host.messages.filter((m) => m.type === "init-error").length === 1, "one second-init error required");
  await notReady(host);
}), ["tex-hash"]);
add("init-abort", (ctx) => initFailure(ctx, () => {}, ["abort-in-compile"]), ["abort-in-compile"]);
add("compile-before-init", (ctx) => withWorker(ctx, (host) => notReady(host)));

const invalidRequests = [
  ["compile-id-negative", (m) => { m.id = -1; }],
  ["compile-id-float", (m) => { m.id = 1.5; }],
  ["compile-id-missing", (m) => { delete m.id; }],
  ["compile-source-not-string", (m) => { m.source = 42; }],
  ["compile-files-not-array", (m) => { m.files = {}; }],
  ["compile-file-bytes-view", (m) => { m.files = [["extra.tex", new Uint8Array(8)]]; }],
  ...[["empty", ""], ["absolute", "/tmp/a"], ["backslash", "a\\b"], ["nul", "a\0b"],
    ["empty-segment", "a//b"], ["dot", "a/./b"], ["dotdot", "a/../b"],
    ["main-prefix", "main.extra"], ["utf8-257", name257]]
    .map(([id, path]) => [`compile-path-${id}`, (m) => { m.files = [[path, new ArrayBuffer(0)]]; }]),
  ["compile-path-duplicate", (m) => { m.files = [["a.tex", new ArrayBuffer(0)], ["a.tex", new ArrayBuffer(0)]]; }],
  ["compile-path-file-dir-conflict", (m) => { m.files = [["figs", new ArrayBuffer(0)], ["figs/a.tex", new ArrayBuffer(0)]]; }],
];
for (const [id, edit] of invalidRequests) add(id, (ctx) => withWorker(ctx, async (host) => {
  await initialize(ctx, host);
  const before = await host.fixture("stream-count");
  const message = { type: "compile", id: 1, source: basic }; edit(message);
  host.post(message); const r = await host.next("result"); await host.fixture("barrier");
  engineError(r, "invalid-request");
  assert(r.id === (Number.isSafeInteger(message.id) && message.id >= 0 ? message.id : null), "invalid id mapping");
  assert(r.log === "", "invalid request must not run engine");
  assert(host.messages.filter((m) => m.type === "result").length === 1, "one invalid result required");
  assert(JSON.stringify(await host.fixture("stream-count")) === JSON.stringify(before), "invalid request must not mutate /work or streams");
  const good = await compile(host, 2, basic);
  assert(good.status === "ok", "valid request after invalid input must succeed");
}), ["stream-count"]);
add("compile-invalid-then-ok", (ctx) => withWorker(ctx, async (host) => {
  await initialize(ctx, host); const r = await compile(host, 1, basic, [["../bad", new ArrayBuffer(0)]]);
  engineError(r, "invalid-request"); assert((await compile(host, 2, basic)).status === "ok", "invalid input must preserve reuse");
}));
add("compile-path-utf8-256", (ctx) => withWorker(ctx, async (host) => {
  await initialize(ctx, host);
  assert((await compile(host, 1, basic, [[name256, new ArrayBuffer(0)]])).status === "ok", "256-byte path must be accepted");
}));
for (const [id, path, text] of [["files-input", "extra.tex", "Attached text."],
  ["files-subdir", "figs/extra.tex", "Subdirectory text."], ["files-zero-byte", "extra.tex", ""]]) {
  add(id, (ctx) => withWorker(ctx, async (host) => {
    await initialize(ctx, host);
    const source = String.raw`\documentclass{article}\begin{document}Begin.\input{` + path + String.raw`}End.\end{document}`;
    const r = await compile(host, 1, source, [[path, new TextEncoder().encode(text).buffer]]);
    assert(r.status === "ok" && r.pdf.byteLength > 0, "attached input must compile");
  }));
}
add("files-isolation", (ctx) => withWorker(ctx, async (host) => {
  await initialize(ctx, host);
  assert((await compile(host, 1, basic, [["figs/old.tex", new ArrayBuffer(0)]])).status === "ok", "first attachment must compile");
  const source = String.raw`\documentclass{article}\begin{document}\IfFileExists{figs/old.tex}{\typeout{present}}{\typeout{absent}}Clean.\end{document}`;
  const r = await compile(host, 2, source, [["new/extra.tex", new ArrayBuffer(0)]]);
  assert(r.status === "ok" && r.log.includes("absent") && !r.log.includes("present"), "old attachment must not survive");
}));
async function clean(host) {
  const state = await host.fixture("stream-count");
  assert(state.streams === 0 && state.paths.length === 0, `work/streams must be empty: ${JSON.stringify(state)}`);
}
add("lc-ok-error-ok", (ctx) => withWorker(ctx, async (host) => {
  await initialize(ctx, host);
  const sources = [basic.replace("Protocol basic.", String.raw`\typeout{request-one}First.`), texError, basic];
  for (let i = 0; i < sources.length; i++) {
    const r = await compile(host, i + 1, sources[i]);
    assert(r.status === (i === 1 ? "tex-error" : "ok"), "ok/error/ok status sequence required");
    if (i > 0) assert(!r.log.includes("request-one"), "logs must not cross requests");
    await clean(host);
  }
}), ["stream-count"]);
for (const id of ["lc-files-50", "lc-stack-50"]) add(id, (ctx) => withWorker(ctx, async (host) => {
  await initialize(ctx, host);
  const initial = await host.fixture("stack-pointer");
  for (let i = 1; i <= 50; i++) {
    const r = await compile(host, i, basic, [[`folder${i}/extra.tex`, new ArrayBuffer(0)]]);
    assert(r.status === "ok", "continuous compile must succeed");
    await clean(host);
    const stack = await host.fixture("stack-pointer");
    assert(stack.current === initial.current && stack.current === stack.snapshot, "stack pointer must return to snapshot");
  }
}), ["stream-count", "stack-pointer"]);
add("compile-empty-source", (ctx) => withWorker(ctx, async (host) => {
  await initialize(ctx, host); const empty = await compile(host, 1, "");
  assert(empty.status === "tex-error" && empty.pdf === null, "empty input must return TeX error");
  assert((await compile(host, 2, basic)).status === "ok", "empty source must preserve worker reuse");
}));

for (const [id, target] of [["tex-new", "/tex/blocked.tex"], ["fmt", "/tex/swiftlatexpdftex.fmt"],
  ["sty", "/tex/tikz.sty"], ["map", "/tex/pdftex.map"], ["tmp", "/tmp/blocked.tex"],
  ["relative", "../tex/blocked.tex"], ["symlink", "link/blocked.tex"]]) {
  add(`fs-openout-${id}`, (ctx) => fsAttempt(ctx, target, id === "symlink"),
    id === "symlink" ? ["tex-hash", "symlink-after-main"] : ["tex-hash"]);
}
async function fsAttempt(ctx, target, symlink = false, error = false) {
  const host = ctx.startWorker();
  try {
    await initialize(ctx, host);
    const before = await host.fixture("tex-hash");
    if (symlink) await host.fixture("symlink-after-main");
    const source = String.raw`\documentclass{article}\begin{document}\typeout{before-write}\immediate\openout0=`
      + target + String.raw`\relax\immediate\write0{poison}\immediate\closeout0 `
      + (error ? String.raw`\undefinedProtocolCommand` : "Done.") + String.raw`\end{document}`;
    const r = await compile(host, 1, source); engineError(r, "fs-policy");
    assert(r.log.includes("before-write") && /texkit-worker: file write denied: .+\n$/.test(r.log), "denial must end request log");
    assert(await host.fixture("tex-hash") === before, "persistent bytes must remain identical");
    await notReady(host);
  } finally { await host.terminate(); }
  const fresh = ctx.startWorker();
  try {
    await initialize(ctx, fresh);
    const source = String.raw`\documentclass{article}\begin{document}\IfFileExists{/tex/blocked.tex}{\typeout{present}}{\typeout{absent}}Recovered.\end{document}`;
    const r = await compile(fresh, 1, source);
    assert(r.status === "ok" && r.log.includes("absent") && !r.log.includes("present"), "rebuild must restore original assets");
  } finally { await fresh.terminate(); }
}
add("fs-deny-with-tex-error", (ctx) => fsAttempt(ctx, "/tex/blocked.tex", false, true), ["tex-hash"]);
add("fs-devices", (ctx) => withWorker(ctx, async (host) => {
  await initialize(ctx, host);
  await host.fixture("device-write");
  const source = String.raw`\documentclass{article}\begin{document}\typeout{standard-output}Done.\end{document}`;
  const r = await compile(host, 1, source);
  assert(r.status === "ok" && r.log.includes("standard-output"), "devices and stdout must remain usable");
}), ["device-write"]);
for (const [id, fixture, reason, exitCode] of [
  ["fault-abort", "abort-in-compile", "abort", -254],
  ["fault-trap", "trap-in-compile", "abort", -254],
  ["fault-pdf-read", "drop-pdf", "pdf-read", -253],
  ["fault-io-prepare", "fail-prepare", "io", null],
  ["fault-io-cleanup", "fail-cleanup", "io", null],
  ["fault-exception", "exception-in-compile", "exception", null],
]) add(id, (ctx) => withWorker(ctx, async (host) => {
  await initialize(ctx, host); await host.fixture(fixture);
  const r = await compile(host, 17, basic); engineError(r, reason, exitCode);
  if (reason === "abort" || reason === "exception") assert(r.log.includes("before-fault"), "pre-fault log must survive");
  await notReady(host);
}), [fixture]);
