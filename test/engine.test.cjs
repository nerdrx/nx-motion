'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { convert, probe, buildArgs } = require('../src/engine.cjs');

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
function run(exe, args) {
  const result = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`${exe} failed: ${result.stderr}`);
  return result.stdout;
}

(async () => {
  assert.match(buildArgs('in.mp4', 'out.mp4', { fps: 60, quality: 'balanced' }).join(' '), /minterpolate/);
  assert.match(buildArgs('in.mp4', 'out.mp4', { fps: 60, quality: 'fast' }).join(' '), /tblend/);
  assert.match(buildArgs('in.mp4', 'out.mp4', { fps: 60, duration: 0.5 }).join(' '), /tpad/);
  assert.throws(() => buildArgs('a', 'b', { fps: 241 }), /fps/);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nx-motion-'));
  const input = path.join(dir, 'input.mp4');
  const output = path.join(dir, 'output.mp4');
  const cancelOutput = path.join(dir, 'cancel.mp4');
  try {
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', input]);
    const source = await probe(input, ffprobe);
    assert.equal(source.hasAudio, true);
    assert.ok(Math.abs(source.duration - 1) < 0.08);

    const updates = [];
    await convert({ input, output, ffmpegPath: ffmpeg, ffprobePath: ffprobe, options: { fps: 60, quality: 'balanced' }, onProgress: p => updates.push(p) }).promise;
    const result = await probe(output, ffprobe);
    assert.equal(result.hasAudio, true);
    assert.ok(Math.abs(result.duration - source.duration) < 0.08, `${result.duration} vs ${source.duration}`);
    assert.match(result.frameRate, /^60\/1$/);
    const frames = Number(run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', output]).trim());
    assert.ok(frames >= 56 && frames <= 60, `frame count ${frames}`);
    const hashes = run(ffmpeg, ['-v', 'error', '-i', output, '-map', '0:v:0', '-f', 'framemd5', '-']).split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim());
    assert.ok(new Set(hashes).size > 30, 'output should contain generated intermediate motion frames');
    assert.ok(updates.length > 0 && updates.at(-1) === 1);

    const shortInput = path.join(dir, 'short.mkv');
    const shortOutput = path.join(dir, 'short.mp4');
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=161x91:rate=30:duration=0.067', '-frames:v', '2', '-c:v', 'ffv1', '-pix_fmt', 'yuv444p', shortInput]);
    const shortSource = await probe(shortInput, ffprobe);
    assert.equal(shortSource.hasAudio, false);
    await convert({ input: shortInput, output: shortOutput, ffmpegPath: ffmpeg, ffprobePath: ffprobe, options: { fps: 60 } }).promise;
    const shortResult = await probe(shortOutput, ffprobe);
    assert.equal(shortResult.hasAudio, false);
    assert.equal(shortResult.width % 2, 0);
    assert.equal(shortResult.height % 2, 0);
    assert.ok(Math.abs(shortResult.duration - shortSource.duration) < 0.03, `${shortResult.duration} vs ${shortSource.duration}`);

    const oneFrameInput = path.join(dir, 'one-frame.mkv');
    const oneFrameOutput = path.join(dir, 'one-frame.mp4');
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=80x80:rate=1:duration=1', '-frames:v', '1', '-c:v', 'ffv1', '-pix_fmt', 'yuv444p', oneFrameInput]);
    await convert({ input: oneFrameInput, output: oneFrameOutput, ffmpegPath: ffmpeg, ffprobePath: ffprobe, options: { fps: 2, quality: 'fast' } }).promise;
    const oneFrameCount = Number(run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', oneFrameOutput]).trim());
    assert.ok(oneFrameCount >= 1, `one-frame input produced ${oneFrameCount} output frames`);

    const pcmInput = path.join(dir, 'pcm.mkv');
    const pcmOutput = path.join(dir, 'pcm.mp4');
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=0.5', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=0.5', '-c:v', 'ffv1', '-c:a', 'pcm_s16le', '-shortest', pcmInput]);
    await convert({ input: pcmInput, output: pcmOutput, ffmpegPath: ffmpeg, ffprobePath: ffprobe, options: { fps: 60, quality: 'fast' } }).promise;
    const pcmResult = await probe(pcmOutput, ffprobe);
    assert.equal(pcmResult.hasAudio, true);
    assert.equal(pcmResult.streams.find(stream => stream.codec_type === 'audio').codec_name, 'aac');

    const longInput = path.join(dir, 'long.mp4');
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', longInput]);
    const job = convert({ input: longInput, output: cancelOutput, ffmpegPath: ffmpeg, ffprobePath: ffprobe, options: { fps: 120, quality: 'high' } });
    setTimeout(job.cancel, 150);
    await assert.rejects(job.promise, error => error.code === 'ECANCELED');
    await assert.rejects(fs.access(cancelOutput), error => error.code === 'ENOENT');
    assert.deepEqual((await fs.readdir(dir)).filter(name => name.includes('.nxmotion-')), []);
    console.log('engine integration: ok');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
