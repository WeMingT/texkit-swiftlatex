#!/usr/bin/env bash
# Materialize the six pinned upstream source trees into src/ on a fresh
# clone (src/ is gitignored by design — trees are re-fetched, not versioned).
# Run this before scripts/build-pdftocairo.sh, scripts/build-worker.sh or
# scripts/build-fmt.sh: they all read their sources from src/.
#
# Pins — single source of truth: toolchain.lock.json (read below via pin()):
#   swiftlatex  swiftlatexCommit
#   poppler     popplerCommit (tag poppler-24.03.0)
#   cairo       cairoCommit
#   freetype    freetypeCommit
#   pixman      pixmanCommit
#   fontconfig  fontconfigVersion + fontconfigTarballSha256 (release tarball, no .git)
#
# NOT fetched: pangoCairoWasmCommit — src/pango-cairo-wasm is an
# evidence-only tree from the pdftocairo provenance analysis (see
# docs/decision-2026-08-30-pdftocairo-wrapper.md); no build reads it.
#
# Recipes mirror the clones this branch actually built from:
#   - SwiftLaTeX: full clone (github.com), detached checkout at the pin
#   - gitlab.freedesktop.org trees: depth-1 clone of the default branch,
#     then `git fetch --depth 1 origin <pin>` + detached checkout (exactly
#     what the working clones' FETCH_HEAD records; poppler was cloned with
#     --branch poppler-24.03.0 — same tree either way, kept as-is)
#   - fontconfig: freedesktop.org release tarball, sha256-gated
#
# Idempotent: a git tree already at its pin is skipped. A git tree at any
# other revision FAILS loudly (no auto-reset — a moved tree is a surprise
# to investigate, not to clobber). fontconfig has no post-hoc pin to check
# (no .git): the sha256 gate applies at fetch time; an existing non-empty
# directory is skipped with a note.
#
# Usage: scripts/fetch-sources.sh   (no arguments; fetches/verifies all six)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC=$ROOT/src
LOCK=$ROOT/toolchain.lock.json
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

pin() { # pin <field> — read a pin from toolchain.lock.json
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' \
    "$LOCK" "$1"
}

die() { echo "ERROR: $*" >&2; exit 1; }

# If src/<name> exists as a git checkout: skip when HEAD == <pin>, else die.
# Returns 1 (fetch needed) only when the tree is absent.
tree_at_pin() { # tree_at_pin <name> <pin>
  local dir=$SRC/$1 pin=$2 head
  if [ -d "$dir/.git" ]; then
    head=$(git -C "$dir" rev-parse HEAD) || die "cannot read HEAD in src/$1"
    if [ "$head" = "$pin" ]; then
      echo "[skip] $1 @ $pin"
      return 0
    fi
    die "src/$1 is at $head but the pin is $pin — not auto-resetting; inspect the tree or delete src/$1 to re-fetch"
  fi
  if [ -e "$dir" ]; then
    die "src/$1 exists but has no .git (expected a git checkout)"
  fi
  return 1
}

verify_pin() { # verify_pin <name> <pin>
  local head
  head=$(git -C "$SRC/$1" rev-parse HEAD)
  [ "$head" = "$2" ] || die "src/$1 fetched to $head, expected $2"
  echo "[ok] $1 @ $head"
}

fetch_git() { # fetch_git <name> <url> <pin> [clone-args...]
  local name=$1 url=$2 pin=$3
  shift 3
  if tree_at_pin "$name" "$pin"; then return 0; fi
  echo "[fetch] $name @ $pin  $url"
  git clone "$@" "$url" "$SRC/$name"
  # A depth-1 clone of the default branch does not contain historical pins.
  if [ "${1:-}" = "--depth" ]; then
    git -C "$SRC/$name" fetch --depth 1 origin "$pin"
  fi
  git -C "$SRC/$name" checkout --detach "$pin"
  verify_pin "$name" "$pin"
}

fetch_fontconfig() {
  local version=$(pin fontconfigVersion)
  local sha256=$(pin fontconfigTarballSha256)
  local url=https://www.freedesktop.org/software/fontconfig/release/fontconfig-$version.tar.gz
  local dir=$SRC/fontconfig
  if [ -d "$dir" ] && [ -n "$(ls -A "$dir")" ]; then
    # No .git => no post-hoc pin check. Provenance of the tree this branch
    # built from was verified 2026-08-31: diff -r of a fresh extract of this
    # tarball against it showed identical content (only meson's wrap-resolved
    # subprojects/expat-2.2.6 + packagecache added, which the tarball's own
    # expat.wrap hash-pins and meson re-creates at setup time).
    echo "[skip] fontconfig (non-empty dir present; sha256 gate applies at fetch time only)"
    return 0
  fi
  echo "[fetch] fontconfig $version  $url"
  curl -fSL --speed-limit 2048 --speed-time 45 -o "$TMP/fontconfig-$version.tar.gz" "$url"
  echo "$sha256  $TMP/fontconfig-$version.tar.gz" | sha256sum -c -
  tar -C "$TMP" -xzf "$TMP/fontconfig-$version.tar.gz"
  rmdir "$dir" 2>/dev/null || true   # only removes an empty leftover dir
  mv "$TMP/fontconfig-$version" "$dir"
  echo "[ok] fontconfig $version (sha256 verified)"
}

mkdir -p "$SRC"

fetch_git swiftlatex https://github.com/SwiftLaTeX/SwiftLaTeX.git \
  "$(pin swiftlatexCommit)"
fetch_git poppler https://gitlab.freedesktop.org/poppler/poppler.git \
  "$(pin popplerCommit)" --depth 1 --branch poppler-24.03.0
fetch_git cairo https://gitlab.freedesktop.org/cairo/cairo.git \
  "$(pin cairoCommit)" --depth 1
fetch_git freetype https://gitlab.freedesktop.org/freetype/freetype.git \
  "$(pin freetypeCommit)" --depth 1
fetch_git pixman https://gitlab.freedesktop.org/pixman/pixman.git \
  "$(pin pixmanCommit)" --depth 1
fetch_fontconfig

echo "ALL SOURCES READY"
