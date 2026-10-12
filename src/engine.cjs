'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const STDERR_LIMIT = 64 * 1024;

function validateOptions(options = {}) {
  const { fps = 60, quality = 'balanced', crf = 20, resolution = 'original', previewSeconds, audio = true } = options;
  if (!Number.isFinite(fps) || fps < 1 || fps > 240) throw new RangeError('fps must be between 1 and 240');
  if (!['balanced', 'high', 'fast'].includes(quality)) throw new TypeError('quality must be balanced, high, or fast');
  if (!Number.isInteger(crf) || crf < 16 || crf > 28) throw new RangeError('crf must be an integer from 16 to 28');
  if (!['original', '1080', '720'].includes(resolution)) throw new TypeError('resolution must be original, 1080, or 720');
  if (previewSeconds !== undefined && (!Number.isFinite(previewSeconds) || previewSeconds <= 0 || previewSeconds > 60)) throw new RangeError('previewSeconds must be between 0 and 60');
  if (typeof audio !== 'boolean') throw new TypeError('audio must be a boolean');
  return { fps, quality, crf, resolution, previewSeconds, audio };
}

function runJson(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-STDERR_LIMIT); });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) return reject(new Error(`ffprobe failed (${code}): ${stderr.trim()}`));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(new Error(`Invalid ffprobe output: ${error.message}`)); }
    });
  });
}

async function probe(file, ffprobePath = 'ffprobe') {
  const data = await runJson(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  const video = data.streams?.find(stream => stream.codec_type === 'video');
  if (!video) throw new Error('Input has no video stream');
  const duration = Number(data.format?.duration || video.duration);
  return {
    duration: Number.isFinite(duration) ? duration : null,
    width: video.width,
    height: video.height,
    frameRate: video.avg_frame_rate || video.r_frame_rate || null,
    fps: (() => { const [n, d] = String(video.avg_frame_rate || video.r_frame_rate || '').split('/').map(Number); return d ? n / d : null; })(),
    hasAudio: data.streams.some(stream => stream.codec_type === 'audio'),
    audio: data.streams.some(stream => stream.codec_type === 'audio'),
    streams: data.streams,
  };
}

function buildArgs(input, output, options = {}) {
  const opts = validateOptions(options);
  const duration = options.duration;
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) throw new RangeError('duration must be positive');
  const scale = opts.resolution === 'original' ? null : `scale=-2:'min(${opts.resolution},ih)'`;
  const even = 'pad=ceil(iw/2)*2:ceil(ih/2)*2';
  const interpolation = opts.quality === 'fast'
    ? `fps=${opts.fps},tblend=all_mode=average`
    : `minterpolate=fps=${opts.fps}:mi_mode=mci:mc_mode=${opts.quality === 'high' ? 'aobmc' : 'obmc'}:me_mode=bidir:vsbmc=1`;
  const padTail = duration === undefined ? null : `tpad=stop_mode=clone:stop_duration=${Math.max(1, 2 / opts.fps)}`;
  const tail = duration === undefined ? [] : [`trim=duration=${duration}`, 'setpts=PTS-STARTPTS'];
  const filters = [scale, even, padTail, interpolation, ...tail].filter(Boolean).join(',');
  const args = ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:v:0'];
  if (opts.audio) args.push('-map', '0:a?');
  args.push('-vf', filters);
  if (opts.previewSeconds !== undefined) args.push('-t', String(opts.previewSeconds));
  args.push('-c:v', 'libx264', '-preset', opts.quality === 'high' ? 'slow' : opts.quality === 'fast' ? 'veryfast' : 'medium', '-crf', String(opts.crf), '-pix_fmt', 'yuv420p');
  if (opts.audio) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-r', String(opts.fps), '-fps_mode', 'cfr', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output);
  return args;
}

function convert({ input, output, options = {}, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', onProgress = () => {} }) {
  const opts = validateOptions(options);
  if (typeof onProgress !== 'function') throw new TypeError('onProgress must be a function');
  let child;
  let cancelled = false;
  let done = false;
  let killTimer;
  const extension = path.extname(output);
  const stem = output.slice(0, output.length - extension.length);
  const temp = `${stem}.nxmotion-${process.pid}-${randomBytes(5).toString('hex')}${extension}`;

  const promise = (async () => {
    await fs.access(input);
    if (cancelled) throw Object.assign(new Error('Conversion cancelled'), { code: 'ECANCELED' });
    try { await fs.access(output); throw Object.assign(new Error('Output already exists'), { code: 'EEXIST' }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const details = await probe(input, ffprobePath);
    if (cancelled) throw Object.assign(new Error('Conversion cancelled'), { code: 'ECANCELED' });
    const expectedDuration = opts.previewSeconds ? Math.min(details.duration || opts.previewSeconds, opts.previewSeconds) : details.duration;
    const sourceFrames = details.fps && details.duration ? Math.round(details.fps * details.duration) : Infinity;
    // Motion estimation needs multiple source frames. Two-frame clips use the explicit blend path.
    const effectiveOptions = sourceFrames <= 2 ? { ...opts, quality: 'fast' } : opts;
    const args = buildArgs(input, temp, { ...effectiveOptions, duration: expectedDuration ?? undefined });
    const result = await new Promise((resolve, reject) => {
      child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      let progressText = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        progressText += chunk;
        const lines = progressText.split(/\r?\n/);
        progressText = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('out_time_us=')) continue;
          const seconds = Number(line.slice(12)) / 1e6;
          if (Number.isFinite(seconds) && expectedDuration > 0) {
            try { onProgress(Math.min(0.99, Math.max(0, seconds / expectedDuration))); } catch { /* UI callbacks must not stop encoding. */ }
          }
        }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-STDERR_LIMIT); });
      child.once('error', reject);
      child.once('close', code => {
        clearTimeout(killTimer);
        if (cancelled) return reject(Object.assign(new Error('Conversion cancelled'), { code: 'ECANCELED' }));
        if (code !== 0) return reject(new Error(`ffmpeg failed (${code}): ${stderr.trim()}`));
        resolve();
      });
    });
    void result;
    if (cancelled) throw Object.assign(new Error('Conversion cancelled'), { code: 'ECANCELED' });
    // Linking within the destination directory atomically refuses to replace an existing file.
    try {
      await fs.link(temp, output);
    } catch (error) {
      if (!['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
      await fs.copyFile(temp, output, fs.constants.COPYFILE_EXCL);
    }
    await fs.unlink(temp);
    if (cancelled) { await fs.rm(output, { force: true }); throw Object.assign(new Error('Conversion cancelled'), { code: 'ECANCELED' }); }
    done = true;
    try { onProgress(1); } catch { /* UI callbacks must not stop completion. */ }
    return { output, duration: expectedDuration };
  })().catch(async error => {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  });

  return {
    promise,
    cancel() {
      if (done || cancelled) return;
      cancelled = true;
      if (!child) return;
      child.kill('SIGTERM');
      if (process.platform !== 'win32') {
        killTimer = setTimeout(() => { if (child && !done) child.kill('SIGKILL'); }, 1500);
        killTimer.unref?.();
      }
    },
  };
}

module.exports = { probe, buildArgs, convert };
