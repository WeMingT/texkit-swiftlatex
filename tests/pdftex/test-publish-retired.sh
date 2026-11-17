#!/usr/bin/env bash
# Reject legacy publication before any remote command, for every old mode.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/scripts" "$fixture/bin" "$fixture/build/out"
cp "$ROOT/scripts/publish.sh" "$fixture/scripts/publish.sh"
printf 'Fixture notices\n' > "$fixture/THIRD-PARTY-NOTICES.md"
cat > "$fixture/bin/gh" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$0 $*" >> "$TEXKIT_REMOTE_MARKER"
exit 99
SH
cp "$fixture/bin/gh" "$fixture/bin/curl"
chmod +x "$fixture/bin/gh" "$fixture/bin/curl"
python3 - "$fixture" <<'PY'
import hashlib, json, sys
from pathlib import Path
root = Path(sys.argv[1])
names = ['swiftlatexpdftex.worker.js', 'swiftlatexpdftex.fmt', 'pdftocairo.js', 'texfiles.tar.gz']
assets = []
for i, name in enumerate(names):
    data = bytes([65 + i])
    target = root / 'build' / ('out/pdftocairo.stripped.js' if name == 'pdftocairo.js' else name)
    target.write_bytes(data)
    assets.append({'name': name, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': 1})
fingerprint = hashlib.sha256((''.join(a['sha256'] for a in assets) + '2025').encode()).hexdigest()
(root / 'build/engine-manifest.json').write_text(json.dumps({
    'engineVersion': 'swiftpdftex-v2', 'fingerprint': fingerprint,
    'baseUrl': 'https://github.com/WeMingT/texkit-swiftlatex/releases/download/engine-v2/',
    'assets': assets}) + '\n')
PY
failed=0
for mode in none yes rebuild; do
  args=()
  case "$mode" in
    yes) args=(--yes) ;;
    rebuild) args=(--yes --rebuild) ;;
  esac
  marker="$fixture/remote-$mode"
  status=0
  PATH="$fixture/bin:$PATH" TEXKIT_REMOTE_MARKER="$marker" \
    bash "$fixture/scripts/publish.sh" "${args[@]}" > "$fixture/$mode.log" 2>&1 || status=$?
  if ((status == 0)) || ! grep -qi 'retired' "$fixture/$mode.log" || [[ -e "$marker" ]]; then
    printf 'FAIL %s: exit=%s remote=%s\n' "$mode" "$status" "$([[ -e "$marker" ]] && echo called || echo absent)"
    cat "$fixture/$mode.log"
    failed=1
  else
    printf 'PASS %s: rejected before remote invocation\n' "$mode"
  fi
done
exit "$failed"
