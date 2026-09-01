#!/usr/bin/env bash
# Tier-0 static privacy gate — shape-based, zero identity literals.
#
# Guards the tracked tree against the leak classes the pre-release audits
# found (2026-09-01): author-machine identity shapes, credential shapes,
# and non-English tracked text. Patterns match SHAPES, not values — this
# script must not itself embed anyone's identity, so there is nothing in
# it to leak.
#
# Allowlisted benign classes (audit-ruled, 2026-09-01):
#   /home/web_user     emscripten runtime constant (createDefaultDirectories)
#   /home/gboyd        upstream poppler maintainer evidence, quoted in docs
#   d:/texlive/2024    frozen spike-probe records under tests/spike-corpus/
#   this script        carries the pattern and allowlist literals itself
#
# Run: tests/privacy-gate.sh    (exit 0 = clean, 1 = violations)
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

fail=0
note() { printf 'privacy-gate: %s\n' "$1"; }

# --- 1. never-tracked files ----------------------------------------------
while IFS= read -r f; do
  case "$f" in
    AGENTS.md|CLAUDE.md|CLAUDE.local.md|skills-lock.json|.env*)
      note "tracked AI/personal state file: $f"; fail=1 ;;
    .claude/*|.omp/*|.superpowers/*|.agents/*)
      note "tracked AI/personal state file: $f"; fail=1 ;;
  esac
done < <(git ls-files)

# --- 2. shape scans over tracked text files -------------------------------
# grep -I skips binaries; this script is excluded everywhere because its
# own pattern/allowlist literals would self-match.
scan() { # scan <label> <ERE pattern> [allowlist ERE]
  local label=$1 pattern=$2 allow=${3:-}
  local hits
  hits=$(git ls-files -z | xargs -0 grep -IInE -- "$pattern" 2>/dev/null \
         | grep -v '^tests/privacy-gate\.sh:' || true)
  if [ -n "$allow" ] && [ -n "$hits" ]; then
    hits=$(printf '%s\n' "$hits" | grep -vE -- "$allow" || true)
  fi
  if [ -n "$hits" ]; then
    note "$label:"
    printf '%s\n' "$hits" | sed 's/^/  /'
    fail=1
  fi
}

scan "home-directory path shapes" \
     '/home/[A-Za-z0-9_.-]+' \
     '/home/(web_user|gboyd)([^A-Za-z0-9_.-]|$)'

scan "windows mount shapes" \
     '/mnt/[A-Za-z]/'

scan "macOS user-tree shapes" \
     '/Users/[A-Za-z0-9_.-]+'

scan "windows drive-letter shapes" \
     '(^|[^A-Za-z0-9])[A-Za-z]:[/\\]' \
     '^tests/spike-corpus/[^:]+:[0-9]+:.*d:/texlive/2024'

scan "credential shapes" \
     'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[bpso]-|BEGIN [A-Z ]*PRIVATE KEY'

# --- 3. non-English tracked text ------------------------------------------
cjk=$(git ls-files -z | xargs -0 grep -IInP '[\x{4e00}-\x{9fff}]' 2>/dev/null \
      | grep -v '^tests/privacy-gate\.sh:' || true)
if [ -n "$cjk" ]; then
  note "CJK characters in tracked text (English-only policy):"
  printf '%s\n' "$cjk" | sed 's/^/  /'
  fail=1
fi

# --- 4. recorded closure-list size -----------------------------------------
# Tripwire: the committed snapshot is 619 names (docs/determinism.md).
lines=$(wc -l < closure/closure-list.txt)
if [ "$lines" -ne 619 ]; then
  note "closure/closure-list.txt is $lines lines (recorded baseline: 619)"
  fail=1
fi

# --- 5. tracked .gitignore must stay neutral -------------------------------
# Inert files are disclosure surfaces too: a tracked .gitignore naming
# AI-assistant state files leaks the workflow shape to every clone
# (excess-leakage class, found 2026-09-01). Local-only ignoring belongs
# in .git/info/exclude, which is never published.
if git ls-files --error-unmatch .gitignore >/dev/null 2>&1; then
  hits=$(grep -nE 'AGENTS\.md|CLAUDE|\.omp|\.superpowers|\.agents|skills-lock|\.claude' \
        .gitignore || true)
  if [ -n "$hits" ]; then
    note "tracked .gitignore names AI-assistant state files (workflow-shape disclosure):"
    printf '%s\n' "$hits" | sed 's/^/  /'
    fail=1
  fi
fi

if [ "$fail" -eq 0 ]; then
  note "clean (shapes, credentials, language, tracked-file guard, ignore-file guard, closure count)"
fi
exit "$fail"
