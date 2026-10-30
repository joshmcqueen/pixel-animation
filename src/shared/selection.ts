export function selectedFrames(start: number, end: number, excluded: ReadonlySet<number>): number[] {
  const frames: number[] = [];
  for (let frame = start; frame <= end; frame++) {
    if (!excluded.has(frame)) frames.push(frame);
  }
  return frames;
}

export function sampleRange(excluded: ReadonlySet<number>, start: number, end: number, every: number): Set<number> {
  if (!Number.isInteger(every) || every < 1) throw new Error('Frame interval must be a positive integer.');
  const next = new Set(excluded);
  for (let frame = start; frame <= end; frame++) {
    if ((frame - start) % every === 0) next.delete(frame);
    else next.add(frame);
  }
  return next;
}

export function validateExportFrames(frames: unknown, frameCount: number): number[] {
  if (!Array.isArray(frames) || frames.length === 0 || frames.length > frameCount) {
    throw new Error('Choose at least one frame to export.');
  }
  if (frames.some(frame => !Number.isInteger(frame) || frame < 1 || frame > frameCount)) {
    throw new Error('The export contains an invalid frame.');
  }
  return [...new Set(frames as number[])].sort((a, b) => a - b);
}

export function validateFolderName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\\/:\x00-\x1f]/.test(name) || /^\.+$/.test(name.trim())) {
    throw new Error('Use a folder name of 1–80 characters, without slashes or colons.');
  }
  return name.trim();
}
