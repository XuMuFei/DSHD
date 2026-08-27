// ── DSH Desktop — Electron main entry ─────────────────────────────────────

import path from 'node:path';
import { app, BrowserWindow, Tray, Menu, nativeImage, shell } from 'electron';
import type { NativeImage } from 'electron';

import { state } from './lib/state';
import { registerIpcHandlers } from './lib/ipc-handlers';
import { stopProcessTree, stopWebProcess } from './lib/process-manager';

// ── Tray icon ──────────────────────────────────────────────────────────────

let tray: Tray | null = null;

function createTrayIcon(): NativeImage {
    const iconPath = path.join(__dirname, 'build', 'icon.png');
    const image = nativeImage.createFromPath(iconPath);
    return image.resize({ width: 16, height: 16 });
}

function createTray(): void {
    const icon = createTrayIcon();
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示主窗口',
            click: () => {
                if (state.mainWindow) {
                    state.mainWindow.show();
                    state.mainWindow.focus();
                }
            }
        },
        {
            label: '退出',
            click: () => {
                performQuit();
            }
        }
    ]);

    tray.setToolTip('DSH Desktop');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
        if (state.mainWindow) {
            state.mainWindow.show();
            state.mainWindow.focus();
        }
    });

    tray.on('click', () => {
        if (state.mainWindow) {
            if (state.mainWindow.isVisible()) {
                state.mainWindow.hide();
            } else {
                state.mainWindow.show();
                state.mainWindow.focus();
            }
        }
    });
}

// ── Window creation ───────────────────────────────────────────────────────

function createWindow(): void {
    state.mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 680,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#eef0eb',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: true
        }
    });

    state.mainWindow.webContents.on('did-attach-webview', (_event, contents) => {
        contents.setWindowOpenHandler(({ url }) => {
            void shell.openExternal(url);
            return { action: 'deny' };
        });
    });

    state.mainWindow.once('ready-to-show', () => state.mainWindow?.show());
    void state.mainWindow.loadFile(path.join(__dirname, 'shell.html'));

    state.mainWindow.on('close', (event) => {
        if (!state.quitting) {
            event.preventDefault();
            state.mainWindow?.hide();
        }
    });

    state.mainWindow.on('closed', () => {
        state.mainWindow = null;
    });
}

// ── Quit with cleanup ──────────────────────────────────────────────────────

async function performQuit(): Promise<void> {
    if (state.cleanupComplete) {
        app.quit();
        return;
    }

    if (state.cleanupStarted) return;
    state.cleanupStarted = true;
    state.quitting = true;

    const processes = new Set(state.activeProcesses);
    if (state.activeCommandProcess) processes.add(state.activeCommandProcess);
    await Promise.all([
        ...Array.from(processes, proc => stopProcessTree(proc)),
        stopWebProcess()
    ]);

    state.cleanupComplete = true;

    if (tray) {
        tray.destroy();
        tray = null;
    }

    app.quit();
}

// ── Single instance lock ──────────────────────────────────────────────────

let hasSingleInstanceLock = false;
try {
    hasSingleInstanceLock = app.requestSingleInstanceLock();
    if (hasSingleInstanceLock) {
        app.on('second-instance', () => {
            if (state.mainWindow) {
                state.mainWindow.show();
                state.mainWindow.focus();
            }
        });
    }
} catch {
    hasSingleInstanceLock = false;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.whenReady().then(() => {
        registerIpcHandlers();
        createTray();
        createWindow();
    }).catch((error) => {
        console.error('[dshd] bootstrap error:', error);
    });
}

// ── App lifecycle ─────────────────────────────────────────────────────────

app.on('window-all-closed', () => {
    // Do nothing - app stays in tray
});

app.on('before-quit', (event) => {
    if (!hasSingleInstanceLock) return;
    if (!state.quitting) {
        event.preventDefault();
        void performQuit();
    }
});
