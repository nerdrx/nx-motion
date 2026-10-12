'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const STDERR_LIMIT = 64 * 1024;

const ENCODERS = [
  ['libx264', 'H.264 (CPU)'], ['libx265', 'H.265 (CPU)'],
  ['h264_nvenc', 'H.264 (NVIDIA)'], ['hevc_nvenc', 'H.265 (NVIDIA)'],
  ['h264_amf', 'H.264 (AMD)'], ['hevc_amf', 'H.265 (AMD)'],
  ['h264_qsv', 'H.264 (Intel)'], ['hevc_qsv', 'H.265 (Intel)'],
];
const HARDWARE_ENCODERS = new Set(ENCODERS.map(([value]) => value).filter(value => !value.startsWith('lib')));

function validateOptions(options = {}) {
  const {
    fps = 60, quality = 'balanced', crf = 20, resolution = 'original', previewSeconds,
    audio = true, interpolation = 'cpu', encoder = 'libx264', container = 'mp4',
    preset = 'medium', audioBitrate = 192, bitrateMbps = 12,
    trimStart = 0, trimDuration, deinterlace = false, denoise = false,
  } = options;
  if (!Number.isFinite(fps) || fps < 1 || fps > 240) throw new RangeError('fps must be between 1 and 240');
  if (!['balanced', 'high', 'fast'].includes(quality)) throw new TypeError('quality must be balanced, high, or fast');
  if (!Number.isInteger(crf) || crf < 16 || crf > 28) throw new RangeError('crf must be an integer from 16 to 28');
  if (!['original', 2160, 1440, 1080, 720, 480, '2160', '1440', '1080', '720', '480'].includes(resolution)) throw new TypeError('resolution must be original, 2160, 1440, 1080, 720, or 480');
  if (previewSeconds !== undefined && (!Number.isFinite(previewSeconds) || previewSeconds <= 0 || previewSeconds > 60)) throw new RangeError('previewSeconds must be between 0 and 60');
  if (typeof audio !== 'boolean') throw new TypeError('audio must be a boolean');
  if (!['cpu', 'rife', 'none'].includes(interpolation)) throw new TypeError('interpolation must be cpu, rife, or none');
  if (!ENCODERS.some(([value]) => value === encoder)) throw new TypeError('unsupported encoder');
  if (!['mp4', 'mkv'].includes(container)) throw new TypeError('container must be mp4 or mkv');
  if (!['fast', 'medium', 'slow'].includes(preset)) throw new TypeError('preset must be fast, medium, or slow');
  if (![128, 192, 256, 320].includes(audioBitrate)) throw new RangeError('audioBitrate must be 128, 192, 256, or 320');
  if (!Number.isFinite(bitrateMbps) || bitrateMbps < 1 || bitrateMbps > 200) throw new RangeError('bitrateMbps must be between 1 and 200');
  if (!Number.isFinite(trimStart) || trimStart < 0) throw new RangeError('trimStart must be zero or greater');
  if (trimDuration !== undefined && (!Number.isFinite(trimDuration) || trimDuration <= 0 || trimDuration > 86400)) throw new RangeError('trimDuration must be greater than zero and at most 86400 seconds');
  if (typeof deinterlace !== 'boolean' || typeof denoise !== 'boolean') throw new TypeError('deinterlace and denoise must be booleans');
  return { fps, quality, crf, resolution: String(resolution), previewSeconds, audio, interpolation, encoder, container, preset, audioBitrate, bitrateMbps, trimStart, trimDuration, deinterlace, denoise };
}

function encodingArgs(options = {}) {
  const opts = validateOptions(options);
  const args = ['-c:v', opts.encoder];
  if (HARDWARE_ENCODERS.has(opts.encoder)) args.push('-b:v', `${opts.bitrateMbps}M`);
  else args.push('-preset', opts.preset, '-crf', String(opts.crf));
  args.push('-pix_fmt', 'yuv420p');
  if (opts.audio) args.push('-c:a', 'aac', '-b:a', `${opts.audioBitrate}k`);
  else args.push('-an');
  return args;
}

async function detectEncoders(ffmpegPath = 'ffmpeg') {
  return Promise.all(ENCODERS.map(async ([value, label]) => {
    let stderr = '';
    let child;
    try {
      const args = ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=128x128:r=1:d=1', '-frames:v', '1', '-c:v', value];
      if (HARDWARE_ENCODERS.has(value)) args.push('-b:v', '1M');
      else args.push('-preset', 'ultrafast', '-crf', '28');
      args.push('-pix_fmt', 'yuv420p', '-f', 'null', '-');
      const available = await new Promise((resolve, reject) => {
        let timer;
        child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
        child.once('error', reject);
        child.once('close', code => { clearTimeout(timer); resolve(code === 0); });
        timer = setTimeout(() => { child.kill(); reject(new Error('encoder check timed out after 10 seconds')); }, 10_000);
        timer.unref?.();
      });
      return { value, label, available, error: available ? null : stderr.trim() || 'Encoder initialization failed' };
    } catch (error) {
      child?.kill();
      return { value, label, available: false, error: error.message || 'Encoder initialization failed' };
    }
  }));
}

function runJson(executable, args, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('ffprobe cancelled'), { code: 'ECANCELED' }));
    let stdout = '';
    let stderr = '';
    let stopError;
    let settled = false;
    let timeout;
    let forceKill;
    let child;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve(value);
    };
    const stop = error => {
      if (settled) return;
      stopError = error;
      child?.kill();
      if (process.platform !== 'win32') {
        forceKill = setTimeout(() => child?.kill('SIGKILL'), 1500);
        forceKill.unref?.();
      }
      finish(error);
    };
    const onAbort = () => stop(Object.assign(new Error('ffprobe cancelled'), { code: 'ECANCELED' }));
    signal?.addEventListener('abort', onAbort, { once: true });
    child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-STDERR_LIMIT); });
    child.once('error', error => finish(stopError || error));
    child.once('close', code => {
      clearTimeout(forceKill);
      if (settled) return;
      if (stopError) return finish(stopError);
      if (code !== 0) return finish(new Error(`ffprobe failed (${code}): ${stderr.trim()}`));
      try { finish(null, JSON.parse(stdout)); } catch (error) { finish(new Error(`Invalid ffprobe output: ${error.message}`)); }
    });
    timeout = setTimeout(() => stop(Object.assign(new Error('ffprobe timed out after 30 seconds'), { code: 'ETIMEDOUT' })), 30_000);
    timeout.unref?.();
    if (signal?.aborted) onAbort();
  });
}

async function probe(file, ffprobePath = 'ffprobe', signal) {
  const data = await runJson(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], signal);
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
  const filters = [];
  if (opts.deinterlace) filters.push(opts.interpolation === 'none' ? 'yadif=mode=send_frame' : 'yadif');
  if (opts.denoise) filters.push('hqdn3d');
  if (opts.resolution !== 'original') filters.push(`scale=-2:'min(${opts.resolution},ih)'`);
  filters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2');
  const interpolation = opts.interpolation === 'cpu'
    ? (opts.quality === 'fast' ? `fps=${opts.fps},tblend=all_mode=average` : `minterpolate=fps=${opts.fps}:mi_mode=mci:mc_mode=${opts.quality === 'high' ? 'aobmc' : 'obmc'}:me_mode=bidir:vsbmc=1`)
    : `fps=${opts.fps}`;
  if (duration !== undefined && opts.interpolation !== 'none') filters.push(`tpad=stop_mode=clone:stop_duration=${Math.max(1, 2 / opts.fps)}`);
  if (opts.interpolation !== 'none') filters.push(interpolation);
  if (duration !== undefined) filters.push(`trim=duration=${duration}`, 'setpts=PTS-STARTPTS');

  const args = ['-hide_banner', '-nostdin', '-y'];
  if (opts.trimStart) args.push('-ss', String(opts.trimStart));
  args.push('-i', input, '-map', '0:v:0');
  if (opts.audio) args.push('-map', '0:a?');
  args.push('-vf', filters.join(','));
  if (duration !== undefined) args.push('-t', String(duration));
  args.push(...encodingArgs(opts));
  if (opts.interpolation !== 'none') args.push('-r', String(opts.fps), '-fps_mode', 'cfr');
  if (opts.container === 'mp4') args.push('-movflags', '+faststart', '-f', 'mp4');
  else args.push('-f', 'matroska');
  args.push('-progress', 'pipe:1', '-nostats', output);
  return args;
}

function convert({ input, output, options = {}, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', onProgress = () => {}, onDiagnostic = () => {} }) {
  const opts = validateOptions(options);
  if (typeof onProgress !== 'function') throw new TypeError('onProgress must be a function');
  if (typeof onDiagnostic !== 'function') throw new TypeError('onDiagnostic must be a function');
  const probeController = new AbortController();
  const diagnose = (stage, details = {}) => { try { onDiagnostic({ stage, ...details }); } catch { /* Diagnostics must not stop conversion. */ } };
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
    diagnose('reading-video');
    const details = await probe(input, ffprobePath, probeController.signal);
    if (cancelled) throw Object.assign(new Error('Conversion cancelled'), { code: 'ECANCELED' });
    if (details.duration !== null && opts.trimStart >= details.duration) throw new RangeError('trimStart must be shorter than the video duration');
    const availableDuration = details.duration === null ? null : details.duration - opts.trimStart;
    const limits = [availableDuration, opts.trimDuration, opts.previewSeconds].filter(Number.isFinite);
    const expectedDuration = limits.length ? Math.min(...limits) : null;
    const sourceFrames = details.fps && details.duration ? Math.round(details.fps * details.duration) : Infinity;
    // Motion estimation needs multiple source frames. Two-frame clips use the explicit blend path.
    const effectiveOptions = sourceFrames <= 2 && opts.interpolation === 'cpu' ? { ...opts, quality: 'fast' } : opts;
    const args = buildArgs(input, temp, { ...effectiveOptions, duration: expectedDuration ?? undefined });
    diagnose('starting-encoder');
    const result = await new Promise((resolve, reject) => {
      child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      let progressText = '';
      child.once('spawn', () => diagnose('encoder-started', { pid: child.pid }));
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        progressText += chunk;
        const lines = progressText.split(/\r?\n/);
        progressText = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('out_time_us=')) continue;
          const seconds = Number(line.slice(12)) / 1e6;
          if (Number.isFinite(seconds)) diagnose('encoder-progress', { seconds });
          if (Number.isFinite(seconds) && expectedDuration > 0) {
            try { onProgress(Math.min(0.99, Math.max(0, seconds / expectedDuration))); } catch { /* UI callbacks must not stop encoding. */ }
          }
        }
      });
      child.stderr.on('data', chunk => {
        stderr = (stderr + chunk).slice(-STDERR_LIMIT);
        diagnose('encoder-output', { text: String(chunk).slice(-2048) });
      });
      child.once('error', reject);
      child.once('close', code => {
        clearTimeout(killTimer);
        diagnose('encoder-exit', { code });
        if (cancelled) return reject(Object.assign(new Error('Conversion cancelled'), { code: 'ECANCELED' }));
        if (code !== 0) return reject(new Error(`ffmpeg failed (${code}): ${stderr.trim()}`));
        resolve();
      });
    });
    void result;
    if (cancelled) throw Object.assign(new Error('Conversion cancelled'), { code: 'ECANCELED' });
    diagnose('saving-output');
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
    diagnose('failed', { error: error.message });
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  });

  return {
    promise,
    cancel() {
      if (done || cancelled) return;
      cancelled = true;
      probeController.abort();
      if (!child) return;
      child.kill('SIGTERM');
      if (process.platform !== 'win32') {
        killTimer = setTimeout(() => { if (child && !done) child.kill('SIGKILL'); }, 1500);
        killTimer.unref?.();
      }
    },
  };
}

module.exports = { probe, buildArgs, convert, validateOptions, encodingArgs, detectEncoders };
