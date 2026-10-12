#!/usr/bin/env python3
"""Fetch the pinned RIFE runtime and copy only NX Motion's required files."""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
MODEL = "rife-v4.6"
ARCHIVES = {
    "windows": {
        "url": "https://github.com/nihui/rife-ncnn-vulkan/releases/download/20221029/rife-ncnn-vulkan-20221029-windows.zip",
        "sha256": "d8e4d772d26cd8006ef0ad0bc82eb191b53c68677d1ae2f42506d74cbbbea606",
        "prefix": "rife-ncnn-vulkan-20221029-windows/",
        "files": (
            "rife-ncnn-vulkan.exe",
            "vcomp140.dll",
            "LICENSE",
            "README.md",
            f"{MODEL}/flownet.bin",
            f"{MODEL}/flownet.param",
        ),
        "binary": "rife-ncnn-vulkan.exe",
    },
    "linux": {
        "url": "https://github.com/nihui/rife-ncnn-vulkan/releases/download/20221029/rife-ncnn-vulkan-20221029-ubuntu.zip",
        "sha256": "1e2c7ee7fa7daa326542d50622f0afedc80cf6f1858bda411d16385ffa5cdf68",
        "prefix": "rife-ncnn-vulkan-20221029-ubuntu/",
        "files": (
            "rife-ncnn-vulkan",
            "LICENSE",
            "README.md",
            f"{MODEL}/flownet.bin",
            f"{MODEL}/flownet.param",
        ),
        "binary": "rife-ncnn-vulkan",
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def cached_archive(platform: str) -> Path:
    spec = ARCHIVES[platform]
    cache = Path(tempfile.gettempdir()) / "nx-motion-rife"
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / f"{platform}.zip"
    if archive.is_file() and sha256(archive) == spec["sha256"]:
        return archive
    archive.unlink(missing_ok=True)

    partial = archive.with_suffix(".zip.part")
    partial.unlink(missing_ok=True)
    request = urllib.request.Request(spec["url"], headers={"User-Agent": "NX-Motion-build"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response, partial.open("wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
        actual = sha256(partial)
        if actual != spec["sha256"]:
            raise RuntimeError(f"RIFE {platform} SHA-256 mismatch: {actual}")
        partial.replace(archive)
    finally:
        partial.unlink(missing_ok=True)
    return archive


def extract(platform: str, archive: Path, destination: Path) -> None:
    spec = ARCHIVES[platform]
    required = set(spec["files"])
    selected: dict[str, zipfile.ZipInfo] = {}
    with zipfile.ZipFile(archive) as package:
        for entry in package.infolist():
            name = entry.filename.replace("\\", "/")
            pure = PurePosixPath(name)
            if pure.is_absolute() or ".." in pure.parts:
                continue
            if name.startswith(spec["prefix"]):
                relative = name[len(spec["prefix"]):]
                if relative in required and not entry.is_dir():
                    selected[relative] = entry
        missing = required - selected.keys()
        if missing:
            raise RuntimeError(f"RIFE archive is missing: {', '.join(sorted(missing))}")

        if destination.exists():
            shutil.rmtree(destination)
        destination.mkdir(parents=True, exist_ok=True)
        for relative, entry in selected.items():
            target = destination.joinpath(*PurePosixPath(relative).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with package.open(entry) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)

    binary = destination / spec["binary"]
    if platform == "linux":
        binary.chmod(binary.stat().st_mode | 0o111)
    print(f"Prepared RIFE {platform}: {destination}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=ARCHIVES, default="windows" if sys.platform == "win32" else "linux")
    parser.add_argument("--destination", type=Path, default=ROOT / "vendor" / "rife")
    args = parser.parse_args()
    platform = args.platform
    if platform == "windows" and sys.platform != "win32" and args.destination == ROOT / "vendor" / "rife":
        parser.error("Windows assets can only be prepared on Windows unless --destination is specified")
    archive = cached_archive(platform)
    extract(platform, archive, args.destination.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
