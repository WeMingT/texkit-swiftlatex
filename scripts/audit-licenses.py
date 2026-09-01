#!/usr/bin/env python3
"""License audit: map every file in closure/closure-list.txt to its TeX Live
package and license, with independent per-file header evidence.

Sources used (file headers + texmf-dist docs + CTAN
catalogue):
  1. tlpkg/texlive.tlpdb  — runfiles (file -> package) and catalogue-license
     (package -> license; this field is TeX Live's sync of the CTAN catalogue
     "Licenses" data).
  2. kpsewhich            — resolve each closure name to its texmf-dist path.
  3. file headers         — scan the first 8 KiB of every file for license
     statements (LPPL / GPL / CC-BY / OFL / Apache / public-domain / ...).

Output: a per-family table on stdout (package, tlpdb license, CTAN path, file
count, file list) plus a header-class histogram on stderr. The 2026-09-01
closure audit (81 families + pdftex.map) is reproducible with this tool; the
obligation record is THIRD-PARTY-NOTICES.md.
"""
import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parent.parent
TL = Path(os.environ.get("TEXLIVE_ROOT", os.path.join(os.path.expanduser("~"), "texlive/2025")))
TLDB = TL / "tlpkg" / "texlive.tlpdb"
LIST = ROOT / "closure" / "closure-list.txt"
KPSEWHICH = str(TL / "bin" / "x86_64-linux" / "kpsewhich")

# ---------- 1. parse texlive.tlpdb ----------
runfile_map = {}   # texmf-dist relpath -> package
pkg_license = {}   # package -> catalogue-license (None if absent)
pkg_ctan = {}      # package -> catalogue-ctan

name_re = re.compile(r"^name (.+)$")
lic_re = re.compile(r"^catalogue-license (.+)$")
ctan_re = re.compile(r"^catalogue-ctan (.+)$")
sec_re = re.compile(r"^(runfiles|docfiles|srcfiles)(?: size=\d+)?$")
file_re = re.compile(r"^ (\S+)")

cur, section = None, None
with TLDB.open() as fh:
    for line in fh:
        line = line.rstrip("\n")
        m = name_re.match(line)
        if m:
            cur = m.group(1)
            pkg_license[cur] = None
            section = None  # later stanzas must not reuse a stale section
            continue
        if cur is None:
            continue
        m = lic_re.match(line)
        if m:
            pkg_license[cur] = m.group(1)
            continue
        m = ctan_re.match(line)
        if m:
            pkg_ctan[cur] = m.group(1)
            continue
        m = sec_re.match(line)
        if m:
            section = m.group(1)
            continue
        m = file_re.match(line)
        if m and section == "runfiles":
            runfile_map[m.group(1)] = cur

# ---------- 2. resolve closure names via kpsewhich ----------
names = [l.strip() for l in LIST.read_text().splitlines() if l.strip()]

def resolve(name):
    for args in (["-progname=pdflatex", name], [name]):
        r = subprocess.run([KPSEWHICH, *args], capture_output=True, text=True)
        p = r.stdout.strip()
        if p:
            return name, p
    return name, ""

with ThreadPoolExecutor(max_workers=8) as ex:
    path_of = dict(ex.map(resolve, names))

# ---------- 3. group by TL package ----------
families = defaultdict(list)
unmapped = []
for name in names:
    p = path_of.get(name, "")
    m = re.search(r"(texmf-dist/\S+)$", p)
    if not m:
        unmapped.append((name, p or "UNRESOLVED", "outside texmf-dist (TL-generated)"))
        continue
    pkg = runfile_map.get(m.group(1))
    if pkg is None:
        unmapped.append((name, m.group(1), "no tlpdb runfile entry"))
        continue
    families[pkg].append(name)

# ---------- 4. header scan (independent per-file evidence) ----------
HDR = [
    ("LPPL/dual", re.compile(r"LaTeX Project Public License", re.I)),
    ("GPL-3+", re.compile(r"either version 3 of the License", re.I)),
    ("GPL", re.compile(r"GNU General Public License|GNU Public License|GNU licence", re.I)),
    ("CC-BY", re.compile(r"CC-BY|Creative Commons", re.I)),
    ("Apache", re.compile(r"Apache License", re.I)),
    ("OFL", re.compile(r"Open Font License", re.I)),
    ("public-domain", re.compile(r"Public domain|publicdomain", re.I)),
]
hdr_hist = defaultdict(int)
hdr_of = {}
for name in names:
    p = path_of.get(name, "")
    full = TL / p if p.startswith("texmf-dist/") else Path(p) if p else None
    if not full or not full.exists():
        hdr_of[name] = "binary/TL-generated"
        hdr_hist["binary/TL-generated"] += 1
        continue
    text = full.read_bytes()[:8192].decode("latin-1", "replace")
    cls = next((tag for tag, rx in HDR if rx.search(text)), "no-header")
    hdr_of[name] = cls
    hdr_hist[cls] += 1

# ---------- 5. emit ----------
total = 0
for pkg in sorted(families):
    files = sorted(families[pkg])
    lic = pkg_license.get(pkg) or "?"
    ctan = pkg_ctan.get(pkg, "?")
    total += len(files)
    print(f"{pkg}\t{lic}\t{ctan}\t{len(files)}")
    for fn in files:
        print(f"  {fn}\t[{hdr_of[fn]}]")
for name, p, why in unmapped:
    print(f"SPECIAL\t{name}\t{p}\t{why}\t[{hdr_of[name]}]")
print(f"# families={len(families)} files={total} specials={len(unmapped)}", file=sys.stderr)
for tag, n in sorted(hdr_hist.items(), key=lambda kv: -kv[1]):
    print(f"# header {tag}: {n}", file=sys.stderr)
