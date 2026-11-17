#!/usr/bin/env python3
"""Check the text font redirect against the pinned kernel and font declarations."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FAMILIES = ("cmr", "cmss", "cmtt")


def declarations(path, unique=False):
    text = re.sub(r"%[^\n]*", "", path.read_text())
    out = {}
    for match in re.finditer(r"\\(DeclareFontShape|EC@(?:ss|tt)?family)\b", text):
        pos = match.end()
        if not text[pos:].lstrip().startswith("{"):
            continue
        args = []
        for _ in range(6 if match[1] == "DeclareFontShape" else 5):
            while pos < len(text) and text[pos].isspace():
                pos += 1
            if pos == len(text) or text[pos] != "{":
                raise ValueError(f"malformed declaration in {path.name}")
            start = pos = pos + 1
            depth = 1
            while depth and pos < len(text):
                depth += (text[pos] == "{") - (text[pos] == "}")
                pos += 1
            if depth:
                raise ValueError(f"unclosed declaration in {path.name}")
            args.append(text[start:pos - 1].strip())
        if "#" not in "".join(args[:4]):
            key = tuple(args[:4])
            # Latin Modern repeats keys in conditional light/normal branches.
            # Coverage asks whether a key is declared, not which branch runs.
            if unique and key in out:
                raise ValueError(f"duplicate declaration: {key}")
            out[key] = args[4]
    return out


def main():
    redirects = declarations(ROOT / "closure/fmt-font-redirect.tex", unique=True)
    tlroot = Path(os.environ["TEXLIVE_ROOT"]).resolve()
    kpse = tlroot / "bin/x86_64-linux/kpsewhich"

    def resolve(name):
        value = subprocess.check_output([str(kpse), name], text=True).strip()
        if not value:
            raise ValueError(f"missing frozen font declaration: {name}")
        file = Path(value).resolve()
        if not file.is_relative_to(tlroot):
            raise ValueError(f"font declaration outside pinned tree: {name}")
        return file

    kernel = {}
    for enc in ("T1", "TS1"):
        for family in FAMILIES:
            kernel.update(declarations(resolve(enc.lower() + family + ".fd")))
    if len(kernel) != 44 or redirects.keys() != kernel.keys():
        raise ValueError(f"redirect coverage differs: missing={sorted(kernel.keys() - redirects.keys())}, "
                         f"extra={sorted(redirects.keys() - kernel.keys())}")
    closure = set((ROOT / "closure/closure-list.txt").read_text().splitlines())
    targets = {}
    for (enc, family, series, shape), spec in redirects.items():
        target = re.fullmatch(r"<->\s*s?sub\s*\*\s*(lm\w+)/([^/\s]+)/([^/\s]+)\s*", spec)
        if target is None:
            raise ValueError(f"invalid redirect target: {spec}")
        lm, lmseries, lmshape = target.groups()
        name = enc.lower() + lm + ".fd"
        if name not in closure:
            raise ValueError(f"redirect target FD outside closure: {name}")
        if name not in targets:
            targets[name] = declarations(resolve(name))
        if (enc, lm, lmseries, lmshape) not in targets[name]:
            raise ValueError(f"undeclared Latin Modern target: {enc}/{lm}/{lmseries}/{lmshape}")
    print(json.dumps({"declarations": len(redirects), "targetFDs": sorted(targets), "checked": True}))


if __name__ == "__main__":
    try:
        main()
    except (OSError, KeyError, ValueError, subprocess.CalledProcessError) as error:
        print("font-redirect: " + str(error), file=sys.stderr)
        sys.exit(1)
