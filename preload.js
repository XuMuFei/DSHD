const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
    getInfo: () => ipcRenderer.invoke('desktop:get-info'),
    getLogs: () => ipcRenderer.invoke('desktop:get-logs'),
    clearLogs: () => ipcRenderer.invoke('desktop:clear-logs'),
    getState: () => ipcRenderer.invoke('desktop:get-state'),
    selectSource: () => ipcRenderer.invoke('desktop:select-source'),
    start: (sourceDir) => ipcRenderer.invoke('desktop:start', sourceDir),
    checkForUpdate: () => ipcRenderer.invoke('desktop:check-update'),
    applyUpdate: () => ipcRenderer.invoke('desktop:apply-update'),
    onLogs: (callback) => {
        const listener = (_event, logs) => callback(logs);
        ipcRenderer.on('desktop:logs', listener);
        return () => ipcRenderer.removeListener('desktop:logs', listener);
    },
    onStatus: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('desktop:status', listener);
        return () => ipcRenderer.removeListener('desktop:status', listener);
    }
});
