// Runs the real desktop app. Only the native file picker is replaced with fixture choices.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.cwd();
const output = path.join(root, '.cache', 'ui-smoke');
const answers = [];
dialog.showOpenDialog = async () => {
  const next = answers.shift();
  if (!next) throw new Error('Unexpected native file dialog in UI test.');
  return next;
};

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(win, expression, description, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await pause(60);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function click(win, selector) {
  await win.webContents.executeJavaScript(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) throw new Error('Button not available: ' + ${JSON.stringify(selector)}); element.click(); })()`);
  await pause(100);
}
async function setInput(win, selector, value) {
  await win.webContents.executeJavaScript(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, ${JSON.stringify(String(value))}); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await pause(100);
}
async function screenshot(win, name) {
  const image = await win.capturePage();
  await fs.writeFile(path.join(output, `${name}.png`), image.toPNG());
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => {
    void (async () => {
      try {
        await fs.mkdir(output, { recursive: true });
        await pause(400);
        await waitFor(win, `!document.querySelector('.import-button').disabled`, 'FFmpeg readiness');
        await screenshot(win, '01-empty');
        const { findBinaries, runProcess } = await import('../dist-main/electron/media.js');
        const binaries = await findBinaries();
        const fixture = path.join(output, 'walk_front.mp4');
        await runProcess(binaries.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=256x320:rate=12:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fixture]);
        answers.push({ canceled: false, filePaths: [fixture] });
        await click(win, '.import-button');
        await waitFor(win, `document.querySelector('.source-name')?.textContent.includes('walk_front.mp4') && !document.querySelector('.operation-overlay')`, 'video import');
        await waitFor(win, `document.querySelector('.preview-image')?.complete && document.querySelector('.preview-image')?.naturalWidth === 256`, 'decoded frame rendering');
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.frames-heading h2 span').textContent.trim()`), '12 / 12');
        // An intermediate value below the start frame must not prevent typing a multi-digit end.
        await setInput(win, '[aria-label="Start frame"]', 5);
        await setInput(win, '[aria-label="End frame"]', 1);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('[aria-label="End frame"]').value`), '1');
        await setInput(win, '[aria-label="End frame"]', 10);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.frames-heading h2 span').textContent.trim()`), '6 / 6');
        await setInput(win, '[aria-label="Start frame"]', 2);
        await setInput(win, '[aria-label="End frame"]', 11);
        await setInput(win, '#every', 3);
        await click(win, '.sample-row button');
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.frames-heading h2 span').textContent.trim()`), '4 / 10');
        await click(win, '[aria-label="Exclude frame 5"]');
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.frames-heading h2 span').textContent.trim()`), '3 / 10');
        await click(win, '[aria-label="Inspect frame 5"]');
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.preview-image').alt`), 'Source frame 5');
        assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.stage-caption').textContent.includes('EXCLUDED')`));
        await click(win, '[aria-label="Play loop"]');
        await pause(300);
        assert.notEqual(await win.webContents.executeJavaScript(`document.querySelector('.preview-image').alt`), 'Source frame 5');
        await click(win, '[aria-label="Include frame 5"]');
        await click(win, '[aria-label="Pause loop"]');
        await setInput(win, '[aria-label="Playback FPS"]', 8);
        assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.loop-duration').textContent.includes('0.50s')`));
        await click(win, '[aria-label="Next selected frame"]');
        await screenshot(win, '02-selection');
        await click(win, '.selection-actions button:last-child');
        assert.ok(await win.webContents.executeJavaScript(`!!document.querySelector('.empty-selection') && document.querySelector('.export-button').disabled`));
        await click(win, '[aria-label="Include frame 8"]');
        await click(win, '[aria-label="Play loop"]');
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.preview-image').alt`), 'Source frame 8');
        await click(win, '.sample-row button');
        await setInput(win, '#export-name', 'smoke_walk');
        answers.push({ canceled: false, filePaths: [output] });
        await click(win, '.export-button');
        await waitFor(win, `!!document.querySelector('.export-success')`, 'PNG export');
        const exports = (await fs.readdir(output)).filter(name => /^smoke_walk(?:-\d+)?$/.test(name));
        assert.ok(exports.length > 0);
        const folder = path.join(output, exports.sort((a, b) => (Number(a.split('-')[1]) || 1) - (Number(b.split('-')[1]) || 1)).at(-1));
        assert.deepEqual(await fs.readdir(folder), ['frame_0001.png', 'frame_0002.png', 'frame_0003.png', 'frame_0004.png']);
        await screenshot(win, '03-exported');
        answers.push({ canceled: true, filePaths: [] });
        await click(win, '.import-button');
        await waitFor(win, `!document.querySelector('.operation-overlay')`, 'file dialog cancellation');
        assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.source-name').textContent.includes('walk_front.mp4')`));
        win.setSize(1100, 720);
        await pause(250);
        await screenshot(win, '04-small-window');
        assert.equal(await win.webContents.executeJavaScript(`document.documentElement.scrollWidth > window.innerWidth`), false);
        assert.equal(answers.length, 0);
        console.log('UI smoke passed: native import → range → sampling → toggles → inspection → FPS → empty/single-frame playback → PNG export → dialog cancellation → small-window layout.');
        await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, screenshots: ['01-empty.png', '02-selection.png', '03-exported.png', '04-small-window.png'] }, null, 2));
        app.quit();
      } catch (error) {
        console.error(error);
        await screenshot(win, 'failure').catch(() => {});
        process.exitCode = 1;
        app.quit();
      }
    })();
  });
});
void import('../dist-main/electron/main.js');
