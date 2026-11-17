// Trusted, build-only file supply for synchronous format generation.
// This frontend is never linked into the release worker.
var texkitNodeFS = require('node:fs');
var texkitNodeChildProcess = require('node:child_process');
var texkitNodePath = require('node:path');
if (!process.env.TEXLIVE_ROOT) throw new Error('TEXLIVE_ROOT is required');
var texkitNodeKpse = texkitNodePath.join(process.env.TEXLIVE_ROOT, 'bin/x86_64-linux/kpsewhich');
var texkitNodeServed = [];
function texkitNodeFindFile(nameptr, format) {
    var name = UTF8ToString(nameptr);
    if (!name.includes('.')) name += formatToSuffix(format);
    var cached = texkitFiles.get(name);
    if (cached) return texkitAllocatePath(cached);
    if (name.endsWith('.fmt')) return 0;
    var resolved = texkitNodeChildProcess.spawnSync(texkitNodeKpse, ['-progname=pdflatex', name],
        { encoding: 'utf8', timeout: 60000 });
    if (resolved.error) throw resolved.error;
    if (resolved.status !== 0) return 0;
    var location = resolved.stdout.trim();
    if (!location) return 0;
    var bytes = texkitNodeFS.readFileSync(location);
    if (globalThis.texkitFormatTransform) bytes = globalThis.texkitFormatTransform(name, bytes);
    var target = '/tex/' + texkitNodePath.basename(name);
    FS.writeFile(target, bytes);
    texkitFiles.set(name, target);
    texkitNodeServed.push(name);
    return texkitAllocatePath(target);
}
Module['kpse_find_file_impl'] = texkitNodeFindFile;
var texkitNodePostRun = Module['postRun'];
globalThis.texkitFormatReady = new Promise(function(resolve) {
    Module['postRun'] = function() { texkitNodePostRun(); resolve(); };
});
globalThis.texkitCompileFormat = function() {
    if (!texkitRuntimeReady) throw new Error('format runtime is not ready');
    texkitLog = '';
    texkitCloseStreams();
    texkitCleanDir('/work');
    FS.chdir('/work');
    new Uint8Array(wasmMemory.buffer).set(texkitSnapshot);
    stackRestore(texkitStack);
    var status = ccall('compileFormat', 'number', [], []);
    var fmt = status === 0 ? FS.readFile('/work/pdflatex.fmt').slice() : new Uint8Array();
    return { status: status, log: texkitLog, fmt: fmt, served: texkitNodeServed.slice() };
};
