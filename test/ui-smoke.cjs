// Run inside headless Gamescope: electron test/ui-smoke.cjs
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
let fixtureDir;
const watchdog = setTimeout(() => { console.error('UI smoke timed out'); app.exit(1); }, 60000);
require(path.resolve(process.env.MOTION_APP_ROOT || path.join(__dirname, '..'), 'src/main.cjs'));
app.whenReady().then(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nx-motion-ui-'));
    const input = path.join(fixtureDir, 'source.mp4');
    execFileSync(require('ffmpeg-static'), ['-v','error','-f','lavfi','-i','testsrc2=size=96x64:rate=30:duration=1','-c:v','libx264', input]);
    const errors = [];
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    let folderRequests = 0;
    dialog.showOpenDialog = async (_win, opts) => {
      if (opts.properties.includes('openDirectory')) {
        folderRequests++;
        return folderRequests === 1 ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [fixtureDir] };
      }
      return { canceled: false, filePaths: [input] };
    };
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
    // Regression: Start must prompt for a folder rather than silently stay disabled.
    assert.equal(await js("document.querySelector('#start-button').disabled"), false);
    await js("document.querySelector('#start-button').click()");
    await waitFor("!document.querySelector('#start-button').disabled");
    assert.equal(folderRequests, 1);
    assert.equal(await js("document.querySelector('#progress-panel').classList.contains('hidden')"), true);
    await fs.mkdir(path.join(__dirname, '../validation'), { recursive: true });
    await js("document.documentElement.dataset.theme='light'");
    assert.equal(await js("getComputedStyle(document.querySelector('option')).color"), 'rgb(26, 24, 35)');
    assert.equal(await js("getComputedStyle(document.querySelector('option')).backgroundColor"), 'rgb(255, 255, 255)');
    await new Promise(resolve => setTimeout(resolve, 350));
    await fs.writeFile(path.join(__dirname, '../validation/light.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#theme-toggle').click()");
    assert.equal(await js("getComputedStyle(document.querySelector('option')).color"), 'rgb(244, 243, 248)');
    assert.equal(await js("getComputedStyle(document.querySelector('option')).backgroundColor"), 'rgb(18, 16, 23)');
    await new Promise(resolve => setTimeout(resolve, 350));
    await fs.writeFile(path.join(__dirname, '../validation/dark.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#start-button').click()");
    await waitFor("document.querySelector('#results').textContent.length > 0");
    await waitFor("!document.querySelector('#start-button').disabled");
    assert.equal(folderRequests, 2);
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
