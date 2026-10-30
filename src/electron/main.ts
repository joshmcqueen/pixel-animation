import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from 'electron';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBinaries, MediaService } from './media.js';
import type { ExportRequest } from '../shared/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(here, '../../dist');
const runtimeRoot = mkdtempSync(path.join(tmpdir(), 'stride-frame-picker-'));
mkdirSync(path.join(runtimeRoot, 'profile'));
app.setPath('userData', path.join(runtimeRoot, 'profile'));
app.setPath('sessionData', path.join(runtimeRoot, 'profile'));
app.commandLine.appendSwitch('disable-http-cache');
app.setName('Stride');
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'sprite', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let window: BrowserWindow | null = null;
let media: MediaService | null = null;
let dialogOpen = false;
let lastExport: string | null = null;
let quitting = false;

function assertIdle() {
  if (dialogOpen || media?.busy) throw new Error('Wait for the current operation to finish.');
}

async function getMedia() {
  if (media) return media;
  const status = await findBinaries();
  if (!status.ffmpeg || !status.ffprobe) throw new Error('FFmpeg is missing. Install it with brew install ffmpeg, then retry.');
  media = new MediaService(path.join(runtimeRoot, 'frames'), { ffmpeg: status.ffmpeg, ffprobe: status.ffprobe }, event => {
    if (window && !window.isDestroyed()) window.webContents.send('progress', event);
  });
  return media;
}

app.whenReady().then(async () => {
  protocol.handle('app', async request => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const filename = path.resolve(uiRoot, relative);
    if (url.hostname !== 'ui' || !filename.startsWith(uiRoot + path.sep)) return new Response(null, { status: 403 });
    return net.fetch(pathToFileURL(filename).href);
  });
  protocol.handle('sprite', async request => {
    const url = new URL(request.url);
    const match = /^\/(full|thumb)\/(\d+)\.(png|jpg)$/.exec(url.pathname);
    if (!match || (match[1] === 'full' ? match[3] !== 'png' : match[3] !== 'jpg')) return new Response(null, { status: 404 });
    const filename = media?.framePath(url.hostname, match[1], Number(match[2]));
    if (!filename) return new Response(null, { status: 404 });
    const response = await net.fetch(pathToFileURL(filename).href);
    return new Response(response.body, { headers: { 'Content-Type': match[1] === 'full' ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-store' } });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !['app:', 'sprite:', 'file:', 'devtools:'].includes(new URL(details.url).protocol) });
  });

  function handle(channel: string, action: (...args: any[]) => unknown) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (event.sender !== window?.webContents || event.senderFrame?.url !== 'app://ui/index.html') throw new Error('Untrusted request.');
      return action(...args);
    });
  }
  handle('dependencies', () => findBinaries());
  handle('open-video', async () => {
    assertIdle();
    dialogOpen = true;
    try {
      const result = await dialog.showOpenDialog(window!, { title: 'Open a walking animation', filters: [{ name: 'MP4 video', extensions: ['mp4'] }], properties: ['openFile'] });
      if (result.canceled || !result.filePaths[0]) return null;
      const service = await getMedia();
      return await service.importClip(result.filePaths[0]);
    } finally { dialogOpen = false; }
  });
  handle('export-frames', async (request: ExportRequest) => {
    assertIdle();
    if (!request || typeof request !== 'object' || !media) throw new Error('Open a video first.');
    dialogOpen = true;
    try {
      const result = await dialog.showOpenDialog(window!, { title: 'Choose where to export your frames', buttonLabel: 'Export here', properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled || !result.filePaths[0]) return null;
      const exported = await media.exportClip(request, result.filePaths[0]);
      lastExport = exported.folder;
      return exported;
    } finally { dialogOpen = false; }
  });
  handle('cancel-operation', () => { media?.cancel(); });
  handle('reveal-export', async () => {
    if (lastExport) {
      const { shell } = await import('electron');
      shell.showItemInFolder(lastExport);
    }
  });

  window = new BrowserWindow({
    width: 1480, height: 960, minWidth: 1100, minHeight: 720,
    title: 'Stride · Frame Studio', backgroundColor: '#111219',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 22 },
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
    show: false,
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => { event.preventDefault(); });
  window.once('ready-to-show', () => window?.show());
  await window.loadURL('app://ui/index.html');
}).catch(error => {
  dialog.showErrorBox('Stride could not start', String(error));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void (async () => {
    await media?.dispose().catch(() => {});
    app.quit();
  })();
});
app.once('will-quit', () => {
  // Chromium flushes preferences after will-quit. A short-lived native helper
  // waits for this process to exit before removing only its unique temp folder.
  // Paths are passed as arguments, never interpolated into shell code.
  const cleanup = spawn('/bin/sh', ['-c',
    'attempts=0; while /bin/kill -0 "$1" 2>/dev/null; do attempts=$((attempts + 1)); [ "$attempts" -lt 100 ] || exit 0; /bin/sleep 0.1; done; /bin/sleep 0.2; /bin/rm -rf -- "$2"',
    'stride-cleanup', String(process.pid), runtimeRoot,
  ], { detached: true, stdio: 'ignore' });
  cleanup.on('error', () => { rmSync(runtimeRoot, { recursive: true, force: true, maxRetries: 3 }); });
  cleanup.unref();
});
