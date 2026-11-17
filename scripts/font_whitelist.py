"""Shared parsing and file selection for the font whitelist."""
from pathlib import Path, PurePosixPath


def read_entries(path) -> list[tuple[str, tuple[str, ...] | None]]:
    entries = []
    for number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        text = line.split("#", 1)[0].strip()
        if not text:
            continue
        parts = text.split("::")
        if len(parts) > 2:
            raise ValueError(f"invalid whitelist entry at line {number}")
        directory = parts[0].strip()
        relative = PurePosixPath(directory)
        if not directory or relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"invalid whitelist directory at line {number}")
        patterns = tuple(parts[1].split()) if len(parts) == 2 else None
        if patterns is not None and (not patterns or any(
                "/" in pattern or "\\" in pattern for pattern in patterns)):
            raise ValueError(f"invalid filename filter at line {number}")
        entries.append((directory, patterns))
    if not entries:
        raise ValueError("font whitelist is empty")
    return entries


def selected_files(root, entry):
    """Select flat files, requiring every explicit pattern to match."""
    relative, patterns = entry
    directory = Path(root) / relative
    if not directory.is_dir():
        raise ValueError(f"font whitelist directory missing: {directory}")
    paths = set()
    for pattern in patterns if patterns is not None else ("*.pfb", "*.tfm", "*.vf"):
        matches = {path for path in directory.glob(pattern) if path.is_file()}
        if patterns is not None and not matches:
            raise ValueError(f"font whitelist filter matched no files: {relative} :: {pattern}")
        paths.update(matches)
    return sorted(paths)
