// Run inside headless Gamescope: electron test/ui-smoke.cjs
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
let fixtureDir;
const watchdog = setTimeout(() => { console.error('UI smoke timed out'); app.exit(1); }, 60000);
require('../src/main.cjs');
app.whenReady().then(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nx-motion-ui-'));
    const input = path.join(fixtureDir, 'source.mp4');
    execFileSync(require('ffmpeg-static'), ['-v','error','-f','lavfi','-i','testsrc2=size=96x64:rate=30:duration=1','-c:v','libx264', input]);
    const errors = [];
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    dialog.showOpenDialog = async (_win, opts) => ({ canceled: false, filePaths: opts.properties.includes('openDirectory') ? [fixtureDir] : [input] });
    const js = expression => win.webContents.executeJavaScript(expression);
    const waitFor = async expression => {
      const deadline = Date.now() + 20000;
      while (!await js(expression)) {
        if (Date.now() > deadline) throw new Error(`Timed out: ${expression}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };
    await js("document.querySelector('#add-files').click()");
    await waitFor("document.querySelector('#queue').textContent.includes('source.mp4')");
    await js("document.querySelector('#output-picker').click()");
    await waitFor("!document.querySelector('#start-button').disabled");
    await fs.mkdir(path.join(__dirname, '../validation'), { recursive: true });
    await js("document.documentElement.dataset.theme='light'");
    await new Promise(resolve => setTimeout(resolve, 350));
    await fs.writeFile(path.join(__dirname, '../validation/light.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#theme-toggle').click()");
    await new Promise(resolve => setTimeout(resolve, 350));
    await fs.writeFile(path.join(__dirname, '../validation/dark.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#start-button').click()");
    await waitFor("document.querySelector('#results').textContent.length > 0");
    await waitFor("!document.querySelector('#start-button').disabled");
    const files = await fs.readdir(fixtureDir);
    assert(files.some(file => file.includes('60fps') && file.endsWith('.mp4')), JSON.stringify(files));
    const output = path.join(fixtureDir, files.find(file => file.includes('60fps') && file.endsWith('.mp4')));
    const details = await require('../src/engine.cjs').probe(output, require('ffprobe-static').path);
    assert.equal(details.fps, 60);
    assert.equal(errors.length, 0, errors.join('\n'));
    await fs.writeFile(path.join(__dirname, '../validation/completed.png'), (await win.webContents.capturePage()).toPNG());
    console.log('UI smoke passed: import, output selection, themes, real 30→60 conversion, result.');
    clearTimeout(watchdog);
    await fs.rm(fixtureDir, { recursive: true, force: true });
    app.exit(0);
  } catch (error) { console.error(error); clearTimeout(watchdog); app.exit(1); }
});
