import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import path from 'node:path';

const before = new Set((await readdir(tmpdir())).filter(name => name.startsWith('stride-frame-picker-')));
const executable = path.resolve('release/Stride-darwin-arm64/Stride.app/Contents/MacOS/Stride');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, ['--remote-debugging-port=0'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
const exited = new Promise(resolve => child.once('exit', resolve));
let socket;
let endpointTimer;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = '';
    endpointTimer = setTimeout(() => reject(new Error(`Packaged app did not start. ${stderr}`)), 15000);
    child.once('error', reject);
    child.stderr.on('data', data => {
      stderr += data.toString();
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr);
      if (match) { clearTimeout(endpointTimer); resolve(match[1]); }
    });
  });
  const base = `http://${new URL(endpoint).host}`;
  let target;
  for (let attempt = 0; attempt < 80; attempt++) {
    const targets = await (await fetch(`${base}/json/list`)).json();
    target = targets.find(candidate => candidate.type === 'page' && candidate.url === 'app://ui/index.html');
    if (target) break;
    await delay(100);
  }
  assert.ok(target, 'Packaged renderer did not load.');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (request) {
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 10000);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const state = await send('Runtime.evaluate', { expression: `document.readyState === 'complete' && !!window.stride && !!document.querySelector('.import-button')`, returnByValue: true });
      if (state.result?.value === true) { ready = true; break; }
    } catch (error) {
      if (!String(error).includes('context')) throw error;
    }
    await delay(100);
  }
  assert.equal(ready, true, 'Packaged UI did not become ready.');
  const result = await send('Runtime.evaluate', {
    expression: `(async () => { for (let i=0;i<100 && !document.querySelector('.import-button');i++) await new Promise(r=>setTimeout(r,50)); return { title: document.title, openButton: !!document.querySelector('.import-button'), dependencies: await window.stride.dependencies() }; })()`,
    awaitPromise: true, returnByValue: true,
  });
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  assert.equal(result.result.value.title, 'Stride · Frame Studio');
  assert.equal(result.result.value.openButton, true);
  assert.equal(result.result.value.dependencies.ready, true);
  await delay(250);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await mkdir('.cache/ui-smoke', { recursive: true });
  await writeFile('.cache/ui-smoke/05-packaged.png', Buffer.from(screenshot.data, 'base64'));
  await send('Runtime.evaluate', { expression: 'setTimeout(() => window.close(), 100); true' });
  socket.close();
  const code = await Promise.race([exited, delay(10000).then(() => 'timeout')]);
  assert.equal(code, 0, 'Packaged app did not quit cleanly.');
  let leftovers = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    leftovers = (await readdir(tmpdir())).filter(name => name.startsWith('stride-frame-picker-') && !before.has(name));
    if (!leftovers.length) break;
    await delay(100);
  }
  assert.deepEqual(leftovers, [], 'Runtime cache was not cleaned on quit.');
  console.log('Packaged Mac app passed: renderer, native bridge, Homebrew FFmpeg discovery, clean exit, and temporary profile cleanup.');
} finally {
  clearTimeout(endpointTimer);
  socket?.close();
  if (child.exitCode === null) child.kill('SIGTERM');
}
