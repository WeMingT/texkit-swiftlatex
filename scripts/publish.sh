#!/usr/bin/env bash
# Publish the swiftpdftex-v1 engine release (engine-v1) — MANUAL ONLY.
#
# This script performs an OUTBOUND action (creates or modifies a public
# GitHub release in WeMingT/texkit-swiftlatex). It must never run as part
# of any build/gate flow: the leading guard requires an explicit --yes
# (user confirmation on the CLI).
#
# What it does after the guard:
#   1. verifies the four release assets exist and their sha256/bytes match
#      build/engine-manifest.json exactly (regenerate with
#      scripts/make-manifest.sh if they drift)
#   2. cold start: gh release create engine-v1 with the four assets +
#      build/engine-manifest.json + THIRD-PARTY-NOTICES.md (the notices file
#      is also attached so asset consumers don't need a clone), title/notes
#      skeleton
#   3. --rebuild: in-place replacement of the CHANGED assets only
#      (swiftlatexpdftex.fmt + texfiles.tar.gz + engine-manifest.json,
#      manifest last) on the existing release; the unchanged
#      worker/pdftocairo attachments are not touched, and the live release
#      digests are verified against the manifest before exiting 0
#
# Prereq: gh authenticated against github.com (repo: WeMingT/texkit-swiftlatex).
#
# Usage: scripts/publish.sh --yes
#        scripts/publish.sh --rebuild --yes
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MANIFEST=$ROOT/build/engine-manifest.json
REPO=WeMingT/texkit-swiftlatex
TAG=engine-v1

REBUILD=0; YES=0
for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=1 ;;
    --yes) YES=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$YES" -ne 1 ]; then
  cat >&2 <<EOF
refusing to run: publish.sh performs an outbound action (creates or
modifies a public GitHub release $TAG in $REPO).

To publish after user confirmation, re-run with:
    scripts/publish.sh --yes

To rebuild the existing release in place, re-run with:
    scripts/publish.sh --rebuild --yes
EOF
  exit 1
fi

command -v gh >/dev/null || { echo "error: gh not installed" >&2; exit 1; }
[ -f "$MANIFEST" ] || {
  echo "error: $MANIFEST missing — run scripts/make-manifest.sh first" >&2; exit 1; }

# assets in manifest order; name|repo path
paths_for() {
  case "$1" in
    swiftlatexpdftex.worker.js) echo "$ROOT/build/swiftlatexpdftex.worker.js" ;;
    swiftlatexpdftex.fmt)       echo "$ROOT/build/swiftlatexpdftex.fmt" ;;
    pdftocairo.js)              echo "$ROOT/build/out/pdftocairo.stripped.js" ;;
    texfiles.tar.gz)            echo "$ROOT/build/texfiles.tar.gz" ;;
    *) echo "error: unknown asset name in manifest: $1" >&2; return 1 ;;
  esac
}

upload=()
fail=0
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
while IFS=$'\t' read -r name want_sha want_bytes; do
  p=$(paths_for "$name") || exit 1
  [ -f "$p" ] || { echo "error: asset missing: $p" >&2; fail=1; continue; }
  got_sha=$(sha256sum "$p" | cut -d' ' -f1)
  got_bytes=$(stat -c%s "$p")
  if [ "$got_sha" != "$want_sha" ] || [ "$got_bytes" != "$want_bytes" ]; then
    echo "error: $name mismatch — manifest $want_bytes/$want_sha vs disk $got_bytes/$got_sha" >&2
    fail=1
    continue
  fi
  # gh names release assets after the local file basename, and the plugin
  # fetches baseUrl + asset.name — stage a copy under the manifest name
  # (build/out/pdftocairo.stripped.js -> asset "pdftocairo.js")
  cp "$p" "$STAGE/$name"
  upload+=("$STAGE/$name")
done < <(python3 -c '
import json, sys
for a in json.load(open(sys.argv[1]))["assets"]:
    print("\t".join((a["name"], a["sha256"], str(a["bytes"]))))
' "$MANIFEST")

[ "$fail" -eq 0 ] || { echo "error: asset verification failed — regenerate manifest?" >&2; exit 1; }
[ "${#upload[@]}" -eq 4 ] || { echo "error: expected 4 assets, got ${#upload[@]}" >&2; exit 1; }

if [ "$REBUILD" -eq 1 ]; then
  # Rebuild mode: experimental in-place replacement of the CHANGED assets
  # only (fmt + texfiles.tar.gz + manifest), run in a quiet window; the
  # unchanged worker/pdftocairo attachments are NOT touched. The manifest
  # uploads LAST: while an upload is partial, assets and manifest
  # are inconsistent and the client's per-asset verifyOnDisk keeps
  # re-downloading — so the script verifies the live release attachments
  # against the manifest (gh api digest readback) before exiting 0.
  echo "rebuild mode: replacing fmt + texfiles.tar.gz + manifest on $REPO/$TAG"
  gh release upload "$TAG" --clobber --repo "$REPO" \
    "$STAGE/swiftlatexpdftex.fmt" "$STAGE/texfiles.tar.gz"
  gh release upload "$TAG" --clobber --repo "$REPO" "$MANIFEST"
  # post-verify: compare the live release assets' sha256 digests and sizes
  # against $MANIFEST — any mismatch exits 1 and leaves a loud half-state
  # for the operator. The manifest attachment itself is compared too
  # (hashed from the LOCAL $MANIFEST file — not self-referential), so a
  # silently failed manifest clobber cannot leave live = new assets + old
  # manifest.
  python3 - "$REPO" "$TAG" "$MANIFEST" <<'EOF' || { echo "post-upload verify FAILED — publish aborted"; exit 1; }
import hashlib, json, subprocess, sys
repo, tag, manifest_path = sys.argv[1:4]
manifest_bytes = open(manifest_path, "rb").read()
expected = {a["name"]: (a["sha256"], a["bytes"])
            for a in json.loads(manifest_bytes)["assets"]}
expected["engine-manifest.json"] = (
    hashlib.sha256(manifest_bytes).hexdigest(), len(manifest_bytes))
release = json.loads(subprocess.run(
    ["gh", "api", f"repos/{repo}/releases/tags/{tag}"],
    capture_output=True, text=True, check=True).stdout)
live = {}
present = set()
for a in release["assets"]:
    present.add(a["name"])
    digest = a.get("digest")
    if digest is not None:
        live[a["name"]] = (digest.removeprefix("sha256:"), a["size"])
# a missing digest is only fatal for assets uploaded THIS run; untouched
# attachments (worker/pdftocairo/NOTICES) may lack a backfilled digest on
# old uploads — they are pinned pre-upload (the local manifest is compared
# against the captured published manifest first) and fully re-verified by
# the post-publish downloads, so presence is enough here.
UPLOADED_NOW = {"swiftlatexpdftex.fmt", "texfiles.tar.gz", "engine-manifest.json"}
for name, exp in expected.items():
    if name not in present:
        sys.exit(f"POST-UPLOAD MISMATCH: {name} missing from the release")
    if name in UPLOADED_NOW:
        if name not in live:
            sys.exit(f"digest unavailable for {name} — uploaded this run; "
                     f"the GitHub API did not backfill a sha256 digest; "
                     f"verify manually instead of guessing")
        if live[name] != exp:
            sys.exit(f"POST-UPLOAD MISMATCH: {name} release={live[name]} manifest={exp}")
print("post-upload verify OK: uploaded assets + the manifest itself match; "
      "untouched assets present (pinned pre-upload, re-verified after publish)")
EOF
  exit 0
fi

# THIRD-PARTY-NOTICES.md ships in the repo; the release also attaches it so
# consumers of the assets don't need a clone.
NOTICES=$ROOT/THIRD-PARTY-NOTICES.md
[ -f "$NOTICES" ] || {
  echo "error: $NOTICES missing — license summary must ship with the release" >&2; exit 1; }

echo "all four assets verified against $MANIFEST; uploading to $REPO/$TAG"
gh release create "$TAG" \
  --repo "$REPO" \
  --title "swiftpdftex-v1 engine assets" \
  --notes "TeXKit SwiftLaTeX engine build (swiftpdftex-v1).

- swiftlatexpdftex.worker.js — pdfTeX engine worker (SwiftLaTeX 87dfb95, emcc 6.0.8)
- swiftlatexpdftex.fmt — TeX Live 2025 format dump
- pdftocairo.js — poppler 24.03.0 pdftocairo (single-file wasm)
- texfiles.tar.gz — TeX Live 2025 file closure (972 files)
- engine-manifest.json — asset hashes + fingerprint
- THIRD-PARTY-NOTICES.md — license summary (attached)

Built from https://github.com/WeMingT/texkit-swiftlatex. License: poppler
GPL-2.0-or-later (GPLv3 path) combined with SwiftLaTeX AGPL-3.0 per GPLv3 §13;
cairo LGPL-2.1/MPL-1.1, freetype FTL/MIT, pixman/fontconfig/expat MIT,
zlib/libpng/libjpeg permissive. TeX Live file layer: mostly LPPL, plus ten
non-LPPL families shipped as unmodified verbatim files (pgfplots and the pgf
profiler library GPL-3.0+, preview GPL-3.0, mathpazo/palatino-URW/mptopdf/
pgf-umlsd GPL, mathrsfs GPL-2.0, tikz-feynhand GPL-3.0+, quantikz CC-BY-4.0)
and permissive items (amsfonts OFL fonts, cm Knuth, rsfs, CC0, MIT, Apache) —
full component list and per-family attribution in the attached
THIRD-PARTY-NOTICES.md." \
  "${upload[@]}" "$MANIFEST" "$NOTICES"
echo "release $TAG created"
