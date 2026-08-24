// ── Utility functions ─────────────────────────────────────────────────────

const { MAX_LOG_LINES } = require('./constants');
const state = require('./state');

// ── Log throttling ───────────────────────────────────────────────────────

let logThrottleTimer = null;

function sendLogs() {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
    state.mainWindow.webContents.send('desktop:logs', state.commandLogs);
}

function scheduleLogFlush() {
    if (logThrottleTimer) return;
    logThrottleTimer = setImmediate(() => {
        logThrottleTimer = null;
        sendLogs();
    });
}

// ── Status ────────────────────────────────────────────────────────────────

function sendStatus(phase, message, progress = null) {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
    state.mainWindow.webContents.send('desktop:status', { phase, message, progress });
}

// ── Logging ───────────────────────────────────────────────────────────────

function appendLog(kind, text) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const lines = String(text).replaceAll('\r', '').split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        state.commandLogs.push(`[${timestamp}] ${kind} ${line}`);
    }
    if (state.commandLogs.length > MAX_LOG_LINES) {
        state.commandLogs = state.commandLogs.slice(-MAX_LOG_LINES);
    }
    // Throttle: batch IPC sends instead of every line
    scheduleLogFlush();
}

function clearLogBuffer() {
    state.commandLogs = [];
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        sendLogs();
    }
}

// ── Command formatting ────────────────────────────────────────────────────

function formatCommand(file, args) {
    return [file, ...args].map((value) => /\s/u.test(value) ? `"${value}"` : value).join(' ');
}

// ── Error message extraction ──────────────────────────────────────────────

function errorMessage(error) {
    if (error instanceof Error) return error.message.replace(/^Error invoking remote method '[^']+': /, '');
    return String(error);
}

module.exports = {
    sendStatus,
    appendLog,
    clearLogBuffer,
    formatCommand,
    errorMessage
};