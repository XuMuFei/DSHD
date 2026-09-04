// ── Preload script ────────────────────────────────────────────────────────

import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('desktopApi', {
    getInfo: () => ipcRenderer.invoke('desktop:get-info'),
    getLogs: () => ipcRenderer.invoke('desktop:get-logs'),
    clearLogs: () => ipcRenderer.invoke('desktop:clear-logs'),
    getState: () => ipcRenderer.invoke('desktop:get-state'),
    selectSource: () => ipcRenderer.invoke('desktop:select-source'),
    cloneSource: () => ipcRenderer.invoke('desktop:clone-source'),
    start: (sourceDir: string) => ipcRenderer.invoke('desktop:start', sourceDir),
    restartService: () => ipcRenderer.invoke('desktop:restart-service'),
    checkForUpdate: () => ipcRenderer.invoke('desktop:check-update'),
    applyUpdate: () => ipcRenderer.invoke('desktop:apply-update'),

    // Event listeners
    onStatus: (callback: (status: { phase: string; message: string; progress: number | null }) => void) => {
        const handler = (_event: unknown, status: { phase: string; message: string; progress: number | null }) => callback(status);
        ipcRenderer.on('desktop:status', handler);
        return () => ipcRenderer.removeListener('desktop:status', handler);
    },
    onLogs: (callback: (logs: string[]) => void) => {
        const handler = (_event: unknown, logs: string[]) => callback(logs);
        ipcRenderer.on('desktop:logs', handler);
        return () => ipcRenderer.removeListener('desktop:logs', handler);
    }
});
