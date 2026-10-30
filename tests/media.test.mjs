import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MediaService, findBinaries, runProcess } from '../dist-main/electron/media.js';

let root;
let binaries;
let fixture;
before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'stride-tests-'));
  const status = await findBinaries();
  assert.ok(status.ready, 'Install Homebrew FFmpeg before running integration tests.');
  binaries = { ffmpeg: status.ffmpeg, ffprobe: status.ffprobe };
  fixture = path.join(root, 'test clip $(literal).mp4');
  await runProcess(binaries.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x128:rate=12:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fixture]);
});
after(async () => { if (root) await rm(root, { recursive: true, force: true }); });

test('decoded frame count, exact PNG exports, conflicts, and cache cleanup', async () => {
  const events = [];
  const service = new MediaService(path.join(root, 'cache-1'), binaries, event => events.push(event));
  try {
    const clip = await service.importClip(fixture);
    assert.equal(clip.frameCount, 12);
    assert.equal(clip.width, 96);
    assert.equal(clip.height, 128);
    assert.equal(clip.sourceFps, 12);
    assert.equal(service.framePath('wrong', 'full', 1), null);
    assert.equal(service.framePath(clip.id, '../full', 1), null);
    assert.equal(service.framePath(clip.id, 'full', 13), null);
    const parent = path.join(root, 'exports');
    await mkdir(parent);
    const request = { clipId: clip.id, frames: [12, 1, 5], name: 'walk_front' };
    const exported = await service.exportClip(request, parent);
    assert.equal(exported.count, 3);
    const files = await readdir(exported.folder);
    assert.deepEqual(files, ['frame_0001.png', 'frame_0002.png', 'frame_0003.png']);
    for (const [index, frame] of [1, 5, 12].entries()) {
      assert.deepEqual(await readFile(path.join(exported.folder, files[index])), await readFile(service.framePath(clip.id, 'full', frame)));
    }
    const second = await service.exportClip(request, parent);
    assert.equal(path.basename(second.folder), 'walk_front-2');
    assert.ok(events.some(event => event.kind === 'import' && event.fraction === 1));
    assert.ok(events.some(event => event.kind === 'export' && event.fraction === 1));
    await assert.rejects(service.exportClip({ ...request, clipId: 'wrong' }, parent), /no longer open/);
    await assert.rejects(service.exportClip({ ...request, frames: [0] }, parent), /invalid frame/);
    await assert.rejects(service.exportClip(request, path.join(root, 'missing', 'parent')), /ENOENT/);
  } finally { await service.dispose(); }
  assert.deepEqual(await readdir(path.join(root, 'cache-1')), []);
});

test('failed import preserves the open clip; successful replacement removes its cache', async () => {
  const service = new MediaService(path.join(root, 'cache-2'), binaries);
  try {
    const first = await service.importClip(fixture);
    const oldPath = service.framePath(first.id, 'full', 1);
    const bad = path.join(root, 'broken.mp4');
    await writeFile(bad, 'not a video');
    await assert.rejects(service.importClip(bad));
    assert.equal(service.clip.id, first.id);
    await readFile(oldPath);
    const second = await service.importClip(fixture);
    assert.notEqual(first.id, second.id);
    await assert.rejects(readFile(oldPath), /ENOENT/);
  } finally { await service.dispose(); }
});

test('import cancellation removes incomplete frames', async () => {
  let service;
  service = new MediaService(path.join(root, 'cache-3'), binaries, event => {
    if (event.kind === 'import' && event.message.startsWith('Extracting')) service.cancel();
  });
  try {
    await assert.rejects(service.importClip(fixture), /Cancelled/);
    assert.equal(service.clip, null);
    assert.equal(service.busy, false);
    assert.deepEqual(await readdir(path.join(root, 'cache-3')), []);
  } finally { await service.dispose(); }
});

test('export cancellation removes only its newly created folder', async () => {
  let shouldCancel = false;
  let service;
  service = new MediaService(path.join(root, 'cache-4'), binaries, event => {
    if (shouldCancel && event.kind === 'export') service.cancel();
  });
  try {
    const clip = await service.importClip(fixture);
    const parent = path.join(root, 'cancel-exports');
    await mkdir(parent);
    await mkdir(path.join(parent, 'walk'));
    shouldCancel = true;
    await assert.rejects(service.exportClip({ clipId: clip.id, frames: [1, 2, 3], name: 'walk' }, parent), /Cancelled/);
    assert.deepEqual(await readdir(parent), ['walk']);
  } finally { await service.dispose(); }
});

test('variable-rate MP4 preserves each decoded frame without resampling', async () => {
  const variable = path.join(root, 'variable.mp4');
  await runProcess(binaries.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x128:rate=12:duration=2', '-vf', "select='if(lt(n,12),1,not(mod(n,3)))'", '-fps_mode', 'vfr', '-c:v', 'libx264', variable]);
  const probe = JSON.parse(await runProcess(binaries.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'json', variable]));
  const service = new MediaService(path.join(root, 'cache-5'), binaries);
  try {
    const clip = await service.importClip(variable);
    assert.equal(clip.frameCount, Number(probe.streams[0].nb_read_frames));
    assert.equal(clip.frameCount, 16);
    const reference = path.join(root, 'vfr-reference');
    await mkdir(reference);
    await runProcess(binaries.ffmpeg, ['-v', 'error', '-i', variable, '-map', '0:v:0', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', path.join(reference, '%06d.png')]);
    for (let i = 1; i <= clip.frameCount; i++) assert.deepEqual(await readFile(service.framePath(clip.id, 'full', i)), await readFile(path.join(reference, `${String(i).padStart(6, '0')}.png`)));
  } finally { await service.dispose(); }
});

test('subprocess cancellation and timeouts terminate cleanly', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runProcess(binaries.ffprobe, ['-version'], controller.signal), /Cancelled/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], undefined, undefined, 40), /too long/);
});

test('video rotation is reflected in the full-resolution export canvas', async () => {
  const rotated = path.join(root, 'rotated.mp4');
  await runProcess(binaries.ffmpeg, ['-v', 'error', '-display_rotation', '90', '-i', fixture, '-c', 'copy', rotated]);
  const service = new MediaService(path.join(root, 'cache-rotated'), binaries);
  try {
    const clip = await service.importClip(rotated);
    assert.equal(clip.width, 128);
    assert.equal(clip.height, 96);
    assert.equal(clip.frameCount, 12);
  } finally { await service.dispose(); }
});

test('an audio-only MP4 reports a useful error without opening a clip', async () => {
  const audio = path.join(root, 'audio-only.mp4');
  await runProcess(binaries.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0.1', '-c:a', 'aac', audio]);
  const service = new MediaService(path.join(root, 'cache-audio'), binaries);
  try {
    await assert.rejects(service.importClip(audio), /no readable video stream/);
    assert.equal(service.clip, null);
  } finally { await service.dispose(); }
});
