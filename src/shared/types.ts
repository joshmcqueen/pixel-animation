export interface Clip {
  id: string;
  name: string;
  width: number;
  height: number;
  frameCount: number;
  sourceFps: number;
  duration: number;
}

export interface Progress {
  kind: 'import' | 'export';
  fraction: number;
  message: string;
}

export interface DependencyStatus {
  ready: boolean;
  ffmpeg: string | null;
  ffprobe: string | null;
}

export interface ExportRequest {
  clipId: string;
  frames: number[];
  name: string;
}

export interface ExportResult {
  folder: string;
  count: number;
}

export interface StrideAPI {
  dependencies(): Promise<DependencyStatus>;
  openVideo(): Promise<Clip | null>;
  exportFrames(request: ExportRequest): Promise<ExportResult | null>;
  cancel(): Promise<void>;
  revealExport(): Promise<void>;
  onProgress(callback: (progress: Progress) => void): () => void;
}
