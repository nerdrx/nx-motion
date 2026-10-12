# Third-party notices

## RIFE GPU interpolation

Windows builds include the executable, runtime DLL, and `rife-v4.6` model from
[nihui/rife-ncnn-vulkan release 20221029](https://github.com/nihui/rife-ncnn-vulkan/releases/tag/20221029).
The upstream MIT license and README are included in `resources/rife`.
The exact archive SHA-256 is pinned in `scripts/prepare-rife.ps1`.
RIFE uses [ncnn](https://github.com/Tencent/ncnn); upstream implementation and
model information are linked in the bundled README. No upstream files are modified.

## FFmpeg

NX Motion bundles the Windows x64 FFmpeg binary supplied by `ffmpeg-static`
5.3.0. That package's upstream README advertises FFmpeg 6.1.1 and identifies
Gyan's Windows builds as the binary provider; the downloaded binary's own
`ffmpeg.README` in the application resources records its exact build and
libraries. The binary's license notice is included beside it as
`ffmpeg.LICENSE` in the application resources.

The FFmpeg binary is licensed under GPL-3.0-or-later. The matching FFmpeg
source revision is linked from its bundled `ffmpeg.README`; the upstream
versioned sources are available from [FFmpeg](https://github.com/FFmpeg/FFmpeg).
The binary package and build details are available from the
[`ffmpeg-static` b6.1.1 release](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1)
and the [Gyan Windows builds project](https://www.gyan.dev/ffmpeg/builds/).
That upstream release's README identifies the provider and points to the
matching source revision. FFmpeg build configuration and enabled external
libraries are reported by the bundled executable with `ffmpeg -buildconf`.

The `ffmpeg-static` JavaScript package is also GPL-3.0-or-later; its source is
at <https://github.com/eugeneware/ffmpeg-static>. `ffprobe-static` 3.1.0 is MIT
licensed; its notice is included in its package resources.

NX Motion does not modify these upstream components. Their licenses apply to
those components and do not replace the MIT license for NX Motion's own source.
