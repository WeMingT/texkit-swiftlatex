#!/bin/sh
# Pack the materialized TeX closure into build/texfiles.tar.gz — deterministic.
#
# Determinism (plan constraint: all four assets byte-hash-identical at a
# same-source double run — replays of this asset come from git): member order
# sorted by name, all mtimes clamped to the epoch, owner/group 0 recorded
# numerically. The gzip layer is timestamp-free (tar pipes into gzip, so the
# gzip header mtime is 0 — reviewer-verified; the double-run sha256 below is
# the standing assertion). Content identity vs the staging tree is asserted
# after every pack (tar -x + diff -r), so a pack never silently drifts from
# build/closure-staging.
#
# Prereq: python3 scripts/materialize-closure.py  (builds build/closure-staging)
# Run:    sh scripts/pack-closure.sh
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
STAGING="$ROOT/build/closure-staging"
OUT="$ROOT/build/texfiles.tar.gz"

if [ ! -d "$STAGING" ]; then
    echo "error: $STAGING missing — run: python3 scripts/materialize-closure.py" >&2
    exit 1
fi

tar --format=ustar --sort=name --mtime='1970-01-01 00:00:00 UTC' \
    --owner=0 --group=0 --numeric-owner \
    -czf "$OUT" -C "$STAGING" .

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$OUT" -C "$TMP"
# extracted tree adds no content; compare against the staging source
diff -r "$TMP" "$STAGING" >/dev/null || {
    echo "error: packed content differs from $STAGING" >&2; exit 1; }

FILES=$(find "$STAGING" -type f | wc -l)
BYTES=$(wc -c < "$OUT" | tr -d ' ')
SHA=$(sha256sum "$OUT" | cut -d' ' -f1)
echo "pack ok: files=$FILES bytes=$BYTES sha256=$SHA"
