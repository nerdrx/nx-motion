# Third-party notices

NX Motion bundles FFmpeg 6.1.1 from `ffmpeg-static` 5.3.0 for Windows x64.
The package identifies the binary provider as the Gyan Windows builds. The
binary's license notice is included beside it as `ffmpeg.LICENSE` in the
application resources.

The FFmpeg binary is licensed under GPL-3.0-or-later. The corresponding FFmpeg
source is available from the [FFmpeg 6.1.1 source tag](https://github.com/FFmpeg/FFmpeg/tree/n6.1.1).
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
