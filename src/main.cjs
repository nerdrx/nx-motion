const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { probe, convert, validateOptions, detectEncoders } = require('./engine.cjs');
const { convertGpu } = require('./gpu.cjs');
const unpack = p => p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
const ffmpegPath = unpack(require('ffmpeg-static'));
const ffprobePath = unpack(require('ffprobe-static').path);
const appRoot = path.resolve(__dirname, '..');
const runtimeRoot = appRoot.endsWith('.asar') ? path.dirname(appRoot) : path.join(appRoot, 'vendor');
const rifePath = path.join(runtimeRoot, 'rife', process.platform === 'win32' ? 'rife-ncnn-vulkan.exe' : 'rife-ncnn-vulkan');
const modelPath = path.join(runtimeRoot, 'rife', 'rife-v4.6');
let capabilitiesPromise;
let win, active, running = false, cancelled = false;
const approved = new Set();
const outputs = new Set();
let outputDir;
let diagnostics = '';
function record(event) {
  diagnostics = (diagnostics + `${new Date().toISOString()} ${JSON.stringify(event)}\n`).slice(-65536);
}
async function inspect(paths) {
  if (!Array.isArray(paths) || paths.length > 100) throw new Error('Choose up to 100 videos.');
  const result = [];
  for (const file of paths) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Choose a local video.');
    const info = await probe(file, ffprobePath);
    approved.add(file);
    const [numerator, denominator = 1] = String(info.frameRate || '0').split('/').map(Number);
    result.push({ ...info, fps: numerator / denominator || 0, audio: info.hasAudio, path: file, name: path.basename(file) });
  }
  return result;
}
function progress(event) { if (win && !win.isDestroyed()) win.webContents.send('progress', event); }
async function runBatch(files, directory, options) {
  try {
    for (let index = 0; index < files.length && !cancelled; index++) {
      const input = files[index];
      const base = path.parse(input).name;
      const suffix = options.previewSeconds ? '-preview' : '';
      const stem = `${base}-${options.interpolation === 'none' ? 'converted' : options.fps + 'fps'}${suffix}`;
      let output = path.join(directory, `${stem}.${options.container}`), counter = 1;
      while (await fs.access(output).then(() => true, () => false)) output = path.join(directory, `${stem}-${counter++}.${options.container}`);
      if (cancelled) break;
      const event = { index, total: files.length, file: input };
      progress({ ...event, status: 'processing', progress: 0 });
      try {
        let currentProgress = 0;
        const converter = options.interpolation === 'rife' ? convertGpu : convert;
        active = converter({ input, output, options, ffmpegPath, ffprobePath, rifePath, modelPath,
          onDiagnostic: detail => {
            record(detail);
            if (['reading-video', 'starting-encoder', 'encoder-started', 'saving-output', 'extracting-frames', 'interpolating', 'encoding'].includes(detail.stage))
              progress({ ...event, status: 'processing', progress: currentProgress, stage: detail.stage });
          },
          onProgress: value => {
            currentProgress = typeof value === 'number' ? value : value.progress ?? 0;
            progress({ ...event, status: 'processing', progress: currentProgress });
          } });
        await active.promise;
        outputs.add(output);
        progress({ ...event, status: 'done', progress: 1, output });
      } catch (error) {
        record({ stage: 'failed', error: error.message });
        progress({ ...event, status: cancelled ? 'cancelled' : 'error', error: error.message, progress: 0 });
      } finally { active = null; }
    }
  } catch (error) {
    record({ stage: 'failed', error: error.message });
    progress({ status: 'error', error: error.message });
  } finally {
    running = false;
    progress({ status: cancelled ? 'cancelled' : 'complete', total: files.length });
  }
}
app.whenReady().then(() => {
  ipcMain.handle('capabilities', () => capabilitiesPromise ||= Promise.all([
    detectEncoders(ffmpegPath),
    Promise.all([fs.access(rifePath), fs.access(path.join(modelPath, 'flownet.bin'))]).then(() => ({ available: true }), () => ({ available: false, error: 'GPU interpolation runtime is not installed for this platform.' }))
  ]).then(([encoders, gpu]) => ({ encoders, gpu })));
  ipcMain.handle('pickFiles', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'ts'] }] });
    return result.canceled ? [] : inspect(result.filePaths);
  });
  ipcMain.handle('inspect', (_, paths) => inspect(paths));
  ipcMain.handle('pickOutput', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    outputDir = result.filePaths[0];
    return outputDir;
  });
  ipcMain.handle('start', (_, request) => {
    if (running) return { ok: false, error: 'A conversion is already running.' };
    const { files, outputDir: directory } = request || {};
    let options;
    try { options = validateOptions(request?.options); }
    catch (error) { return { ok: false, error: error.message }; }
    if (!Array.isArray(files) || !files.length || files.length > 100 || files.some(f => !approved.has(f)) || directory !== outputDir || !directory)
      return { ok: false, error: 'Choose videos and an output folder first.' };
    if (!options || !Number.isFinite(options.fps) || options.fps < 1 || options.fps > 240)
      return { ok: false, error: 'Frame rate must be between 1 and 240.' };
    running = true; cancelled = false;
    diagnostics = '';
    record({ version: app.getVersion(), platform: process.platform, arch: process.arch, ffmpegPath, ffprobePath, options });
    void runBatch(files, directory, options);
    return { ok: true };
  });
  ipcMain.handle('cancel', () => { cancelled = true; active?.cancel(); });
  ipcMain.handle('copyDiagnostics', () => {
    clipboard.writeText(diagnostics || 'No conversion has started in this session.');
    return true;
  });
  ipcMain.handle('reveal', (_, file) => { if (outputs.has(file)) shell.showItemInFolder(file); });
  win = new BrowserWindow({ width: 1180, height: 850, minWidth: 760, minHeight: 640,
    backgroundColor: '#fafafc', title: 'NX Motion', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
  win.on('close', event => {
    if (!running) return;
    const answer = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Keep converting', 'Cancel and quit'], defaultId: 0, cancelId: 0, message: 'A video is still converting.', detail: 'Quitting cancels the current export. Completed videos are kept.' });
    if (answer === 0) event.preventDefault();
    else { cancelled = true; active?.cancel(); }
  });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => active?.cancel());
