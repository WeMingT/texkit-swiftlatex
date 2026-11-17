#!/usr/bin/env bash
# Pack verified stock inputs and official archives with neutral metadata.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
python3 scripts/tex-sources.py stage
tar --format=ustar --sort=name --mtime='1970-01-01 00:00:00 UTC' \
  --owner=0 --group=0 --numeric-owner --mode='u=rwX,go=rX' \
  -cf - -C build/tex-source-staging . | gzip -n > build/engine-v2/tex-sources.tar.gz
python3 scripts/tex-sources.py check
python3 scripts/tex-sources.py identity
