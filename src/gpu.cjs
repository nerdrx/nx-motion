'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { probe, validateOptions, encodingArgs } = require('./engine.cjs');

const cancelledError = () => Object.assign(new Error('Conversion cancelled'), { code: 'ECANCELED' });

function planFrames(details, options) {
  if (!(details.duration > 0) || !(details.fps > 0) || !(details.width > 0) || !(details.height > 0)) {
    throw new Error('GPU interpolation needs a video with a known duration, frame rate, and size. Remux the source or use CPU interpolation.');
  }
  const start = options.trimStart || 0;
  const duration = Math.min(details.duration - start, options.trimDuration || Infinity, options.previewSeconds || Infinity);
  if (!(duration > 0)) throw new Error('Trim start is beyond the end of the video.');
  const video = details.streams?.find(stream => stream.codec_type === 'video');
  const rotation = Number(video?.side_data_list?.find(item => item.rotation !== undefined)?.rotation || video?.tags?.rotate || 0);
  const rotated = Math.abs(rotation % 180) === 90;
  const sourceWidth = rotated ? details.height : details.width;
  const sourceHeight = rotated ? details.width : details.height;
  const height = options.resolution === 'original' ? sourceHeight : Math.min(Number(options.resolution), sourceHeight);
  const width = Math.ceil(sourceWidth * height / sourceHeight / 2) * 2;
  const paddedHeight = Math.ceil(height / 2) * 2;
  const sourceCount = Math.max(1, Math.ceil(duration * details.fps));
  const targetCount = Math.max(1, Math.round(duration * options.fps));
  // ponytail: whole-clip PNG staging; disk guard bounds this version until a streaming RIFE backend exists.
  const estimatedBytes = Math.ceil(width * paddedHeight * 4 * (sourceCount + targetCount) * 1.2 + 512 * 1024 * 1024);
  return { start, duration, height: paddedHeight, sourceCount, targetCount, estimatedBytes };
}

function rifeArgs(inputDir, outputDir, modelPath, count, height) {
  return ['-i', inputDir, '-o', outputDir, '-m', modelPath, '-n', String(count), '-g', '0', '-j', '1:1:1', '-f', '%08d.png', ...(height >= 1440 ? ['-u'] : [])];
}

function convertGpu({ input, output, options = {}, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', rifePath, modelPath, onProgress = () => {}, onDiagnostic = () => {} }) {
  const opts = validateOptions(options);
  if (!rifePath || !modelPath) throw new Error('RIFE GPU runtime is missing. Reinstall the complete NX Motion download.');
  if (typeof onProgress !== 'function' || typeof onDiagnostic !== 'function') throw new TypeError('Progress and diagnostic callbacks must be functions');
  const controller = new AbortController();
  let cancelled = false;
  let done = false;
  let child;
  let killTimer;
  let tempDir;
  let ownsOutput = false;
  const checkCancelled = () => { if (cancelled) throw cancelledError(); };
  const diagnose = (stage, extra = {}) => { try { onDiagnostic({ stage, ...extra }); } catch {} };
  const progress = value => { try { onProgress(value); } catch {} };

  function run(executable, args, stage, duration, offset, weight) {
    checkCancelled();
    return new Promise((resolve, reject) => {
      let stderr = '';
      let pending = '';
      const running = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child = running;
      running.once('spawn', () => diagnose(stage, { pid: running.pid }));
      running.stdout.setEncoding('utf8');
      running.stderr.setEncoding('utf8');
      running.stdout.on('data', chunk => {
        pending = (pending + chunk).slice(-65536);
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('out_time_us=')) continue;
          const seconds = Number(line.slice(12)) / 1e6;
          if (Number.isFinite(seconds) && duration > 0) progress(offset + Math.min(1, Math.max(0, seconds / duration)) * weight);
        }
      });
      running.stderr.on('data', chunk => {
        stderr = (stderr + chunk).slice(-65536);
        diagnose(`${stage}-output`, { text: chunk.slice(-2048) });
      });
      running.once('error', error => reject(cancelled ? cancelledError() : error));
      running.once('close', code => {
        clearTimeout(killTimer);
        if (child === running) child = null;
        if (cancelled) return reject(cancelledError());
        if (code !== 0) {
          const hint = stage === 'interpolating' ? 'RIFE GPU interpolation failed. Update your GPU Vulkan driver, lower the resolution, or select CPU interpolation.' : `${stage} failed`;
          return reject(new Error(`${hint} (${code}) ${stderr.trim()}`));
        }
        resolve();
      });
    });
  }

  const promise = (async () => {
    await fs.access(input);
    checkCancelled();
    try { await fs.access(output); throw Object.assign(new Error('Output already exists'), { code: 'EEXIST' }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.access(rifePath);
    await fs.access(modelPath);
    diagnose('reading-video');
    const details = await probe(input, ffprobePath, controller.signal);
    checkCancelled();
    const plan = planFrames(details, opts);
    const destination = path.dirname(output);
    const disk = await fs.statfs(destination);
    const available = Number(disk.bavail) * Number(disk.bsize);
    if (plan.estimatedBytes > available) throw new Error(`GPU interpolation stages the whole clip as PNG frames and needs approximately ${(plan.estimatedBytes / 1024 ** 3).toFixed(1)} GB free in the output drive. Trim the video, lower its resolution, or free disk space.`);
    diagnose('gpu-staging', { estimatedBytes: plan.estimatedBytes, duration: plan.duration });
    tempDir = await fs.mkdtemp(path.join(destination, '.nxmotion-gpu-'));
    const sourceDir = path.join(tempDir, 'source');
    const framesDir = path.join(tempDir, 'frames');
    const temp = path.join(tempDir, `output${path.extname(output)}`);
    await fs.mkdir(sourceDir);
    await fs.mkdir(framesDir);
    const filters = [
      opts.deinterlace ? 'yadif=mode=send_frame' : null,
      opts.denoise ? 'hqdn3d' : null,
      opts.resolution === 'original' ? null : `scale=-2:'min(${opts.resolution},ih)'`,
      'pad=ceil(iw/2)*2:ceil(ih/2)*2', `fps=${details.fps}`, 'format=rgb24',
    ].filter(Boolean).join(',');
    await run(ffmpegPath, ['-hide_banner', '-nostdin', '-n', '-ss', String(plan.start), '-i', input, '-t', String(plan.duration), '-map', '0:v:0', '-an', '-vf', filters, '-start_number', '1', '-progress', 'pipe:1', '-nostats', path.join(sourceDir, '%08d.png')], 'extracting-frames', plan.duration, 0, 0.2);
    checkCancelled();
    const sources = (await fs.readdir(sourceDir)).filter(name => name.endsWith('.png')).sort();
    if (!sources.length) throw new Error('No video frames were decoded. Try a different source or trim range.');
    let framePattern;
    if (sources.length === 1 || plan.targetCount === 1) {
      diagnose('gpu-single-frame');
      framePattern = path.join(sourceDir, sources[0]);
    } else {
      // Use asynchronous directory iteration so large clips do not allocate a second filename list every tick.
      let counting = false;
      let interpolating = true;
      const timer = setInterval(async () => {
        if (counting || cancelled) return;
        counting = true;
        try {
          let count = 0;
          for await (const entry of await fs.opendir(framesDir)) if (entry.name.endsWith('.png')) count++;
          if (!cancelled && interpolating) progress(0.2 + Math.min(1, count / plan.targetCount) * 0.6);
        } catch {} finally { counting = false; }
      }, 500);
      timer.unref?.();
      try { await run(rifePath, rifeArgs(sourceDir, framesDir, modelPath, plan.targetCount, plan.height), 'interpolating'); }
      finally { interpolating = false; clearInterval(timer); }
      checkCancelled();
      const generated = (await fs.readdir(framesDir)).filter(name => name.endsWith('.png'));
      if (generated.length !== plan.targetCount) throw new Error(`RIFE produced ${generated.length} of ${plan.targetCount} frames. Check GPU drivers and available disk space.`);
      framePattern = path.join(framesDir, '%08d.png');
    }
    progress(0.8);
    const args = ['-hide_banner', '-nostdin', '-n'];
    if (sources.length === 1 || plan.targetCount === 1) args.push('-loop', '1');
    args.push('-framerate', String(opts.fps), '-start_number', '1', '-i', framePattern);
    if (opts.audio && details.hasAudio) args.push('-ss', String(plan.start), '-i', input);
    args.push('-map', '0:v:0');
    if (opts.audio && details.hasAudio) args.push('-map', '1:a:0?');
    args.push('-t', String(plan.duration), ...encodingArgs(opts));
    if (!opts.audio || !details.hasAudio) args.push('-an');
    args.push('-r', String(opts.fps), '-fps_mode', 'cfr');
    if (opts.container !== 'mkv') args.push('-movflags', '+faststart');
    args.push('-progress', 'pipe:1', '-nostats', temp);
    await run(ffmpegPath, args, 'encoding', plan.duration, 0.8, 0.19);
    checkCancelled();
    diagnose('saving-output');
    try { await fs.link(temp, output); }
    catch (error) {
      if (!['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
      await fs.copyFile(temp, output, fs.constants.COPYFILE_EXCL);
    }
    ownsOutput = true;
    checkCancelled();
    done = true;
    progress(1);
    return { output, duration: plan.duration };
  })().catch(async error => {
    diagnose('failed', { error: error.message });
    if (ownsOutput) await fs.rm(output, { force: true }).catch(() => {});
    throw error;
  }).finally(async () => {
    clearTimeout(killTimer);
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(error => diagnose('cleanup-failed', { error: error.message, path: tempDir }));
  });

  return { promise, cancel() {
    if (done || cancelled) return;
    cancelled = true;
    controller.abort();
    const running = child;
    if (running) {
      running.kill('SIGTERM');
      if (process.platform !== 'win32') {
        killTimer = setTimeout(() => running.kill('SIGKILL'), 1500);
        killTimer.unref?.();
      }
    }
  } };
}

module.exports = { convertGpu, planFrames, rifeArgs };
