#!/usr/bin/env bash
# Build build/swiftlatexpdftex.fmt from the local TeX Live 2025 corpus by
# driving the worker's compileformat path (iniTeX *pdflatex.ini -> latex.ltx
# -> \dump). build-fmt.mjs is the driver; this shell adds the determinism gate:
#
#   1. two independent pinned builds into build/fmt-out/
#   2. byte-compare gate (sha256) — any difference fails the build
#   3. install run 1 as build/swiftlatexpdftex.fmt
#
# Determinism: storefmtfile() embeds \year/\month/\day in the format banner
# and the eqtb dump carries \time/\day/\month/\year, so an unpinned build
# drifts with the wall clock (measured: exactly one byte — the eqtb \time
# register — between builds a minute apart; the date registers follow across
# days). The engine re-reads the clock at every compile start (dateandtime in
# pdftexini.c runs after format load), so pinning affects only the dumped
# bytes, never compile behavior. PIN below is fixed forever so the artifact
# hash is reproducible across days; it is pinned to the corpus identity
# (LaTeX2e kernel release date of TL2025), not to any build day.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$ROOT/build/fmt-out
FMT=$ROOT/build/swiftlatexpdftex.fmt
PIN=2025.11.1.0   # \year=2025 \month=11 \day=1 \time=0

mkdir -p "$OUT"
for i in 1 2; do
  FMT_PIN_DATE=$PIN node "$ROOT/scripts/build-fmt.mjs" "$OUT/fmt-run$i"
done

h1=$(sha256sum "$OUT/fmt-run1.fmt" | cut -d' ' -f1)
h2=$(sha256sum "$OUT/fmt-run2.fmt" | cut -d' ' -f1)
echo "[fmt] run1 sha256 $h1"
echo "[fmt] run2 sha256 $h2"
if [ "$h1" != "$h2" ]; then
  echo "[fmt] DETERMINISM GATE FAILED: double-build hashes differ" >&2
  exit 1
fi
cp "$OUT/fmt-run1.fmt" "$FMT"
echo "[fmt] deterministic -> $FMT ($(stat -c%s "$FMT") bytes)"
ls -la "$FMT"
