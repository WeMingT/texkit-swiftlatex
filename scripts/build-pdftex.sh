#!/usr/bin/env bash
# Build the release inputs inside the pinned builder.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
export TEXMF_DIST="$TEXLIVE_ROOT/texmf-dist"
export KPSEWHICH="$TEXLIVE_ROOT/bin/x86_64-linux/kpsewhich"
worker() { bash scripts/build-worker.sh; }
fmt() { bash scripts/build-fmt.sh; }
closure() {
  python3 scripts/derive-closure.py
  git diff --exit-code -- closure/
  python3 scripts/materialize-closure.py
  sh scripts/pack-closure.sh
  python3 scripts/check-font-whitelist.py
}
manifest() {
  ENGINE_VERSION=swiftpdftex-v2 RELEASE_TAG=engine-v2 bash scripts/make-manifest.sh
}
case "${1:-}" in
  worker) worker ;;
  fmt) fmt ;;
  closure) closure ;;
  manifest) manifest ;;
  all) worker; fmt; closure; manifest; bash scripts/pack-tex-sources.sh ;;
  *) echo "usage: build-pdftex.sh worker|fmt|closure|manifest|all" >&2; exit 1 ;;
esac
