#!/usr/bin/env python3
"""Reject machine identity and non-neutral tar metadata in build artifacts."""
from pathlib import Path
import argparse
import base64
import binascii
import re
import gzip
import io
import lzma
import os
import socket
import sys
import tarfile


def identity_needles(extra):
    needles = os.environ.get("TEXKIT_HOST_NEEDLES", "").split(":")
    needles.extend((socket.gethostname(), str(Path(__file__).resolve().parents[1])))
    needles.extend(extra)
    result = [(needle, False) for needle in sorted(set(needles)) if needle]
    home = str(Path.home())
    if home != "/":
        result.append((home, True))
    return result


def js_string(text, start):
    """Parse a literal without evaluating JavaScript or accepting expressions."""
    if start >= len(text) or text[start] not in "\"'":
        raise ValueError("inline wasm requires a JavaScript string literal")
    quote = text[start]
    output = []
    i = start + 1
    escapes = {"n": "\n", "r": "\r", "t": "\t", "b": "\b",
               "f": "\f", "v": "\v", "0": "\0", "\\": "\\",
               "'": "'", '"': '"', "/": "/"}
    while i < len(text):
        char = text[i]
        i += 1
        if char == quote:
            return "".join(output), i
        if char != "\\":
            if char in "\r\n":
                raise ValueError("unescaped newline in inline wasm string")
            output.append(char)
            continue
        if i >= len(text):
            break
        char = text[i]
        i += 1
        if char in "\r\n":
            if char == "\r" and i < len(text) and text[i] == "\n":
                i += 1
            continue
        if char in escapes:
            if char == "0" and i < len(text) and text[i].isdigit():
                raise ValueError("octal escape in inline wasm string")
            output.append(escapes[char])
        elif char in "xu":
            length = 2 if char == "x" else 4
            if char == "u" and i < len(text) and text[i] == "{":
                end = text.find("}", i + 1)
                digits = text[i + 1:end] if end >= 0 else ""
                if not re.fullmatch(r"[0-9a-fA-F]{1,6}", digits):
                    raise ValueError("invalid Unicode escape in inline wasm string")
                value = int(digits, 16)
                if value > 0x10ffff:
                    raise ValueError("Unicode escape outside scalar range")
                output.append(chr(value))
                i = end + 1
            else:
                digits = text[i:i + length]
                if len(digits) != length or not re.fullmatch(r"[0-9a-fA-F]+", digits):
                    raise ValueError("invalid hexadecimal escape in inline wasm string")
                output.append(chr(int(digits, 16)))
                i += length
        else:
            raise ValueError("unsupported escape in inline wasm string")
    raise ValueError("truncated inline wasm string")


def embedded_wasm(raw):
    text = raw.decode("utf-8")
    payloads = []
    for match in re.finditer(r"\bbinaryDecode\s*\(", text):
        if re.search(r"\bfunction\s*$", text[:match.start()]):
            continue
        start = match.end()
        while start < len(text) and text[start].isspace():
            start += 1
        literal, end = js_string(text, start)
        if not text[end:].lstrip().startswith(")"):
            raise ValueError("inline wasm argument is not a single literal")
        # Match Emscripten's charCodeAt / Uint8Array binaryDecode operation,
        # including its encoded high-byte characters, on UTF-16 code units.
        units = literal.encode("utf-16-le", errors="surrogatepass")
        codes = (int.from_bytes(units[i:i + 2], "little") for i in range(0, len(units), 2))
        payloads.append(bytes(((~code >> 8) & code) & 255 for code in codes))
    for match in re.finditer(r"[\"']data:application/(?:octet-stream|wasm);base64,", text):
        literal, _ = js_string(text, match.start())
        encoded = literal.split(",", 1)[1]
        if not encoded:
            continue  # A runtime data-URI prefix is not a payload.
        try:
            payloads.append(base64.b64decode(encoded, validate=True))
        except binascii.Error as error:
            raise ValueError("invalid base64 inline wasm") from error
    if not payloads:
        raise ValueError("cannot identify supported inline wasm payload")
    for payload in payloads:
        if not payload.startswith(b"\0asm\x01\0\0\0"):
            raise ValueError("inline payload does not have a complete wasm header")
    return payloads


def scan(path, needles):
    failures = []

    def bytes_at(data, location):
        for needle, container_home in needles:
            encoded = needle.encode()
            offset = data.find(encoded)
            while offset >= 0:
                following = offset + len(encoded)
                # A longer ASCII word is not the automatic container home path.
                if (container_home and following < len(data)
                        and data[following] in b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_"):
                    offset = data.find(encoded, offset + 1)
                    continue
                begin = data.rfind(b"\0", 0, offset)
                end = data.find(b"\0", offset)
                # ICU uses this exact relative resource name. Only an automatic
                # container-home match inside its NUL-delimited field is neutral;
                # explicit and host-derived needles remain strict.
                if (container_home and begin >= 0 and end >= 0
                        and data[begin + 1:end] == b"icudt76l/brkitr/root.res"):
                    offset = data.find(encoded, offset + 1)
                    continue
                failures.append(f"{path}: {location} byte {offset}: needle {needle!r}")
                break

    raw = path.read_bytes()
    bytes_at(raw, "raw")
    if path.suffix == ".js":
        for index, wasm in enumerate(embedded_wasm(raw)):
            bytes_at(wasm, f"decoded wasm {index}")
    data = raw
    if path.name.endswith(".gz"):
        data = gzip.decompress(raw)
        bytes_at(data, "gzip")
    try:
        archive = tarfile.open(fileobj=io.BytesIO(data), mode="r:")
    except tarfile.ReadError:
        archive = None
    if archive is not None:
        with archive:
            for member in archive:
                location = f"tar member {member.name!r}"
                for field, expected in (("uid", 0), ("gid", 0), ("uname", ""),
                                        ("gname", ""), ("mtime", 0)):
                    actual = getattr(member, field)
                    if actual != expected:
                        failures.append(f"{path}: {location}: {field}={actual!r}, expected {expected!r}")
                if member.isfile():
                    if member.mode != 0o644:
                        failures.append(f"{path}: {location}: mode={member.mode:o}, expected 644")
                    with archive.extractfile(member) as content:
                        payload = content.read()
                    bytes_at(payload, location)
                    if member.name.endswith(".tar.xz"):
                        # Official source containers retain their original tar
                        # metadata; inspect their decoded content for identity.
                        decoded = lzma.decompress(payload)
                        bytes_at(decoded, location + " decoded xz")
    return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--needle", action="append", default=[])
    parser.add_argument("files", nargs="+", type=Path)
    args = parser.parse_args()
    needles = identity_needles(args.needle)
    failures = []
    for path in args.files:
        try:
            failures.extend(scan(path, needles))
        except (OSError, EOFError, ValueError, tarfile.TarError, lzma.LZMAError) as error:
            failures.append(f"{path}: cannot scan artifact: {error}")
    for failure in failures:
        print(failure)
    print(f"artifact scan: {len(args.files)} files, {len(failures)} findings")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
