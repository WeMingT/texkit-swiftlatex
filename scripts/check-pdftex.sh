#!/usr/bin/env bash
# Orchestrate every release gate with the pinned, offline builder.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
mount_args=()
if (($#)); then
  [[ "$#" == 2 && "$1" == --mount ]] || {
    echo "usage: check-pdftex.sh [--mount PATH]" >&2; exit 1;
  }
  mount_args=(--mount "$2")
fi
builder() { bash scripts/in-builder.sh "${mount_args[@]}" --network none -- "$@"; }

echo '[1/10] Artifact identity scan'
builder python3 tests/pdftex/test_scan_artifacts.py
builder python3 scripts/scan-artifacts.py \
  build/engine-v2/swiftlatexpdftex.worker.js build/engine-v2/swiftlatexpdftex.fmt \
  build/engine-v2/pdftocairo.js build/engine-v2/texfiles.tar.gz build/engine-v2/engine-manifest.json \
  build/engine-v2/tex-sources.tar.gz

echo '[2/10] Font map and manifest self-tests'
builder python3 scripts/trim-font-map.py --self-test
builder bash scripts/make-manifest.sh --self-test

echo '[3/10] Format reproducibility and preload declaration'
builder bash -euc '
python3 - <<"PY"
import hashlib
import json
from pathlib import Path
directory = Path("build/engine-v2")
installed = (directory / "swiftlatexpdftex.fmt").read_bytes()
for i in (1, 2):
    prefix = directory / "fmt-out" / f"fmt-run{i}"
    data = prefix.with_suffix(".fmt").read_bytes()
    meta = json.loads(prefix.with_suffix(".meta.json").read_text())
    assert data == installed, "format builds differ"
    assert meta["sha256"] == hashlib.sha256(data).hexdigest()
    assert meta["fmtBytes"] == len(data)
meta = json.loads((directory / "swiftlatexpdftex.fmt.meta.json").read_text())
assert meta["sha256"] == hashlib.sha256(installed).hexdigest()
assert meta["fmtBytes"] == len(installed)
print("Format bytes and both build records agree")
PY
node scripts/check-fmt-preload.mjs build/engine-v2/swiftlatexpdftex.fmt.meta.json closure/closure-list.txt
node scripts/check-pgfplots-hint.mjs
python3 scripts/check-font-redirect.py
'

echo '[4/10] Closure derivation, font whitelist and member count'
builder bash -euc '
export TEXMF_DIST="$TEXLIVE_ROOT/texmf-dist"
export KPSEWHICH="$TEXLIVE_ROOT/bin/x86_64-linux/kpsewhich"
export PDFTEX_MAP="$TEXLIVE_ROOT/texmf-var/fonts/map/pdftex/updmap/pdftex.map"
test -d "$TEXMF_DIST"
test -x "$KPSEWHICH"
test -s "$PDFTEX_MAP"
test "$(sha256sum "$PDFTEX_MAP" | cut -d " " -f 1)" = 77f9f786789230937bcd0b0cf960d43dc315561d886c68a8912e18295b743a9c
python3 scripts/derive-closure.py
git diff --exit-code -- closure/
python3 scripts/check-font-whitelist.py build/engine-v2/texfiles.tar.gz
python3 - <<"PY"
import tarfile
import re
with tarfile.open("build/engine-v2/texfiles.tar.gz", "r:gz") as archive:
    names = [member.name.rsplit("/", 1)[-1] for member in archive if member.isfile()]
assert len(names) == 1416, f"closure member count: {len(names)}"
for name in names:
    assert not re.match(r"^(t1|ts1)cm.*\.fd$", name), f"kernel FD shipped: {name}"
    assert name not in {"ot1cmr.fd", "ot1cmss.fd", "ot1cmtt.fd"}, f"preloaded FD shipped: {name}"
print("Closure has 1416 regular members and no preloaded kernel FDs")
PY
'

echo '[5/10] Release worker link contract'
builder python3 -c '
from pathlib import Path
source = Path("build/engine-v2/swiftlatexpdftex.worker.js").read_text()
for marker in ("Asyncify", "child_process", "kpsewhich", "texkitCompileFormat"):
    assert marker not in source, f"unexpected release marker: {marker}"
for name in ("kpse_find_file_js_async", "kpse_find_pk_js_async"):
    assert name in source, f"missing C import: {name}"
print("Release worker link contract passes")
'

echo '[6/10] Complete protocol suite'
builder node tests/pdftex/protocol.mjs --worker build/engine-v2/swiftlatexpdftex.worker.js \
  --closure build/engine-v2/texfiles.tar.gz --fmt build/engine-v2/swiftlatexpdftex.fmt

echo '[7/10] Complete corpus and stable record'
builder bash -euc '
python3 tests/check-results-selftest.py
node tests/corpus-gate.mjs --check
'

echo '[8/10] License audit'
builder python3 scripts/test-tex-sources.py
builder python3 scripts/tex-sources.py check
builder python3 scripts/audit-licenses.py

echo '[9/10] Four-asset manifest and size budget'
python3 - <<'PY'
import hashlib
import json
from pathlib import Path
directory = Path("build/engine-v2")
manifest = json.loads((directory / "engine-manifest.json").read_text())
names = ["swiftlatexpdftex.worker.js", "swiftlatexpdftex.fmt", "pdftocairo.js", "texfiles.tar.gz"]
assert [asset["name"] for asset in manifest["assets"]] == names
assert manifest["engineVersion"] == "swiftpdftex-v2"
assert manifest["baseUrl"] == "https://github.com/WeMingT/texkit-swiftlatex/releases/download/engine-v2/"
for asset in manifest["assets"]:
    data = (directory / asset["name"]).read_bytes()
    assert len(data) == asset["bytes"] and len(data) > 0
    assert hashlib.sha256(data).hexdigest() == asset["sha256"]
fingerprint = hashlib.sha256(("".join(asset["sha256"] for asset in manifest["assets"]) + "2025").encode()).hexdigest()
assert fingerprint == manifest["fingerprint"]
total = sum(asset["bytes"] for asset in manifest["assets"])
assert total <= 52428800, f"four-asset budget exceeded: {total}"
print(f"Four assets: {total} / 52428800 bytes")
PY
echo '[10/10] Retired publisher rejects every legacy mode'
builder bash tests/pdftex/test-publish-retired.sh
echo 'All release gates passed'
