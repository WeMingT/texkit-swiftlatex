#!/usr/bin/env bash
# Run commands in the pinned toolchain without inheriting host tool state.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
mount_path=/src/texkit-swiftlatex
network=bridge
while (($#)); do
  case "$1" in
    --mount|--network)
      (($# >= 2)) || { echo "missing value: $1" >&2; exit 1; }
      case "$1" in
        --mount) mount_path=$2 ;;
        --network) network=$2 ;;
      esac
      shift 2 ;;
    --) shift; break ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done
(($#)) || { echo "a command is required after --" >&2; exit 1; }
[[ "$mount_path" == /* && "$mount_path" != *$'\n'* ]] || {
  echo "mount path must be absolute and contain no newline" >&2; exit 1;
}
[[ "$network" == none || "$network" == bridge ]] || {
  echo "network must be none or bridge" >&2; exit 1;
}
image_hash=$(python3 - "$ROOT" <<'PYCODE'
import hashlib
import json
from pathlib import Path
import sys
root = Path(sys.argv[1])
lock = json.loads((root / "toolchain.lock.json").read_text())
dockerfile = root / "docker/builder.Dockerfile"
images = [line.split()[1] for line in dockerfile.read_text().splitlines()
          if line.startswith("FROM ")]
if images != [lock["builderTexliveImage"], lock["builderEmsdkImage"]]:
    sys.exit("builder Dockerfile images do not match toolchain.lock.json")
payload = dockerfile.read_bytes() + (root / "docker/requirements.txt").read_bytes()
print(hashlib.sha256(payload).hexdigest()[:12])
PYCODE
)
image_tag="texkit-builder:${image_hash}"
if ! docker image inspect "$image_tag" >/dev/null 2>&1; then
  docker build -f "$ROOT/docker/builder.Dockerfile" -t "$image_tag" "$ROOT/docker/"
fi
gitdir=$(git -C "$ROOT" rev-parse --path-format=absolute --git-dir)
common=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)
metadata=()
if [[ "$gitdir" != "$common" ]]; then
  [[ "$gitdir" == "$common/"* ]] || {
    echo "linked worktree gitdir must be inside its common directory" >&2; exit 1;
  }
  metadata=(-v "$common:$common:ro")
fi
host_needles="${HOME}:$(hostname):${ROOT}"
exec docker run --rm --network "$network" \
  -v "$ROOT:$mount_path" "${metadata[@]}" -w "$mount_path" \
  -e SOURCE_DATE_EPOCH=1735689600 -e FORCE_SOURCE_DATE=1 \
  -e TEXLIVE_ROOT=/usr/local/texlive/2025 -e EMSDK=/emsdk \
  -e "EM_CACHE=$mount_path/build/em-cache" -e GIT_OPTIONAL_LOCKS=0 \
  -e "TEXKIT_HOST_NEEDLES=$host_needles" \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory \
  -e "GIT_CONFIG_VALUE_0=$mount_path" \
  "$image_tag" bash -c 'export EM_CACHE="$PWD/build/em-cache"; exec "$@"' bash "$@"
