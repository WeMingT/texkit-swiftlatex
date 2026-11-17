// Synchronous pdfTeX worker. Runtime assets are installed once and remain
// immutable during compilation; user files are confined to each request.
var Module = {};
var texkitRuntimeReady = false;
var texkitReady = false;
var texkitInitUsed = false;
var texkitQueue = [];
var texkitLog = '';
var texkitSnapshot;
var texkitStack;
var texkitFiles = new Map();
var texkitPkFiles = new Map();
var texkitInCompile = false;
var texkitDenied = null;
var texkitAborted = false;
var texkitCurrentId = null;
var texkitAbortedId = null;
Module['print'] = Module['printErr'] = function(line) { texkitLog += line + '\n'; };
Module['onAbort'] = function() {
    texkitAborted = true;
    texkitAbortedId = texkitCurrentId;
};
Module['preRun'] = function() { FS.mkdir('/tex'); FS.mkdir('/work'); };
Module['postRun'] = function() {
    texkitSnapshot = new Uint8Array(wasmMemory.buffer).slice();
    texkitStack = stackSave();
    texkitRuntimeReady = true;
    while (texkitQueue.length) texkitDispatch(texkitQueue.shift());
};
function texkitAllocatePath(path) {
    var bytes = intArrayFromString(path);
    var pointer = _malloc(bytes.length);
    HEAPU8.set(bytes, pointer);
    return pointer;
}
function texkitFindFile(nameptr, format) {
    var name = UTF8ToString(nameptr);
    if (name.includes('/')) return 0;
    if (!name.includes('.')) name += formatToSuffix(format);
    var path = texkitFiles.get(name);
    return path ? texkitAllocatePath(path) : 0;
}
Module['kpse_find_file_impl'] = texkitFindFile;
Module['kpse_find_pk_impl'] = function(nameptr) {
    var name = UTF8ToString(nameptr);
    if (name.includes('/')) return 0;
    var path = texkitPkFiles.get(name);
    return path ? texkitAllocatePath(path) : 0;
};
function texkitBuffer(value) { return value instanceof ArrayBuffer; }
function texkitPathName(value) {
    return typeof value === 'string' && value.length > 0 &&
        !/[\\\0]/.test(value) && new TextEncoder().encode(value).length <= 256;
}
function texkitPairs(files, flat) {
    if (!Array.isArray(files)) throw new Error('files must be an array');
    var names = new Set();
    for (var pair of files) {
        if (!Array.isArray(pair) || pair.length !== 2 || !texkitBuffer(pair[1]))
            throw new Error('file entries must contain a path and an ArrayBuffer');
        var name = pair[0];
        if (!texkitPathName(name)) throw new Error('invalid file path');
        var parts = name.split('/');
        if (flat ? (parts.length !== 1 || name === '.' || name === '..' || name === 'swiftlatexpdftex.fmt') :
            (name.startsWith('main.') || parts.some(function(p) { return p === '' || p === '.' || p === '..'; })))
            throw new Error('invalid file path');
        if (names.has(name)) throw new Error('duplicate file path');
        names.add(name);
    }
    if (!flat) for (var name of names) {
        var parts = name.split('/');
        for (var i = 1; i < parts.length; i++)
            if (names.has(parts.slice(0, i).join('/'))) throw new Error('file/directory conflict');
    }
}
function texkitCloseStreams() {
    for (var stream of FS.streams) if (stream && stream.fd > 2) FS.close(stream);
}
function texkitCleanDir(dir) {
    for (var name of FS.readdir(dir)) {
        if (name === '.' || name === '..') continue;
        var path = dir + '/' + name;
        if (FS.isDir(FS.lstat(path).mode)) { texkitCleanDir(path); FS.rmdir(path); }
        else FS.unlink(path);
    }
}
function texkitTarget(value) {
    if (typeof value !== 'string') value = FS.getPath(value.node || value);
    try { return FS.lookupPath(value, { follow: true }); }
    catch (error) {
        // noent_okay still follows a dangling final symlink to its real target.
        var resolved = FS.lookupPath(value, { follow: true, noent_okay: true });
        if (resolved.node) return resolved;
        var parent = FS.lookupPath(resolved.path, { parent: true });
        return { path: PATH.join2(parent.path, PATH.basename(resolved.path)), node: null };
    }
}
function texkitCheckWrite(value) {
    if (!texkitInCompile) return;
    var target = texkitTarget(value);
    if (target.path.startsWith('/work/') ||
        (target.path.startsWith('/dev/') && target.node && FS.isChrdev(target.node.mode))) return;
    if (texkitDenied === null) texkitDenied = target.path;
    throw new FS.ErrnoError(2); // EACCES in the toolchain's errno ABI.
}
function texkitProtectFiles() {
    function wrap(name, targets) {
        if (typeof FS[name] !== 'function') return;
        var original = FS[name];
        FS[name] = function() {
            if (texkitInCompile) for (var target of targets(arguments)) texkitCheckWrite(target);
            return original.apply(this, arguments);
        };
    }
    wrap('open', function(a) {
        var flags = a[1];
        var write = typeof flags === 'string' ? /[wa+]/.test(flags) : (flags & (3 | 64 | 512 | 1024));
        return write ? [a[0]] : [];
    });
    for (var name of ['mknod', 'mkdir', 'unlink', 'rmdir', 'truncate', 'chmod', 'lchmod', 'utime', 'writeFile'])
        wrap(name, function(a) { return [a[0]]; });
    wrap('symlink', function(a) { return [a[1]]; });
    wrap('rename', function(a) { return [a[0], a[1]]; });
    for (var name of ['ftruncate', 'fchmod'])
        wrap(name, function(a) { return [FS.getStreamChecked(a[0])]; });
    wrap('write', function(a) { return [a[0]]; });
}
function texkitInit(data) {
    if (texkitInitUsed) {
        texkitReady = false;
        self.postMessage({ type: 'init-error', message: 'init is accepted only once' });
        return;
    }
    texkitInitUsed = true;
    try {
        if (!texkitBuffer(data.fmt) || data.fmt.byteLength === 0) throw new Error('fmt must be a nonempty ArrayBuffer');
        texkitPairs(data.files, true);
        FS.writeFile('/tex/swiftlatexpdftex.fmt', new Uint8Array(data.fmt));
        texkitFiles.set('swiftlatexpdftex.fmt', '/tex/swiftlatexpdftex.fmt');
        for (var pair of data.files) {
            FS.writeFile('/tex/' + pair[0], new Uint8Array(pair[1]));
            texkitFiles.set(pair[0], '/tex/' + pair[0]);
        }
        if (texkitAborted) throw new Error('runtime aborted during initialization');
        texkitProtectFiles();
        texkitReady = true;
        self.postMessage({ type: 'ready' });
    } catch (error) {
        texkitReady = false;
        self.postMessage({ type: 'init-error', message: String(error) });
    }
}
function texkitResult(id, reason, exitCode, log) {
    return { type: 'result', id: id, status: 'engine-error', exitCode: exitCode,
        reason: reason, log: log, pdf: null };
}
function texkitCompile(data) {
    var id = Number.isSafeInteger(data.id) && data.id >= 0 ? data.id : null;
    if (!texkitReady) { self.postMessage(texkitResult(id, 'not-ready', null, '')); return; }
    var files = data.files === undefined ? [] : data.files;
    try {
        if (id === null || typeof data.source !== 'string') throw new Error('invalid id/source');
        texkitPairs(files, false);
    } catch (error) { self.postMessage(texkitResult(id, 'invalid-request', null, '')); return; }
    texkitLog = '';
    texkitDenied = null;
    texkitAborted = false;
    texkitCurrentId = id;
    var result = null;
    try {
        texkitCloseStreams();
        texkitCleanDir('/work');
        FS.chdir('/work');
        FS.writeFile('/work/main.tex', data.source);
        for (var pair of files) {
            var at = pair[0].lastIndexOf('/');
            if (at >= 0) FS.mkdirTree('/work/' + pair[0].slice(0, at));
            FS.writeFile('/work/' + pair[0], new Uint8Array(pair[1]));
        }
        new Uint8Array(wasmMemory.buffer).set(texkitSnapshot);
        stackRestore(texkitStack);
        ccall('setMainEntry', 'number', ['string'], ['main.tex']);
    } catch (error) { result = texkitResult(id, 'io', null, ''); }
    if (!result) {
        var exitCode;
        try {
            texkitInCompile = true;
            exitCode = ccall('compileLaTeX', 'number', [], []);
        } catch (error) {
            var aborted = texkitAborted || error instanceof WebAssembly.RuntimeError;
            result = texkitResult(id, aborted ? 'abort' : 'exception', aborted ? -254 : null, '');
        } finally { texkitInCompile = false; }
        if (texkitDenied !== null) result = texkitResult(id, 'fs-policy', null, '');
        if (!result) {
            result = { type: 'result', id: id, status: exitCode === 0 ? 'ok' : 'tex-error',
                exitCode: exitCode, log: '', pdf: null };
            if (exitCode === 0) try {
                var bytes = FS.readFile('/work/main.pdf');
                if (!bytes.byteLength) throw new Error('empty PDF');
                result.pdf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            } catch (error) { result = texkitResult(id, 'pdf-read', -253, ''); }
        }
    }
    try { texkitCloseStreams(); texkitCleanDir('/work'); }
    catch (error) { result = texkitResult(id, 'io', null, ''); }
    stackRestore(texkitStack);
    if (texkitDenied !== null) texkitLog += 'texkit-worker: file write denied: ' + texkitDenied + '\n';
    result.log = texkitLog;
    if (result.status === 'engine-error') texkitReady = false;
    texkitCurrentId = null;
    self.postMessage(result, result.pdf ? [result.pdf] : []);
}
function texkitDispatch(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'init') texkitInit(data);
    else if (data.type === 'compile') texkitCompile(data);
}
self.onmessage = function(event) {
    if (!texkitRuntimeReady) texkitQueue.push(event.data);
    else texkitDispatch(event.data);
};
// Mirror of kpse_file_format_type from texmfmp.h — numeric values MUST stay
// in sync with the C enum.
const kpse_file_format_type = Object.freeze({
    kpse_gf_format: 0,
    kpse_pk_format: 1,
    kpse_any_glyph_format: 2,
    kpse_tfm_format: 3,
    kpse_afm_format: 4,
    kpse_base_format: 5,
    kpse_bib_format: 6,
    kpse_bst_format: 7,
    kpse_cnf_format: 8,
    kpse_db_format: 9,
    kpse_fmt_format: 10,
    kpse_fontmap_format: 11,
    kpse_mem_format: 12,
    kpse_mf_format: 13,
    kpse_mfpool_format: 14,
    kpse_mft_format: 15,
    kpse_mp_format: 16,
    kpse_mppool_format: 17,
    kpse_mpsupport_format: 18,
    kpse_ocp_format: 19,
    kpse_ofm_format: 20,
    kpse_opl_format: 21,
    kpse_otp_format: 22,
    kpse_ovf_format: 23,
    kpse_ovp_format: 24,
    kpse_pict_format: 25,
    kpse_tex_format: 26,
    kpse_texdoc_format: 27,
    kpse_texpool_format: 28,
    kpse_texsource_format: 29,
    kpse_tex_ps_header_format: 30,
    kpse_troff_font_format: 31,
    kpse_type1_format: 32,
    kpse_vf_format: 33,
    kpse_dvips_config_format: 34,
    kpse_ist_format: 35,
    kpse_truetype_format: 36,
    kpse_type42_format: 37,
    kpse_web2c_format: 38,
    kpse_program_text_format: 39,
    kpse_program_binary_format: 40,
    kpse_miscfonts_format: 41,
    kpse_web_format: 42,
    kpse_cweb_format: 43,
    kpse_enc_format: 44,
    kpse_cmap_format: 45,
    kpse_sfd_format: 46,
    kpse_opentype_format: 47,
    kpse_pdftex_config_format: 48,
    kpse_lig_format: 49,
    kpse_texmfscripts_format: 50,
    kpse_lua_format: 51,
    kpse_fea_format: 52,
    kpse_cid_format: 53,
    kpse_mlbib_format: 54,
    kpse_mlbst_format: 55,
    kpse_clua_format: 56,
    kpse_ris_format: 57,
    kpse_bltxml_format: 58,
    kpse_last_format: 59
});

// Mirrors fix_extension() in kpseemu.c — the extension appended to
// extension-less names before asking the host.
function formatToSuffix(format) {
    switch (format) {
    case kpse_file_format_type.kpse_gf_format:
        return ".gf";
    case kpse_file_format_type.kpse_pk_format:
        return ".pk";
    case kpse_file_format_type.kpse_tfm_format:
        return ".tfm";
    case kpse_file_format_type.kpse_afm_format:
        return ".afm";
    case kpse_file_format_type.kpse_base_format:
        return ".base";
    case kpse_file_format_type.kpse_bib_format:
        return ".bib";
    case kpse_file_format_type.kpse_bst_format:
        return ".bst";
    case kpse_file_format_type.kpse_fontmap_format:
        return ".map";
    case kpse_file_format_type.kpse_mem_format:
        return ".mem";
    case kpse_file_format_type.kpse_mf_format:
        return ".mf";
    case kpse_file_format_type.kpse_mft_format:
        return ".mft";
    case kpse_file_format_type.kpse_mfpool_format:
        return ".pool";
    case kpse_file_format_type.kpse_mp_format:
        return ".mp";
    case kpse_file_format_type.kpse_mppool_format:
        return ".pool";
    case kpse_file_format_type.kpse_ocp_format:
        return ".ocp";
    case kpse_file_format_type.kpse_ofm_format:
        return ".ofm";
    case kpse_file_format_type.kpse_opl_format:
        return ".opl";
    case kpse_file_format_type.kpse_otp_format:
        return ".otp";
    case kpse_file_format_type.kpse_ovf_format:
        return ".ovf";
    case kpse_file_format_type.kpse_ovp_format:
        return ".ovp";
    case kpse_file_format_type.kpse_pict_format:
        return ".esp";
    case kpse_file_format_type.kpse_tex_format:
        return ".tex";
    case kpse_file_format_type.kpse_texpool_format:
        return ".pool";
    case kpse_file_format_type.kpse_texsource_format:
        return ".dtx";
    case kpse_file_format_type.kpse_type1_format:
        return ".pfa";
    case kpse_file_format_type.kpse_vf_format:
        return ".vf";
    case kpse_file_format_type.kpse_ist_format:
        return ".ist";
    case kpse_file_format_type.kpse_truetype_format:
        return ".ttf";
    case kpse_file_format_type.kpse_type42_format:
        return ".t42";
    case kpse_file_format_type.kpse_miscfonts_format:
        return "";
    case kpse_file_format_type.kpse_enc_format:
        return ".enc";
    case kpse_file_format_type.kpse_cmap_format:
        return "cmap";
    case kpse_file_format_type.kpse_sfd_format:
        return ".sfd";
    case kpse_file_format_type.kpse_opentype_format:
        return ".otf";
    case kpse_file_format_type.kpse_pdftex_config_format:
        return ".cfg";
    case kpse_file_format_type.kpse_lig_format:
        return ".lig";
    case kpse_file_format_type.kpse_texmfscripts_format:
        return "";
    case kpse_file_format_type.kpse_fea_format:
        return ".fea";
    case kpse_file_format_type.kpse_cid_format:
        return ".cid";
    case kpse_file_format_type.kpse_mlbib_format:
        return ".mlbib";
    case kpse_file_format_type.kpse_mlbst_format:
        return ".mlbst";
    case kpse_file_format_type.kpse_ris_format:
        return ".ris";
    case kpse_file_format_type.kpse_bltxml_format:
        return ".bltxml";
    case kpse_file_format_type.kpse_fmt_format:
        return ".fmt";
    default:
        console.log(`Unknown Kpse Format ${format}`);
        return "";
    }
}
