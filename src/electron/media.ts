import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Clip, DependencyStatus, ExportRequest, ExportResult, Progress } from '../shared/types.js';
import { validateExportFrames, validateFolderName } from '../shared/selection.js';

export type Binaries = { ffmpeg: string; ffprobe: string };
type Session = { clip: Clip; directory: string };

export async function findBinaries(): Promise<DependencyStatus> {
  const directories = [...new Set(['/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH ?? '').split(path.delimiter)])].filter(Boolean);
  const find = async (name: string) => {
    for (const directory of directories) {
      const binary = path.join(directory, name);
      try {
        await access(binary, constants.X_OK);
        await runProcess(binary, ['-version'], undefined, undefined, 5000);
        return binary;
      } catch { /* Try the next known location. */ }
    }
    return null;
  };
  const [ffmpeg, ffprobe] = await Promise.all([find('ffmpeg'), find('ffprobe')]);
  return { ready: Boolean(ffmpeg && ffprobe), ffmpeg, ffprobe };
}

export function runProcess(binary: string, args: string[], signal?: AbortSignal, onOutput?: (chunk: string) => void, timeoutMs = 600_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Cancelled.')); return; }
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1500);
      killTimer.unref();
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    timer.unref();
    signal?.addEventListener('abort', stop, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', stop);
    };
    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout = (stdout + text).slice(-8_000_000);
      onOutput?.(text);
    });
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-16_000); });
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => {
      cleanup();
      if (signal?.aborted) reject(new Error('Cancelled.'));
      else if (timedOut) reject(new Error('The video decoder took too long. Try a shorter clip.'));
      else if (code !== 0) reject(new Error(stderr.trim() || `Video decoder exited with code ${code}.`));
      else resolve(stdout);
    });
  });
}

function fractionToNumber(value: string | undefined): number {
  const [a, b] = (value ?? '').split('/').map(Number);
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : 0;
}

export class MediaService {
  private session: Session | null = null;
  private operation: AbortController | null = null;
  private operationDone: Promise<void> | null = null;

  constructor(private root: string, private binaries: Binaries, private progress: (event: Progress) => void = () => {}) {}

  get busy(): boolean { return this.operation !== null; }
  get clip(): Clip | null { return this.session?.clip ?? null; }

  private async job<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.operation) throw new Error('Wait for the current operation to finish.');
    const controller = new AbortController();
    this.operation = controller;
    let finish!: () => void;
    this.operationDone = new Promise(resolve => { finish = resolve; });
    try { return await work(controller.signal); }
    finally { this.operation = null; this.operationDone = null; finish(); }
  }

  cancel(): void { this.operation?.abort(); }

  async importClip(source: string): Promise<Clip> {
    return this.job(async signal => {
      const sourceStat = await stat(source);
      if (!sourceStat.isFile() || path.extname(source).toLowerCase() !== '.mp4') throw new Error('Choose an MP4 video file.');
      this.progress({ kind: 'import', fraction: 0, message: 'Reading video…' });
      const metadata = JSON.parse(await runProcess(this.binaries.ffprobe, [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate,duration:format=duration', '-of', 'json', source,
      ], signal, undefined, 30_000));
      const stream = metadata.streams?.[0];
      if (!stream || !stream.width || !stream.height) throw new Error('This MP4 has no readable video stream.');
      const duration = Number(stream.duration ?? metadata.format?.duration) || 0;
      const sourceFps = fractionToNumber(stream.avg_frame_rate);
      await mkdir(this.root, { recursive: true });
      const directory = await mkdtemp(path.join(this.root, 'clip-'));
      try {
        await mkdir(path.join(directory, 'full'));
        await mkdir(path.join(directory, 'thumb'));
        let buffer = '';
        let lastFrame = 0;
        await runProcess(this.binaries.ffmpeg, [
          '-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', '-i', source,
          '-filter_complex', '[0:v:0]split=2[full][small];[small]scale=160:160:force_original_aspect_ratio=decrease:flags=neighbor[thumb]',
          '-map', '[full]', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-start_number', '1', path.join(directory, 'full', '%06d.png'),
          '-map', '[thumb]', '-fps_mode', 'passthrough', '-q:v', '4', '-start_number', '1', path.join(directory, 'thumb', '%06d.jpg'),
          '-progress', 'pipe:1', '-stats_period', '0.15',
        ], signal, chunk => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('frame=')) lastFrame = Number(line.slice(6)) || lastFrame;
            if (line.startsWith('out_time_us=')) {
              const elapsed = Number(line.slice(12)) / 1_000_000;
              this.progress({ kind: 'import', fraction: duration > 0 ? Math.max(0, Math.min(0.99, elapsed / duration)) : 0, message: `Extracting frames · ${lastFrame.toLocaleString()} decoded` });
            }
          }
        });
        if (signal.aborted) throw new Error('Cancelled.');
        const frames = (await readdir(path.join(directory, 'full'))).filter(file => /^\d{6,}\.png$/.test(file)).sort();
        const thumbs = (await readdir(path.join(directory, 'thumb'))).filter(file => /^\d{6,}\.jpg$/.test(file));
        if (!frames.length || thumbs.length !== frames.length) throw new Error('Could not extract a complete set of frames.');
        const header = await readFile(path.join(directory, 'full', frames[0]));
        const clip: Clip = {
          id: randomUUID(), name: path.basename(source), width: header.readUInt32BE(16), height: header.readUInt32BE(20),
          frameCount: frames.length, sourceFps, duration,
        };
        const previous = this.session;
        this.session = { clip, directory };
        if (previous) await rm(previous.directory, { recursive: true, force: true }).catch(() => {});
        this.progress({ kind: 'import', fraction: 1, message: `${frames.length.toLocaleString()} frames ready` });
        return clip;
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
    });
  }

  framePath(id: string, kind: string, frame: number): string | null {
    if (!this.session || id !== this.session.clip.id || !['full', 'thumb'].includes(kind) || !Number.isInteger(frame) || frame < 1 || frame > this.session.clip.frameCount) return null;
    return path.join(this.session.directory, kind, `${String(frame).padStart(6, '0')}.${kind === 'full' ? 'png' : 'jpg'}`);
  }

  async exportClip(request: ExportRequest, parent: string): Promise<ExportResult> {
    return this.job(async signal => {
      if (!this.session || request.clipId !== this.session.clip.id) throw new Error('This video is no longer open.');
      const name = validateFolderName(request.name);
      const frames = validateExportFrames(request.frames, this.session.clip.frameCount);
      let folder = '';
      for (let suffix = 1; suffix <= 10_000; suffix++) {
        const candidate = path.join(parent, suffix === 1 ? name : `${name}-${suffix}`);
        try { await mkdir(candidate); folder = candidate; break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
      if (!folder) throw new Error('Could not find an unused export folder name.');
      try {
        for (let i = 0; i < frames.length; i++) {
          if (signal.aborted) throw new Error('Cancelled.');
          const source = this.framePath(request.clipId, 'full', frames[i]);
          if (!source) throw new Error('The selected frame is unavailable.');
          await copyFile(source, path.join(folder, `frame_${String(i + 1).padStart(4, '0')}.png`), constants.COPYFILE_EXCL);
          this.progress({ kind: 'export', fraction: (i + 1) / frames.length, message: `Exporting PNGs · ${i + 1} of ${frames.length}` });
        }
        if (signal.aborted) throw new Error('Cancelled.');
        return { folder, count: frames.length };
      } catch (error) {
        await rm(folder, { recursive: true, force: true });
        throw error;
      }
    });
  }

  async dispose(): Promise<void> {
    this.cancel();
    await this.operationDone;
    if (this.session) await rm(this.session.directory, { recursive: true, force: true });
    this.session = null;
  }
}
