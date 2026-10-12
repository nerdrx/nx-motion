# NX Motion

NX Motion turns ordinary video into smoother, higher-frame-rate video. It is a
Windows-first desktop app with the NX Clear interface and FFmpeg processing
that runs locally.

## What it does

- Interpolates video from 30 fps to 60 fps, or to a chosen target from 24–240 fps.
- Offers balanced, high-quality, and fast processing modes.
- Keeps the source resolution or scales output to 1080p or 720p.
- Preserves audio, shows progress, supports cancellation, and processes batches.
- Creates short previews so you can check motion before a full export.
- Bundles FFmpeg and FFprobe; no separate install is needed.

Frame interpolation estimates new in-between frames. Fast movement, cuts, and
occlusion can produce visual artifacts; preview difficult footage first.

## Windows

Download either the single portable `.exe` or the portable `.zip` from
[GitHub Releases](https://github.com/nerdrx/nx-motion/releases). The zip keeps
the app folder together when you prefer a directory install. NX Hub discovers
the same Windows assets from the `nerdrx` account.

## Development

Requires Node.js 22.12 or newer.

```sh
npm ci
npm start
npm test
npm run dist:win
```

Build output goes to `dist/`.

## License

NX Motion source is MIT licensed. The bundled FFmpeg binary has separate
licensing terms and source information in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
