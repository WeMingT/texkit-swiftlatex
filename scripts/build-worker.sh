#!/usr/bin/env bash
# Build the SwiftLaTeX pdfTeX worker (swiftlatexpdftex) from the pinned
# upstream clone in src/swiftlatex (pin: toolchain.lock.json swiftlatexCommit;
# fresh clone: run scripts/fetch-sources.sh to materialize it at the pin).
#
# Stages (idempotent — re-run with no args to redo everything cheaply):
#   patch  apply patches/ to src/swiftlatex (no-op when already applied)
#   xpdf   compile the xpdf C++ tree          -> build/worker/xpdf.a
#   objs   compile the pdfTeX engine sources   -> build/worker/objs/
#   link   two single-file links from the same object set:
#            build/swiftlatexpdftex.worker.js       ENVIRONMENT=web,worker
#            build/swiftlatexpdftex.node.worker.js  ENVIRONMENT=web,worker,node
#          (the node twin exists only so smoke tests can drive the exact same
#           wasm in-process; the ship artifact carries the spec flags)
#
# Upstream base: SwiftLaTeX commit 87dfb95, pdftex.wasm/Makefile +
# pdftex.wasm/xpdf/Makefile (CI emcc 3.1.46). The engine C/C++ flags and the
# link flags are taken from those Makefiles; the deltas vs upstream are:
#
# COMPILE-side (engine sources pdftex.wasm/{tex,main.c,...,pdftexdir}):
#   upstream-verbatim — pdftex.wasm/Makefile CFLAGS, no additions.
#
# COMPILE-side (xpdf C++ tree): upstream compiles it with bare -O3 only
#   (xpdf/Makefile: CFLAGS = DEBUGFLAGS = -O3). This build routes the xpdf
#   TUs through the SAME COMMON_CFLAGS as the engine, i.e. it ADDS
#   -sUSE_ZLIB=1 -sUSE_LIBPNG=1 -fno-rtti -fno-exceptions
#   -DWEBASSEMBLY_BUILD (plus the two -Wno warnings) to those 50 TUs.
#   Deliberate: one flag set for the whole object family, and these are the
#   flags the smoke-verified byte-identical artifact was built with.
#
# LINK-side:
#   - ASYNCIFY=1             (kpse file supply is host-mediated via postMessage
#                             and must suspend the engine — matches the
#                             vendored baseline worker)
#   - ASYNCIFY_STACK_SIZE=16384 (the emcc default 4096 records too little
#                             call-stack state for the initex/compileformat
#                             path — deep into latex.ltx the asyncify buffer
#                             assertion (binaryen emits `unreachable` when
#                             buffer_start > buffer_end) fires and aborts the
#                             engine. The vendored baseline worker carries
#                             StackSize:16384 in its runtime; 16384 matches it.
#                             compilelatex never reaches that depth, which is
#                             why the earlier smoke could not see this.)
#   - SINGLE_FILE=1          (self-contained worker JS, vendored shape:
#                             wasm embedded in the JS payload, no side-car
#                             .wasm — emcc 6 embeds it as a raw binary string
#                             via binaryDecode rather than the vendored
#                             build's base64)
#   - EXPORTED_RUNTIME_METHODS adds ccall (pre.js drives compiles through
#                             async ccall); EXPORTED_FUNCTIONS adds _malloc /
#                             _free (used by pre.js _allocate)
#   - NO_EXIT_RUNTIME dropped (removed in modern emcc; EXIT_RUNTIME=0 is the
#                             default and keeps the runtime alive after main)
#
# Usage: build-worker.sh [stage ...]   (no args = all stages)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC=$ROOT/src/swiftlatex
ENGINE=$SRC/pdftex.wasm
BUILD=$ROOT/build
WORK=$BUILD/worker
OBJS=$WORK/objs
PATCH=$ROOT/patches/0001-pdftex-harness-kpse-protocol.patch

source ~/emsdk/emsdk_env.sh >/dev/null 2>&1

mkdir -p "$OBJS" "$WORK"

# ---- upstream Makefile inputs (pdftex.wasm/Makefile) -----------------------
TEXSOURCES=(
  tex/pdftex0.c tex/pdftexini.c tex/pdftex-pool.c
  main.c md5.c xmemory.c texfile.c kpseemu.c bibtex.c
)
PDFSOURCES=(
  pdftexdir/avl.c pdftexdir/utils.c pdftexdir/writejbig2.c
  pdftexdir/writettf.c pdftexdir/avlstuff.c pdftexdir/pkin.c
  pdftexdir/vfpacket.c pdftexdir/writejpg.c pdftexdir/writezip.c
  pdftexdir/epdf.c pdftexdir/subfont.c pdftexdir/writeenc.c
  pdftexdir/writepng.c pdftexdir/tounicode.c pdftexdir/writefont.c
  pdftexdir/writet1.c pdftexdir/mapfile.c pdftexdir/writeimg.c
  pdftexdir/writet3.c
)
EPDFSOURCES=(pdftexdir/pdftoepdf.cc)

# ---- upstream Makefile inputs (pdftex.wasm/xpdf/Makefile) ------------------
XPDFSOURCES=(
  goo/FixedPoint.cc goo/GHash.cc goo/gmem.cc goo/GString.cc
  goo/gfile.cc goo/GList.cc goo/gmempp.cc
  fofi/FoFiBase.cc fofi/FoFiIdentifier.cc fofi/FoFiType1.cc
  fofi/FoFiEncodings.cc fofi/FoFiTrueType.cc fofi/FoFiType1C.cc
  xpdf/Array.cc xpdf/Annot.cc xpdf/Lexer.cc xpdf/Catalog.cc
  xpdf/Stream.cc xpdf/Object.cc xpdf/TextString.cc xpdf/Dict.cc
  xpdf/Error.cc xpdf/Page.cc xpdf/Parser.cc xpdf/PDFDoc.cc
  xpdf/UTF8.cc xpdf/XRef.cc xpdf/GfxFont.cc xpdf/Link.cc
  xpdf/GlobalParams.cc xpdf/CharCodeToUnicode.cc xpdf/PSTokenizer.cc
  xpdf/NameToCharCode.cc xpdf/UnicodeMap.cc xpdf/UnicodeRemapping.cc
  xpdf/FontEncodingTables.cc xpdf/PDFDocEncoding.cc
  xpdf/BuiltinFontTables.cc xpdf/BuiltinFont.cc xpdf/CMap.cc
  xpdf/OptionalContent.cc xpdf/JBIG2Stream.cc xpdf/JPXStream.cc
  xpdf/JArithmeticDecoder.cc xpdf/Decrypt.cc xpdf/SecurityHandler.cc
  xpdf/Form.cc xpdf/XFAForm.cc xpdf/AcroForm.cc xpdf/Zoox.cc
)

# Engine CFLAGS, verbatim from pdftex.wasm/Makefile. Also applied to the xpdf
# C++ tree (see the compile-side delta in the header) — upstream uses bare
# -O3 there.
COMMON_CFLAGS=(-O3 -sUSE_ZLIB=1 -sUSE_LIBPNG=1
  -Wno-parentheses-equality -Wno-pointer-sign -fno-rtti -fno-exceptions
  -DWEBASSEMBLY_BUILD)

stage_patch() {
  if git -C "$SRC" apply --check --reverse "$PATCH" >/dev/null 2>&1; then
    echo "[patch] already applied"
  elif git -C "$SRC" apply --check "$PATCH" >/dev/null 2>&1; then
    git -C "$SRC" apply "$PATCH"
    echo "[patch] applied $PATCH"
  else
    echo "ERROR: $PATCH is neither applicable nor already applied — src/swiftlatex is not at the pinned clean state" >&2
    exit 1
  fi
}

# compile_one <cwd-relative-to-engine> <src-relative-to-that-cwd> <includes...>
# Uses emcc for C and em++ for C++. Objects land in build/worker/objs/<src>.o
# keyed by the path relative to the engine dir. Skipped when the object is
# newer than its source and the patch.
compile_one() {
  local cwdbase=$1; shift
  local src=$1; shift
  local rel=${cwdbase#.}
  rel="${rel:+$rel/}$src"
  local obj=$OBJS/${rel}.o
  if [ -f "$obj" ] && [ "$obj" -nt "$ENGINE/$rel" ] && [ "$obj" -nt "$PATCH" ]; then
    return
  fi
  mkdir -p "$(dirname "$obj")"
  case $src in
    *.cc) (cd "$ENGINE/$cwdbase" && em++ -c "${COMMON_CFLAGS[@]}" "$@" "$src" -o "$obj") ;;
    *)    (cd "$ENGINE/$cwdbase" && emcc  -c "${COMMON_CFLAGS[@]}" "$@" "$src" -o "$obj") ;;
  esac
  echo "[objs] $rel"
}

stage_xpdf() {
  local xsrc xobj need=0 xarcs=()
  for xsrc in "${XPDFSOURCES[@]}"; do
    # xpdf Makefile (cwd = xpdf dir): em++ -c -O3 -I. -Ifofi/ -Igoo/ -Ixpdf/ -Isplash/
    compile_one "xpdf" "$xsrc" -I. -Ifofi/ -Igoo/ -Ixpdf/ -Isplash/
    xarcs+=("$OBJS/xpdf/$xsrc.o")
  done
  for xsrc in "${XPDFSOURCES[@]}"; do
    xobj=$OBJS/xpdf/$xsrc.o
    if [ ! -f "$WORK/xpdf.a" ] || [ "$xobj" -nt "$WORK/xpdf.a" ]; then need=1; fi
  done
  if [ "$need" = 1 ]; then
    emar rcs "$WORK/xpdf.a" "${xarcs[@]}"
    echo "[xpdf] archived ${#XPDFSOURCES[@]} objects -> $WORK/xpdf.a"
  else
    echo "[xpdf] up to date"
  fi
}

stage_objs() {
  local s
  for s in "${TEXSOURCES[@]}"; do
    compile_one "." "$s" -I. -I tex/
  done
  for s in "${PDFSOURCES[@]}"; do
    compile_one "." "$s" -I. -I tex/ -I pdftexdir/ -I xpdf/xpdf/ -I xpdf/
  done
  # EPDF rule, verbatim from pdftex.wasm/Makefile (aconf.h lives at xpdf/
  # root; upstream's rule already carries -Ixpdf/).
  for s in "${EPDFSOURCES[@]}"; do
    compile_one "." "$s" -I. -I tex/ -I pdftexdir/ -I xpdf/ -I xpdf/xpdf/ -I xpdf/goo/
  done
}

ALL_OBJS=()
collect_objs() {
  ALL_OBJS=()
  local s
  for s in "${TEXSOURCES[@]}" "${PDFSOURCES[@]}" "${EPDFSOURCES[@]}"; do
    ALL_OBJS+=("$OBJS/$s.o")
  done
}

# link_worker <output> <environment-value>
link_worker() {
  local out=$1 env=$2
  (cd "$ENGINE" && em++ -o "$out" "${ALL_OBJS[@]}" "$WORK/xpdf.a" \
    --js-library library.js --pre-js pre.js \
    -O3 -sUSE_ZLIB=1 -sUSE_LIBPNG=1 \
    -Wno-parentheses-equality -Wno-pointer-sign -fno-rtti -fno-exceptions \
    -DWEBASSEMBLY_BUILD \
    -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=16384 \
    -sENVIRONMENT="$env" \
    -sEXPORTED_FUNCTIONS='["_compileBibtex","_compileLaTeX","_compileFormat","_setMainEntry","_main","_malloc","_free"]' \
    -sEXPORTED_RUNTIME_METHODS=["ccall","cwrap"] \
    -sALLOW_MEMORY_GROWTH=1 \
    -sSINGLE_FILE=1)
  echo "[link] $out (ENVIRONMENT=$env)"
}

stage_link() {
  collect_objs
  link_worker "$BUILD/swiftlatexpdftex.worker.js" "web,worker"
  link_worker "$BUILD/swiftlatexpdftex.node.worker.js" "web,worker,node"
  ls -la "$BUILD"/swiftlatexpdftex*.worker.js
}

if [ $# -gt 0 ]; then stages=("$@"); else stages=(patch xpdf objs link); fi
for s in "${stages[@]}"; do
  "stage_$s"
done
echo "ALL DONE"
