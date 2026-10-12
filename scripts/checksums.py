#!/usr/bin/env python3
"""Write Hub-compatible SHA-256 sidecars for release assets in dist/."""

import argparse
import hashlib
from pathlib import Path

ASSET_SUFFIXES = {".exe", ".zip", ".appimage", ".deb"}


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=Path("dist"))
    directory = parser.parse_args().directory
    assets = sorted(
        (path for path in directory.iterdir() if path.is_file() and path.suffix.lower() in ASSET_SUFFIXES),
        key=lambda path: path.name.lower(),
    )
    if not assets:
        parser.error(f"no release assets found in {directory}")
    for asset in assets:
        sidecar = asset.with_name(asset.name + ".sha256")
        sidecar.write_text(f"{digest(asset)}  {asset.name}\n", encoding="ascii")
        print(sidecar)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
