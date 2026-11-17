# pdfTeX worker protocol

The single-file `swiftlatexpdftex.worker.js` provides synchronous compilation
with preinstalled runtime files. Every message uses a `type` field. The
worker processes messages in receive order, including those received before
the WebAssembly runtime is ready. Every compile emits exactly one terminal
`result`. Format generation is available only in the separate Node build.

## Initialization

```js
{ type: "init", fmt: ArrayBuffer, files: [[name, ArrayBuffer], ...] }
```

Send one init per worker. Transfer the format buffer and every member buffer
using the postMessage transfer list. The worker installs the format as
`/tex/swiftlatexpdftex.fmt` and the flat members as `/tex/<name>`. The format
and members remain read-only to compilation. File lookup uses only these
preinstalled files; compilation never requests files from the sender.

The format must be a nonempty ArrayBuffer. `files` must be an array of
exact two-element pairs. A member buffer may be empty; typed-array views and
SharedArrayBuffer are rejected. Each name must be a nonempty string, at most
256 UTF-8 bytes, with no slash, backslash or NUL. Names `.` and `..`, duplicate
names and `swiftlatexpdftex.fmt` are rejected. The entire message is validated
before files or lookup tables are installed.

Success emits `{ type: "ready" }`. Validation, installation or initialization
failure emits `{ type: "init-error", message: string }`. Init-error is terminal:
terminate that worker. A second init also emits init-error and prevents further
compilation, while preserving the bytes already installed. Initialization never
emits a result. An init received before runtime readiness is queued.

## Compilation

```js
{ type: "compile", id: number, source: string,
  files: [[relativePath, ArrayBuffer], ...] } // files is optional
```

The id must be a nonnegative safe integer and source must be a string.
Omitted files means an empty array. Provided files must contain exact pairs;
empty buffers are allowed, while views and SharedArrayBuffer are rejected.
Relative paths may contain subdirectories, but must be nonempty strings of
at most 256 UTF-8 bytes. Absolute paths, backslashes, NUL, empty segments,
`.` or `..` segments, duplicate paths and file/directory prefix conflicts are
rejected. The root prefix `main.` is reserved for the request's input/output.
For example, `figs` and `figs/a.tex` cannot occur together.

Validation finishes before logs, work files, heap or stack are changed. Invalid
requests retain initialized state and return invalid-request with an empty log.
Their id is the provided valid id, or null if it is invalid/missing. Requests
before successful initialization or after a terminal failure return not-ready
with an empty log, without executing TeX.

For each valid request the worker clears the request log, closes all file streams
with fd > 2, recursively removes files and subdirectories under `/work`, and
selects `/work` as cwd. It writes `main.tex` and attachments, restores the initial
heap and stack snapshots, then sets the C entry to `main.tex` and compiles
synchronously. A successful PDF is copied to a buffer exactly matching its bytes.
Before sending the result, it preserves the log/PDF, closes all nonstandard
streams and recursively cleans `/work`, retaining the root directory. This also
happens for ordinary TeX errors. Empty source returns a TeX error and permits
worker reuse. Each request starts with original persistent assets and no files
from earlier requests.

## Filesystem policy

During the synchronous compile call, modifications of ordinary files must
resolve below `/work/`. Checks cover create, write, truncate, append, delete,
rename, mode and timestamp changes at the JavaScript FS boundary. They resolve
actual targets, including traversal and symlinks. They do not rely on permission
bits alone. Persistent asset reads remain available. Standard input/output/error
and device nodes under `/dev`, including `/dev/null`, remain usable.

Forbidden changes are refused before bytes change. The result is engine-error
with reason fs-policy and exitCode null, no PDF, and the request log ends with:

```text
texkit-worker: file write denied: <resolved-path>
```

The worker cannot be reused after this result. Terminate it, reread original
assets, and initialize a new worker. Trusted installation, preparation and
cleanup are outside the compilation guard; no protocol message can disable it.

## Results and failures

```js
{ type: "result", id: number | null, status, exitCode, log: string,
  pdf: ArrayBuffer | null, reason? }
```

| status | exitCode | pdf | meaning |
|---|---|---|---|
| ok | 0 | Nonempty transferable ArrayBuffer | TeX succeeded and PDF was read |
| tex-error | Nonzero TeX return code | null | Ordinary TeX failure; worker remains usable |
| engine-error | -254 | null | reason abort; WebAssembly abort or trap |
| engine-error | -253 | null | reason pdf-read; success without a readable nonempty PDF |
| engine-error | null | null | reason invalid-request, not-ready, io, fs-policy or exception |

The result id matches the request; an invalid id becomes null. The log contains
only this request's terminal output. Invalid-request/not-ready have no log;
errors after execution preserve output already produced. Abort handling records
state and the active id; the outer request handler emits the single result, so
an abort callback and synchronous exception cannot produce duplicate replies.
An abort during init emits only init-error, not a compile result.

Preparation/cleanup failures use io. Other unexpected runtime exceptions,
including ExitStatus, use exception. Abort, pdf-read, io, fs-policy and exception
make the instance unfit for further compilation; subsequent compile requests
return not-ready. Recovery requires termination and a fresh worker initialized
from the original assets. Invalid-request does not poison the worker. Request
FIFO, cancellation of queued work, deadlines, termination and respawning belong
to the caller: the synchronous worker cannot service a cancel while compiling.

## Repeating the checks

`tests/pdftex/protocol.mjs` hosts the release worker as a classic script in a
thread. Its portable suite is also used for browser acceptance. Test-only
fixtures execute in the host shim, never as production protocol messages.
They cover transfer, validation, file isolation, repeated compilation, asset
integrity, filesystem refusal and actual WebAssembly failures. Run in the
fixed builder with the built worker, gzip ustar closure and binary format:

```sh
bash scripts/in-builder.sh --network none -- node tests/pdftex/protocol.mjs \
  --worker build/engine-v2/swiftlatexpdftex.worker.js \
  --closure build/texfiles.tar.gz \
  --fmt build/reference/engine-v1/swiftlatexpdftex.fmt
```
