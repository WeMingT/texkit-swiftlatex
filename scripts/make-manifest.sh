#!/usr/bin/env bash
# Generate the ordered four-asset manifest, or test its validation offline.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export ENGINE_VERSION=${ENGINE_VERSION:-swiftpdftex-v2}
export RELEASE_TAG=${RELEASE_TAG:-engine-v2}
python3 - "$ROOT" "$@" <<'PY'
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(sys.argv[1])
NAMES = ("swiftlatexpdftex.worker.js", "swiftlatexpdftex.fmt", "pdftocairo.js", "texfiles.tar.gz")
BUDGET = 52428800


def manifest(directory, names=NAMES):
    if tuple(names) != NAMES:
        raise ValueError("asset order does not match the fingerprint contract")
    sizes = [(directory / name).stat().st_size for name in names]
    if any(size == 0 for size in sizes):
        raise ValueError("assets must be nonempty")
    if sum(sizes) > BUDGET:
        raise ValueError("four-asset size budget exceeded")
    assets = [{"name": name, "sha256": hashlib.sha256((directory / name).read_bytes()).hexdigest(), "bytes": size}
              for name, size in zip(names, sizes)]
    fingerprint = hashlib.sha256(("".join(a["sha256"] for a in assets) + "2025").encode()).hexdigest()
    return {"engineVersion": os.environ["ENGINE_VERSION"], "fingerprint": fingerprint,
            "baseUrl": "https://github.com/WeMingT/texkit-swiftlatex/releases/download/" + os.environ["RELEASE_TAG"] + "/",
            "assets": assets}


def self_test():
    (ROOT / "build").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="manifest-test-", dir=ROOT / "build") as temporary:
        directory = Path(temporary)
        for name, data in zip(NAMES, (b"worker", b"format", b"converter", b"closure")):
            (directory / name).write_bytes(data)
        result = manifest(directory)
        assert result["fingerprint"] == "8c8810f0d738509b7cf3a2ee87a9c1df4bd2bce3d70a64bdad1b608b7be6bec0"
        print("PASS fixed fingerprint")

        def rejected(label, operation):
            try:
                operation()
            except (OSError, ValueError):
                print("PASS " + label)
                return
            raise AssertionError(label + " was accepted")

        (directory / NAMES[-1]).unlink()
        rejected("missing asset", lambda: manifest(directory))
        (directory / NAMES[-1]).write_bytes(b"closure")
        rejected("incorrect order", lambda: manifest(directory, tuple(reversed(NAMES))))
        with (directory / NAMES[0]).open("wb") as asset:
            asset.truncate(BUDGET + 1)
        rejected("size budget", lambda: manifest(directory))


def main():
    if sys.argv[2:] == ["--self-test"]:
        self_test()
        return
    if sys.argv[2:]:
        raise ValueError("usage: make-manifest.sh [--self-test]")
    directory = ROOT / "build" / "engine-v2"
    directory.mkdir(parents=True, exist_ok=True)
    converter = ROOT / "src" / "engine-v1" / "pdftocairo.js"
    pinned = json.loads((ROOT / "toolchain.lock.json").read_text())["engineV1Assets"]["pdftocairo.js"]
    if converter.stat().st_size != pinned["bytes"] or hashlib.sha256(converter.read_bytes()).hexdigest() != pinned["sha256"]:
        raise ValueError("pdftocairo does not match the pinned input")
    shutil.copyfile(converter, directory / "pdftocairo.js")
    shutil.copyfile(ROOT / "build" / "texfiles.tar.gz", directory / "texfiles.tar.gz")
    result = manifest(directory)
    output = directory / "engine-manifest.json"
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


try:
    main()
except (OSError, ValueError, AssertionError) as error:
    print("manifest: " + str(error), file=sys.stderr)
    sys.exit(1)
PY
