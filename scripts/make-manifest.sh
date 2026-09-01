#!/usr/bin/env bash
# Generate build/engine-manifest.json for the swiftpdftex-v1 engine release.
#
# Inputs — the four release assets (release name = what the plugin-side
# engine manifest downloader expects):
#   build/swiftlatexpdftex.worker.js            (ship worker, web,worker)
#   build/swiftlatexpdftex.fmt                  (TL2025 format dump)
#   build/out/pdftocairo.stripped.js  ->  name "pdftocairo.js" (single-file,
#                                          wasm embedded)
#   build/texfiles.tar.gz                       (TL2025 file closure pack)
#
# Fingerprint recipe (fixed forever, recomputable from this file):
#   1. take the hex sha256 of each asset, in the assets array order above
#      (lowercase hex, no separators)
#   2. concat  = h(worker) + h(fmt) + h(pdftocairo) + h(texfiles)
#   3. fingerprint = sha256( concat + "2025" )
#      where "2025" is the TeX Live baseline string (toolchain.lock.json
#      "texlive": "2025")
#
# Output shape is isomorphic to the plugin-side manifest
# (src/engine/swift/engine-manifest.json in obsidian-texkit):
#   { engineVersion, fingerprint, baseUrl, assets: [ {name, sha256, bytes} x4 ] }
#
# build/engine-manifest.json is a generated artifact (gitignored); its asset
# hashes are recorded in docs/determinism.md and the file itself ships as a
# release attachment (scripts/publish.sh).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$ROOT/build/engine-manifest.json

ENGINE_VERSION=swiftpdftex-v1
BASEURL=https://github.com/WeMingT/texkit-swiftlatex/releases/download/engine-v1/
TL_BASELINE=2025

# (release name, repo path) — array order == assets order == fingerprint order
ASSETS=(
  "swiftlatexpdftex.worker.js|$ROOT/build/swiftlatexpdftex.worker.js"
  "swiftlatexpdftex.fmt|$ROOT/build/swiftlatexpdftex.fmt"
  "pdftocairo.js|$ROOT/build/out/pdftocairo.stripped.js"
  "texfiles.tar.gz|$ROOT/build/texfiles.tar.gz"
)

concat=
json_assets=
for entry in "${ASSETS[@]}"; do
  name=${entry%%|*}
  path=${entry#*|}
  if [ ! -f "$path" ]; then
    echo "error: asset missing: $path" >&2
    exit 1
  fi
  h=$(sha256sum "$path" | cut -d' ' -f1)
  b=$(stat -c%s "$path")
  concat+=$h
  json_assets+="\t\t{\n\t\t\t\"name\": \"$name\",\n\t\t\t\"sha256\": \"$h\",\n\t\t\t\"bytes\": $b\n\t\t},\n"
  printf '[manifest] %-28s %s  %s B\n' "$name" "$h" "$b"
done

# strip the trailing comma+newline of the last asset entry
json_assets=${json_assets%,\\n}
json_assets+='\n'

fingerprint=$(printf '%s%s' "$concat" "$TL_BASELINE" | sha256sum | cut -d' ' -f1)

printf '[manifest] fingerprint = sha256("%s%s") = %s\n' \
  "$concat" "$TL_BASELINE" "$fingerprint"

{
  printf '{\n'
  printf '\t"engineVersion": "%s",\n' "$ENGINE_VERSION"
  printf '\t"fingerprint": "%s",\n' "$fingerprint"
  printf '\t"baseUrl": "%s",\n' "$BASEURL"
  printf '\t"assets": [\n'
  printf '%b' "$json_assets"
  printf '\t]\n'
  printf '}\n'
} > "$OUT"

echo "[manifest] wrote $OUT"
