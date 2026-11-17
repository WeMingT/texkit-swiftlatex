#!/usr/bin/env python3
"""Keep map records whose TFM file is a flat closure member."""
import argparse
from pathlib import Path


def trim_font_map(data, members):
    kept = []
    for line in data.split(b"\n"):
        line = line.removesuffix(b"\r")
        content = line.lstrip(b" \t\n\v\f\r")
        if not content or content[:1] in (b"%", b"#", b";", b"*"):
            continue
        token = content.split(None, 1)[0]
        if token + b".tfm" in members:
            kept.append(line + b"\n")
    return b"".join(kept)


def self_test():
    cases = [
        ("crlf", b"cmr10 PS <font.pfb\r\nmissing PS\r\n", {b"cmr10.tfm"}, b"cmr10 PS <font.pfb\n"),
        ("leading-ascii-whitespace", b" \t\v\f\rcmr10 PS\r\n", {b"cmr10.tfm"}, b" \t\v\f\rcmr10 PS\n"),
        ("comments", b" %a\n\t#b\n;c\n*d\ncmr10 PS\n", {b"cmr10.tfm"}, b"cmr10 PS\n"),
        ("empty-lines", b"\n \t\r\n\r\n", {b"cmr10.tfm"}, b""),
        ("unterminated-line", b"cmr10 PS", {b"cmr10.tfm"}, b"cmr10 PS\n"),
        ("membership", b"missing PS\ncmr10 PS\n", {b"cmr10.tfm"}, b"cmr10 PS\n"),
        ("prefixed-member", b"cmr10 PS\n", {b"fonts/cmr10.tfm"}, b""),
        ("prefixed-token", b"fonts/cmr10 PS\n", {b"cmr10.tfm"}, b""),
        ("single-trailing-cr", b"cmr10 PS\r\r\n", {b"cmr10.tfm"}, b"cmr10 PS\r\n"),
    ]
    for name, data, members, expected in cases:
        actual = trim_font_map(data, members)
        assert actual == expected, f"{name}: {actual!r} != {expected!r}"
        print(f"PASS {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--map", type=Path)
    parser.add_argument("--staging", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if any(value is None for value in (args.map, args.staging, args.out)):
        parser.error("--map, --staging and --out are required")
    members = {p.relative_to(args.staging).as_posix().encode("utf-8")
               for p in args.staging.rglob("*") if p.is_file()}
    result = trim_font_map(args.map.read_bytes(), members)
    args.out.write_bytes(result)
    print(f"trim ok: {len(result)} bytes, {result.count(bytes([10]))} records")


if __name__ == "__main__":
    main()
