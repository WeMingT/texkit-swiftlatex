#!/usr/bin/env bash
# Build the single-file release worker with synchronous preinstalled input.
# Sources and patch are pinned by toolchain.lock.json. All compilation runs
# in the fixed toolchain container; generated objects remain under build/.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC=$ROOT/src/swiftlatex
ENGINE=$SRC/pdftex.wasm
BUILD=$ROOT/build/engine-v2
WORK=$BUILD/worker
OBJS=$WORK/objs
PATCH=$ROOT/patches/0001-pdftex-harness-kpse-protocol.patch

emcc --version | head -1 | grep -F '6.0.8' >/dev/null || {
  echo "expected Emscripten 6.0.8" >&2; exit 1;
}
printf 'build EM_CACHE=%s\n' "${EM_CACHE:-}"
[[ "${EM_CACHE:-}" == "$ROOT/build/em-cache" ]] || {
  echo "expected the absolute checkout port cache" >&2; exit 1;
}

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
  local extra=()
  if [[ "$env" == "web,worker,node" ]]; then extra=(--pre-js "$ROOT/worker/pdftex-node-pre.js"); fi
  (cd "$ENGINE" && em++ -o "$out" "${ALL_OBJS[@]}" "$WORK/xpdf.a" \
    --js-library "$ROOT/worker/pdftex-library.js" --pre-js "$ROOT/worker/pdftex-pre.js" "${extra[@]}" \
    -O3 -sUSE_ZLIB=1 -sUSE_LIBPNG=1 \
    -Wno-parentheses-equality -Wno-pointer-sign -fno-rtti -fno-exceptions \
    -DWEBASSEMBLY_BUILD \
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
