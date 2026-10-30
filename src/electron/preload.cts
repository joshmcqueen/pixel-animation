import { contextBridge, ipcRenderer } from 'electron';
import type { ExportRequest, Progress, StrideAPI } from '../shared/types.js';

const api: StrideAPI = {
  dependencies: () => ipcRenderer.invoke('dependencies'),
  openVideo: () => ipcRenderer.invoke('open-video'),
  exportFrames: (request: ExportRequest) => ipcRenderer.invoke('export-frames', request),
  cancel: () => ipcRenderer.invoke('cancel-operation'),
  revealExport: () => ipcRenderer.invoke('reveal-export'),
  onProgress: callback => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Progress) => callback(progress);
    ipcRenderer.on('progress', listener);
    return () => { ipcRenderer.removeListener('progress', listener); };
  },
};
contextBridge.exposeInMainWorld('stride', api);
