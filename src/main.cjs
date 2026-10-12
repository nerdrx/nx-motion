const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { probe, convert } = require('./engine.cjs');
const unpack = p => p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
const ffmpegPath = unpack(require('ffmpeg-static'));
const ffprobePath = unpack(require('ffprobe-static').path);
let win, active, running = false, cancelled = false;
const approved = new Set();
const outputs = new Set();
let outputDir;
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
      const stem = `${base}-${options.fps}fps${suffix}`;
      let output = path.join(directory, `${stem}.mp4`), counter = 1;
      while (await fs.access(output).then(() => true, () => false)) output = path.join(directory, `${stem}-${counter++}.mp4`);
      const event = { index, total: files.length, file: input };
      progress({ ...event, status: 'processing', progress: 0 });
      try {
        active = convert({ input, output, options, ffmpegPath, ffprobePath,
          onProgress: value => progress({ ...event, status: 'processing', progress: typeof value === 'number' ? value : value.progress ?? 0 }) });
        await active.promise;
        outputs.add(output);
        progress({ ...event, status: 'done', progress: 1, output });
      } catch (error) {
        progress({ ...event, status: cancelled ? 'cancelled' : 'error', error: error.message, progress: 0 });
      } finally { active = null; }
    }
  } finally {
    running = false;
    progress({ status: cancelled ? 'cancelled' : 'complete', total: files.length });
  }
}
app.whenReady().then(() => {
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
    const { files, options, outputDir: directory } = request || {};
    if (!Array.isArray(files) || !files.length || files.length > 100 || files.some(f => !approved.has(f)) || directory !== outputDir || !directory)
      return { ok: false, error: 'Choose videos and an output folder first.' };
    if (!options || !Number.isFinite(options.fps) || options.fps < 1 || options.fps > 240)
      return { ok: false, error: 'Frame rate must be between 1 and 240.' };
    running = true; cancelled = false;
    void runBatch(files, directory, options);
    return { ok: true };
  });
  ipcMain.handle('cancel', () => { cancelled = true; active?.cancel(); });
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
