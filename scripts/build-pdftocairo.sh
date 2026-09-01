#!/usr/bin/env bash
# Build pdftocairo.wasm/js from pinned upstream sources (Path B, see
# docs/decision-2026-08-30-pdftocairo-wrapper.md). Sources live in src/;
# on a fresh clone run scripts/fetch-sources.sh first to materialize the
# pinned trees at their pins.
#
# Stages (each idempotent, skipped when its stamp exists):
#   gperf      GNU gperf into ~/.local (fontconfig meson needs it)
#   freetype   meson  -> build/prefix
#   pixman     meson  -> build/prefix
#   fontconfig meson (expat 2.2.6 subproject) -> build/prefix
#   cairo      meson  -> build/prefix
#   poppler    emcmake cmake -> build/poppler (utils/pdftocairo target)
#   link       final emcc link -> build/out/pdftocairo.js + .wasm
#   strip      wasm-opt --strip-debug --strip-producers + single-file re-embed
#              -> build/out/pdftocairo.stripped.js
#
# Usage: build-pdftocairo.sh [stage ...]   (no args = all stages)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC=$ROOT/src
BUILD=$ROOT/build
PREFIX=$BUILD/prefix
FCSTAGE=$BUILD/fontconfig-stage
STAMPS=$BUILD/stamps
OUT=$BUILD/out
CROSS=$BUILD/cross/emscripten-crossfile.meson
SYSROOT=~/emsdk/upstream/emscripten/cache/sysroot

source ~/emsdk/emsdk_env.sh >/dev/null 2>&1
export PATH="$HOME/.local/bin:$PATH"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"

mkdir -p "$PREFIX" "$STAMPS" "$OUT" "$(dirname "$CROSS")"

# Meson cross file for emscripten (no pthreads, exceptions on). Used by the
# freetype / pixman / fontconfig / cairo stages. Emitted here so a fresh clone
# can replay the whole line without any untracked build/cross/ input (fix:
# it used to be a hand-created, gitignored file).
cat > "$CROSS" <<'EOF'
# Meson cross file for emscripten (no pthreads, exceptions on).
# Used by: freetype, pixman, fontconfig, cairo stages.
[binaries]
c = 'emcc'
cpp = 'em++'
ar = 'emar'
ranlib = 'emranlib'
pkg-config = 'pkg-config'

[built-in options]
c_args = ['-O2', '-fexceptions']
cpp_args = ['-O2', '-fexceptions']
c_link_args = []
cpp_link_args = []

[host_machine]
system = 'emscripten'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'
EOF

stamp() { [ -f "$STAMPS/$1" ]; }
done_stamp() { touch "$STAMPS/$1"; }

stage_gperf() {
  # GNU gperf 3.1 into ~/.local (fontconfig meson needs the real thing; the
  # pip package of the same name is a Python dud).
  command -v gperf >/dev/null && { echo "[skip] gperf"; return; }
  local T=/tmp/gperf-3.1
  rm -rf "$T" /tmp/gperf-3.1.tar.gz
  curl -fSL --speed-limit 2048 --speed-time 45 -o /tmp/gperf-3.1.tar.gz \
    https://ftp.gnu.org/gnu/gperf/gperf-3.1.tar.gz
  tar -C /tmp -xzf /tmp/gperf-3.1.tar.gz
  (cd "$T" && ./configure --prefix="$HOME/.local" && make -j"$(nproc)" && make install)
}

stage_freetype() {
  stamp freetype && { echo "[skip] freetype"; return; }
  local B=$BUILD/freetype
  rm -rf "$B"
  meson setup "$B" "$SRC/freetype" \
    --cross-file "$CROSS" --prefix "$PREFIX" \
    --default-library=static --buildtype=release \
    -Dzlib=disabled -Dpng=disabled -Dbrotli=disabled -Dbzip2=disabled \
    -Dharfbuzz=disabled -Dtests=disabled
  meson install -C "$B"
  done_stamp freetype
}

stage_pixman() {
  stamp pixman && { echo "[skip] pixman"; return; }
  local B=$BUILD/pixman
  rm -rf "$B"
  meson setup "$B" "$SRC/pixman" \
    --cross-file "$CROSS" --prefix "$PREFIX" \
    --default-library=static --buildtype=release \
    -Dtests=disabled -Dlibpng=disabled -Dopenmp=disabled \
    -Dmmx=disabled -Dsse2=disabled -Dssse3=disabled -Dvmx=disabled \
    -Darm-simd=disabled -Dneon=disabled -Da64-neon=disabled \
    -Diwmmxt=disabled -Dmips-dspr2=disabled -Dloongson-mmi=disabled \
    -Dgnu-inline-asm=disabled
  meson install -C "$B"
  done_stamp pixman
}

stage_fontconfig() {
  stamp fontconfig && { echo "[skip] fontconfig"; return; }
  local B=$BUILD/fontconfig
  rm -rf "$B" "$FCSTAGE"
  # Fixed /usr prefix: compile-time constants (FONTCONFIG_PATH, FC_CACHEDIR,
  # template dir, fonts.conf template) must be checkout-path-independent.
  # Actual install is staged via --destdir and consumed from $FCSTAGE.
  meson setup "$B" "$SRC/fontconfig" \
    --cross-file "$CROSS" --prefix /usr --sysconfdir /etc \
    --force-fallback-for=expat \
    --default-library=static --buildtype=release \
    -Ddoc=disabled -Ddoc-txt=disabled -Ddoc-man=disabled \
    -Ddoc-pdf=disabled -Ddoc-html=disabled \
    -Dnls=disabled -Dtests=disabled -Dtools=disabled -Dcache-build=disabled \
    -Dcache-dir=/var/cache/fontconfig
  meson install -C "$B" --destdir "$FCSTAGE"
  # Rewire the staged .pc files to the staging tree so downstream stages
  # (cairo, poppler) resolve headers/libs from there via pkg-config.
  sed -i "s|^prefix=/usr$|prefix=$FCSTAGE/usr|" "$FCSTAGE/usr/lib/pkgconfig/"*.pc
  cp "$FCSTAGE/usr/lib/pkgconfig/"*.pc "$PREFIX/lib/pkgconfig/"
  done_stamp fontconfig
}

stage_cairo() {
  stamp cairo && { echo "[skip] cairo"; return; }
  local B=$BUILD/cairo
  rm -rf "$B"
  # CAIRO_NO_MUTEX: emcc passes meson's pthread link probe (-pthread links fine
  # standalone), which would compile real pthread mutexes into cairo and force
  # a pthreads runtime at final link. The vendored binary has no pthread
  # runtime -> no-op mutexes match its actual behavior.
  # png=enabled: cairo-svg-glyph-render.c calls png functions unguarded;
  # the vendored binary carries libpng port code, so parity = enabled.
  # libpng resolution: the emsdk sysroot ships no libpng.pc (only zlib/jpeg),
  # so without the shim below meson would fall back to cairo's vendored libpng
  # subproject (1.6.37). That (a) compiles cairo's png code against 1.6.37
  # headers while the final link provides the sysroot port 1.6.58 — a real
  # (small) artifact difference, and (b) adds a pngtest executable whose emcc
  # link cannot resolve __resumeException (its objects are built with
  # -fexceptions -> reference the JS-EH symbol, but meson's link line omits
  # the exception runtime; emsdk 6.0.8 defaults DISABLE_EXCEPTION_CATCHING=1
  # so libexceptions.js is dropped). Pinning cairo to the sysroot port via this
  # pkg-config shim + --wrap-mode=nofallback gives it the same libpng 1.6.58
  # the final link uses (determinism gate: reproduces the pre-gate artifact
  # byte-for-byte) and removes pngtest from the build graph.
  cat > "$PREFIX/lib/pkgconfig/libpng.pc" <<EOF
prefix=$SYSROOT
libdir=\${prefix}/lib/wasm32-emscripten
includedir=\${prefix}/include
Name: libpng
Version: 1.6.58
Description: libpng (emscripten port)
Libs: -L\${libdir} -lpng
Cflags: -I\${includedir}
EOF
  meson setup "$B" "$SRC/cairo" \
    --cross-file "$CROSS" --prefix "$PREFIX" \
    --default-library=static --buildtype=release \
    --wrap-mode=nofallback \
    -Dc_args="-O2 -fexceptions -DCAIRO_NO_MUTEX=1 -Wno-incompatible-pointer-types -Wno-int-conversion" \
    -Dcpp_args="-O2 -fexceptions -DCAIRO_NO_MUTEX=1 -Wno-incompatible-pointer-types -Wno-int-conversion" \
    -Dtests=disabled -Dglib=disabled -Dgtk2-utils=disabled \
    -Dspectre=disabled -Dgtk_doc=false -Dsymbol-lookup=disabled \
    -Ddwrite=disabled -Dquartz=disabled -Dxcb=disabled -Dxlib=disabled \
    -Dxlib-xcb=disabled -Dtee=disabled -Dxml=disabled \
    -Dpng=enabled -Dzlib=disabled \
    -Dfontconfig=enabled -Dfreetype=enabled
  meson install -C "$B"
  done_stamp cairo
}

stage_poppler() {
  stamp poppler && { echo "[skip] poppler"; return; }
  local B=$BUILD/poppler
  rm -rf "$B"
  emcmake cmake -S "$SRC/poppler" -B "$B" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DCMAKE_PREFIX_PATH="$PREFIX" \
    -DCMAKE_FIND_ROOT_PATH="$PREFIX;$SYSROOT" \
    -DBUILD_SHARED_LIBS=OFF \
    -DBUILD_GTK_TESTS=OFF -DBUILD_QT5_TESTS=OFF -DBUILD_QT6_TESTS=OFF \
    -DBUILD_CPP_TESTS=OFF -DBUILD_MANUAL_TESTS=OFF \
    -DENABLE_CPP=OFF -DENABLE_GLIB=OFF -DENABLE_QT5=OFF -DENABLE_QT6=OFF \
    -DENABLE_GOBJECT_INTROSPECTION=OFF -DENABLE_GTK_DOC=OFF \
    -DENABLE_LCMS=OFF -DENABLE_LIBCURL=OFF -DENABLE_NSS3=OFF \
    -DENABLE_GPGME=OFF -DENABLE_LIBTIFF=OFF -DENABLE_BOOST=OFF \
    -DENABLE_SPLASH=ON -DENABLE_ZLIB=ON \
    -DENABLE_DCTDECODER=libjpeg -DENABLE_LIBPNG=ON \
    -DENABLE_LIBOPENJPEG=none \
    -DRUN_GPERF_IF_PRESENT=OFF \
    -DFONT_CONFIGURATION=fontconfig \
    -DCMAKE_C_FLAGS="-O2 -fexceptions" \
    -DCMAKE_CXX_FLAGS="-O2 -fexceptions" \
    -DZLIB_LIBRARY="$SYSROOT/lib/wasm32-emscripten/libz.a" \
    -DZLIB_INCLUDE_DIR="$SYSROOT/include" \
    -DJPEG_LIBRARY="$SYSROOT/lib/wasm32-emscripten/libjpeg.a" \
    -DJPEG_INCLUDE_DIR="$SYSROOT/include" \
    -DPNG_LIBRARY="$SYSROOT/lib/wasm32-emscripten/libpng.a" \
    -DPNG_PNG_INCLUDE_DIR="$SYSROOT/include" \
    -DFREETYPE_LIBRARY="$PREFIX/lib/libfreetype.a" \
    -DFREETYPE_INCLUDE_DIRS="$PREFIX/include/freetype2" \
    -DFONTCONFIG_LIBRARY="$FCSTAGE/usr/lib/libfontconfig.a" \
    -DFONTCONFIG_INCLUDE_DIRS="$FCSTAGE/usr/include" \
    -DPOPPLER_DATADIR=/usr/share/poppler
  # CMake's own link of the pdftocairo executable fails (its link line omits
  # pixman, a cairo private dep) — that's fine: we relink manually in the
  # link stage. Success criterion = all needed objects were compiled.
  cmake --build "$B" --target pdftocairo || true
  # CMake emits sibling poppler objects under __/poppler (its `..` encoding),
  # matching the object list stage_link uses below.
  local OBJ=$B/utils/CMakeFiles/pdftocairo.dir
  for f in pdftocairo.cc.o __/poppler/CairoFontEngine.cc.o __/poppler/CairoOutputDev.cc.o __/poppler/CairoRescaleBox.cc.o; do
    [ -f "$OBJ/$f" ] || { echo "missing object $OBJ/$f" >&2; exit 1; }
  done
  [ -f "$B/libpoppler.a" ] || { echo "missing $B/libpoppler.a" >&2; exit 1; }
  done_stamp poppler
}

# Final link: run emcc manually against the objects cmake produced, so we
# control the JS glue flags exactly (MODULARIZE / INVOKE_RUN / callMain / FS).
stage_link() {
  stamp link && { echo "[skip] link"; return; }
  local B=$BUILD/poppler
  local OBJDIR=$B/utils/CMakeFiles/pdftocairo.dir
  local OBJ="$OBJDIR/pdftocairo.cc.o"
  [ -f "$OBJ" ] || { echo "missing $OBJ — run poppler stage first" >&2; exit 1; }
  rm -f "$OUT/pdftocairo.js" "$OUT/pdftocairo.wasm"
  em++ -O2 -fexceptions \
    "$OBJDIR/pdftocairo.cc.o" \
    "$OBJDIR/parseargs.cc.o" \
    "$OBJDIR/Win32Console.cc.o" \
    "$OBJDIR/__/poppler/CairoFontEngine.cc.o" \
    "$OBJDIR/__/poppler/CairoOutputDev.cc.o" \
    "$OBJDIR/__/poppler/CairoRescaleBox.cc.o" \
    "$B/libpoppler.a" \
    "$PREFIX/lib/libcairo.a" \
    "$FCSTAGE/usr/lib/libfontconfig.a" \
    "$PREFIX/lib/libpixman-1.a" \
    "$PREFIX/lib/libfreetype.a" \
    "$FCSTAGE/usr/lib/libexpat.a" \
    "$SYSROOT/lib/wasm32-emscripten/libpng.a" \
    "$SYSROOT/lib/wasm32-emscripten/libjpeg.a" \
    "$SYSROOT/lib/wasm32-emscripten/libz.a" \
    -o "$OUT/pdftocairo.js" \
    -sMODULARIZE=1 -sEXPORT_NAME=Module \
    -sINVOKE_RUN=0 \
    -sEXPORTED_RUNTIME_METHODS=callMain,FS \
    -sEXPORTED_FUNCTIONS=_main \
    -sALLOW_MEMORY_GROWTH=1 \
    -sNO_DISABLE_EXCEPTION_CATCHING \
    -sENVIRONMENT=web,worker,node \
    -sERROR_ON_UNDEFINED_SYMBOLS=0 \
    -sAUTO_NATIVE_LIBRARIES=0
  done_stamp link
}

stage_strip() {
  stamp strip && { echo "[skip] strip"; return; }
  # Feature flags: the wasm uses bulk-memory / sign-ext / nontrapping-float /
  # atomics opcodes; without them wasm-opt's validator rejects the input.
  # NOT --all-features: that also enables --enable-compact-imports, which
  # rewrites the import section into a non-standard compact form V8 rejects
  # ("unknown import kind 0x7f") even though wasm-opt's own validator passes.
  # Note the emcc link above runs without -g, so the wasm carries no DWARF /
  # name / producers sections to begin with and the strip passes are a no-op
  # (stripped output is byte-identical to the input) — the forced strip is
  # kept as a guard against future flags leaking debug info into the artifact.
  ~/emsdk/upstream/bin/wasm-opt \
    --enable-bulk-memory --enable-sign-ext \
    --enable-nontrapping-float-to-int --enable-threads \
    --strip-debug --strip-producers \
    "$OUT/pdftocairo.wasm" -o "$OUT/pdftocairo.stripped.wasm"
  node "$ROOT/scripts/embed-wasm.js" \
    "$OUT/pdftocairo.js" "$OUT/pdftocairo.stripped.wasm" "$OUT/pdftocairo.stripped.js"
  done_stamp strip
}

if [ $# -gt 0 ]; then stages=("$@"); else stages=(gperf freetype pixman fontconfig cairo poppler link strip); fi
for s in "${stages[@]}"; do
  "stage_$s"
done
echo "ALL DONE"
