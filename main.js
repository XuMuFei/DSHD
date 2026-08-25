// ── DSH Desktop — Electron main entry ─────────────────────────────────────

const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');

const state = require('./lib/state');
const { registerIpcHandlers } = require('./lib/ipc-handlers');
const { stopProcessTree, stopWebProcess } = require('./lib/process-manager');

// ── Tray icon ──────────────────────────────────────────────────────────────

let tray = null;

function createTrayIcon() {
    // Use the icon.png for tray (16x16 or 32x32 for best display)
    const iconPath = path.join(__dirname, 'build', 'icon.png');
    const image = nativeImage.createFromPath(iconPath);
    // Resize for tray (Windows typically uses 16x16 or 32x32)
    return image.resize({ width: 16, height: 16 });
}

function createTray() {
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
                // This is a real quit request - stop service and quit
                performQuit();
            }
        }
    ]);
    
    tray.setToolTip('DSH Desktop');
    tray.setContextMenu(contextMenu);
    
    // Double-click tray icon to show window
    tray.on('double-click', () => {
        if (state.mainWindow) {
            state.mainWindow.show();
            state.mainWindow.focus();
        }
    });
    
    // Single click also shows window (common Windows behavior)
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

function createWindow() {
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

    state.mainWindow.once('ready-to-show', () => state.mainWindow.show());
    void state.mainWindow.loadFile(path.join(__dirname, 'shell.html'));

    // On close (X button), hide to tray instead of quitting
    state.mainWindow.on('close', (event) => {
        if (!state.quitting) {
            event.preventDefault();
            state.mainWindow.hide();
            return false;
        }
    });

    state.mainWindow.on('closed', () => {
        state.mainWindow = null;
    });
}

// ── Quit with cleanup ──────────────────────────────────────────────────────

async function performQuit() {
    if (state.cleanupComplete) {
        app.quit();
        return;
    }
    
    if (state.cleanupStarted) return;
    state.cleanupStarted = true;
    state.quitting = true;

    // Stop web service and every command process, including short-lived Git commands
    const processes = new Set(state.activeProcesses);
    if (state.activeCommandProcess) processes.add(state.activeCommandProcess);
    await Promise.all([
        ...Array.from(processes, process => stopProcessTree(process)),
        stopWebProcess()
    ]);

    state.cleanupComplete = true;
    
    // Destroy tray before quit
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
    // Lock unavailable - treat as not having the lock
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
    });
}

// ── App lifecycle ─────────────────────────────────────────────────────────

// Don't quit when all windows are closed (we're hiding to tray)
app.on('window-all-closed', () => {
    // Do nothing - app stays in tray
});

// Handle before-quit for cleanup (e.g., Cmd+Q on macOS or system shutdown)
app.on('before-quit', (event) => {
    if (!hasSingleInstanceLock) return;
    if (!state.quitting) {
        event.preventDefault();
        performQuit();
    }
});
