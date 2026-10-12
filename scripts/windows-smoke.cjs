'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { convert, probe } = require('../src/engine.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const unpacked = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar.unpacked');
  const ffmpegRelative = path.relative(root, require('ffmpeg-static'));
  const ffprobeRelative = path.relative(root, require('ffprobe-static').path);
  const ffmpegPath = path.join(unpacked, ffmpegRelative);
  const ffprobePath = path.join(unpacked, ffprobeRelative);
  await Promise.all([fs.access(ffmpegPath), fs.access(ffprobePath)]);

  const run = (exe, args) => {
    const result = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw result.error || new Error(`${exe} failed: ${result.stderr}`);
    return result.stdout;
  };
  assert.match(run(ffmpegPath, ['-version']), /ffmpeg version/i);
  assert.match(run(ffprobePath, ['-version']), /ffprobe version/i);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nx-motion-packaged-'));
  const input = path.join(dir, 'input.mp4');
  const output = path.join(dir, 'output.mp4');
  try {
    run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input]);
    await convert({ input, output, ffmpegPath, ffprobePath, options: { fps: 60, quality: 'balanced' } }).promise;
    const result = await probe(output, ffprobePath);
    assert.match(result.frameRate, /^60\/1$/);
    console.log('Windows packaged FFmpeg interpolation: ok');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
