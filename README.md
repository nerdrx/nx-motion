# NX Motion

NX Motion is a graphical **FFmpeg wrapper for Windows and Linux**, styled with NX Clear.
It exposes video conversion and frame interpolation controls without writing commands.
GPU frame interpolation uses bundled RIFE via Vulkan; FFmpeg handles decoding,
CPU interpolation, and output encoding.

## What it does

- Interpolates video from 30 fps to 60 fps, or to a chosen target from 24–240 fps.
- Offers balanced, high-quality, and fast processing modes.
- Keeps the source resolution or scales output to 1080p or 720p.
- Preserves audio, shows progress, supports cancellation, and processes batches.
- Creates short previews so you can check motion before a full export.
- Bundles FFmpeg and FFprobe; no separate install is needed.
- GPU interpolation through bundled RIFE 4.6 and Vulkan (Windows/Linux x64).
- H.264/HEVC encoding with NVIDIA NVENC, AMD AMF, or Intel Quick Sync when an encoder initializes on your computer.
- MP4/MKV output, trimming, quality and bitrate controls, denoise and deinterlace.

Choose **GPU · RIFE Vulkan** under Interpolation to generate frames on the GPU.
The Video encoder setting controls the separate compression step. GPU drivers
must support Vulkan; encoder availability also depends on hardware and drivers.
GPU interpolation stages PNG frames on the output drive before encoding them.
Long or 4K clips can require substantial temporary disk space; use a preview,
trim, or lower resolution first. Temporary frames are removed after completion
or cancellation. GPU speed and compatibility have not been benchmarked for this release.

Progress shows the current stage and elapsed time. If a conversion stalls,
**Copy diagnostics** copies the current session log (including local file paths)
for troubleshooting. The app does not upload it.

Frame interpolation estimates new in-between frames. Fast movement, cuts, and
occlusion can produce visual artifacts; preview difficult footage first.

## Windows

Download either the single portable `.exe` or the portable `.zip` from
[GitHub Releases](https://github.com/nerdrx/nx-motion/releases). The zip keeps
the app folder together when you prefer a directory install. NX Hub discovers
the same Windows assets from the `nerdrx` account.

## Linux

Download the x86_64 AppImage or Debian package from [Releases](https://github.com/nerdrx/nx-motion/releases/latest). NX Hub installs and launches the AppImage. For a manual AppImage install, mark it executable and run it; Ubuntu may need the `libfuse2` package. If FUSE is unavailable, use `./NX-Motion-0.2.2-linux-x86_64.AppImage --appimage-extract-and-run`. The `.deb` provides a native application-menu entry on Debian/Ubuntu. Vulkan-capable graphics drivers are required for RIFE. ARM builds are not included.

## Development

Requires Node.js 22.12 or newer.

```sh
npm ci
python scripts/prepare-rife.py
npm start
npm test
npm run dist:win
# On Linux:
npm run dist:linux
```

Build output goes to `dist/`.

## License

NX Motion source is MIT licensed. The bundled FFmpeg binary has separate
licensing terms and source information in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
