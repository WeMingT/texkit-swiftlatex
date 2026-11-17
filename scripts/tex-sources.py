#!/usr/bin/env python3
"""Fetch, stage and verify the complete frozen TeX source distribution."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "closure/tex-source-policy.json"
ARCHIVE_URL = "https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2025/tlnet-final/archive/"
MANIFEST = "tex-sources-manifest.json"


def verify_blob(data, record):
    if len(data) != record["bytes"]:
        raise ValueError("source byte count differs: " + record.get("path", "blob"))
    for algorithm in ("sha256", "sha512"):
        if algorithm in record and hashlib.new(algorithm, data).hexdigest() != record[algorithm]:
            raise ValueError("source checksum differs: " + record.get("path", "blob"))


def declared_sources(data):
    head = data.decode("latin-1")[:20000]
    marker = "The original source files were:"
    if "docstrip" not in head.lower() and marker not in head:
        return []
    lines = []
    if marker in head:
        for line in head.split(marker, 1)[1].splitlines():
            if re.match(r"^%%\s+[\w.-]+\.(?:dtx|ins|fdd)\b", line):
                lines.append(line)
            elif lines:
                break
    sources = sorted(set(re.findall(r"\b[\w.-]+\.(?:dtx|ins|fdd)\b", "\n".join(lines))))
    if not sources:
        raise ValueError("generated format input has no source declarations")
    return sources


def configuration():
    policy = json.loads(POLICY.read_text())
    tl = Path(os.environ["TEXLIVE_ROOT"])
    raw = (tl / "tlpkg/texlive.tlpdb").read_bytes()
    if hashlib.sha256(raw).hexdigest() != policy["tlpdbSha256"]:
        raise ValueError("frozen package database identity differs")
    db = {}
    for block in raw.decode().split("\n\n"):
        if not block.startswith("name "):
            continue
        fields = dict(line.split(" ", 1) for line in block.splitlines()
                      if line and not line.startswith(" ") and " " in line)
        db[fields["name"]] = fields
    return policy, tl, db


def archive_records(policy, db):
    result = []
    for package in policy["packages"]:
        fields = db[package["name"]]
        for kind, suffix, prefix in (("runtime", "", ""), ("source", ".source", "src"),
                                     ("documentation", ".doc", "doc")):
            if not package[kind]:
                continue
            filename = package["name"] + suffix + ".tar.xz"
            result.append({"path": "archives/" + filename, "package": package["name"],
                           "kind": kind, "revision": int(fields["revision"]),
                           "bytes": int(fields[prefix + "containersize"]),
                           "sha512": fields[prefix + "containerchecksum"]})
    return sorted(result, key=lambda r: r["path"])


def fetch():
    policy, _, db = configuration()
    destination = ROOT / "src/tex-sources"
    destination.mkdir(parents=True, exist_ok=True)
    for record in archive_records(policy, db):
        name = PurePosixPath(record["path"]).name
        target = destination / name
        if target.exists():
            verify_blob(target.read_bytes(), record)
            print("Verified existing archive: " + name, flush=True)
            continue
        print("Fetching archive: " + name, flush=True)
        request = urllib.request.Request(ARCHIVE_URL + name, headers={"User-Agent": "TeX-source-distribution/1"})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read()
        verify_blob(data, record)
        with target.open("xb") as output:
            output.write(data)
    print("All frozen TeX archives verified", flush=True)


def format_records(policy, tl, meta):
    names = meta["filesServedList"]
    if names != [record["name"] for record in policy["formatInputs"]] or len(names) != 354:
        raise ValueError("format input set differs from the frozen source inventory")
    result = []
    for source in policy["formatInputs"]:
        resolved = subprocess.check_output(
            [str(tl / "bin/x86_64-linux/kpsewhich"), "-progname=pdflatex", source["name"]], text=True).strip()
        if Path(resolved).relative_to(tl).as_posix() != source["path"]:
            raise ValueError("format input resolution differs: " + source["name"])
        data = (tl / source["path"]).read_bytes()
        verify_blob(data, source)
        result.append((dict(source, kind="format-input"), data))
    return result


def stage():
    policy, tl, db = configuration()
    meta = json.loads((ROOT / "build/engine-v2/swiftlatexpdftex.fmt.meta.json").read_text())
    destination = ROOT / "build/tex-source-staging"
    destination.mkdir(parents=True, exist_ok=False)
    entries = format_records(policy, tl, meta)
    for record in archive_records(policy, db):
        data = (ROOT / "src/tex-sources" / PurePosixPath(record["path"]).name).read_bytes()
        verify_blob(data, record)
        entries.append((dict(record, sha256=hashlib.sha256(data).hexdigest()), data))
    entries.sort(key=lambda item: item[0]["path"])
    for record, data in entries:
        target = destination / record["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    manifest = {"schema": 1, "tlpdbSha256": policy["tlpdbSha256"], "files": [r for r, _ in entries]}
    (destination / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Staged {len(entries)} frozen source files")


def source_members(data):
    result = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:xz") as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("unsafe official archive member")
            if member.isfile():
                if member.name in result:
                    raise ValueError("duplicate official archive member")
                result[member.name] = hashlib.sha256(archive.extractfile(member).read()).hexdigest()
    return result


def check(archive_path):
    policy, tl, db = configuration()
    meta = json.loads((ROOT / "build/engine-v2/swiftlatexpdftex.fmt.meta.json").read_text())
    payloads = {}
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or member.issym() or member.islnk():
                raise ValueError("unsafe source distribution member")
            if member.isfile():
                key = path.as_posix()
                if key in payloads:
                    raise ValueError("duplicate source distribution member")
                payloads[key] = archive.extractfile(member).read()
    manifest = json.loads(payloads.pop(MANIFEST))
    if manifest["schema"] != 1 or manifest["tlpdbSha256"] != policy["tlpdbSha256"]:
        raise ValueError("source distribution database identity differs")
    records = {r["path"]: r for r in manifest["files"]}
    if len(records) != len(manifest["files"]) or set(records) != set(payloads):
        raise ValueError("source manifest membership differs")
    for path, data in payloads.items():
        verify_blob(data, records[path])
    expected_inputs = format_records(policy, tl, meta)
    for record, data in expected_inputs:
        if payloads[record["path"]] != data or records[record["path"]] != record:
            raise ValueError("format source coverage differs: " + record["name"])
    sources = {}
    archives = archive_records(policy, db)
    for record in archives:
        data = payloads[record["path"]]
        verify_blob(data, record)
        if records[record["path"]] != dict(record, sha256=hashlib.sha256(data).hexdigest()):
            raise ValueError("archive source inventory differs")
        if record["kind"] == "source":
            sources[record["package"]] = (record["path"], source_members(data))
    if set(payloads) != {r["path"] for r, _ in expected_inputs} | {r["path"] for r in archives}:
        raise ValueError("undeclared source payload")
    generated, references, unique = 0, 0, set()
    for record, data in expected_inputs:
        declared = declared_sources(data)
        if not declared:
            continue
        generated += 1
        archive, members = sources[record["package"]]
        for name in declared:
            references += 1
            matches = [(path, digest) for path, digest in members.items() if PurePosixPath(path).name == name]
            if len(matches) != 1:
                raise ValueError("documented source member missing or ambiguous: " + name)
            unique.add((archive, *matches[0]))
    if (generated, references, len(unique)) != (44, 156, 128):
        raise ValueError(f"documented source coverage differs: {generated}/{references}/{len(unique)}")
    result = {"formatInputs": len(expected_inputs), "archives": len(archives),
              "docstripInputs": generated, "sourceReferences": references, "distinctSourceMembers": len(unique),
              "checked": True}
    print(json.dumps(result))


def identity(archive_path, expected):
    data = archive_path.read_bytes()
    record = {"name": "tex-sources.tar.gz", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    if expected is not None:
        if json.loads(expected.read_text()) != record:
            raise ValueError("source distribution differs from its release identity")
    else:
        (archive_path.parent / "tex-sources.identity.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["fetch", "stage", "check", "identity"])
    parser.add_argument("archive", nargs="?", type=Path, default=ROOT / "build/engine-v2/tex-sources.tar.gz")
    parser.add_argument("--expect", type=Path)
    args = parser.parse_args()
    if args.command == "fetch":
        fetch()
    elif args.command == "stage":
        stage()
    elif args.command == "check":
        check(args.archive)
    else:
        identity(args.archive, args.expect)


if __name__ == "__main__":
    main()
