// ── Utility functions ─────────────────────────────────────────────────────

import { MAX_LOG_LINES } from './constants';
import { state } from './state';

// ── Log throttling ───────────────────────────────────────────────────────

let logThrottleTimer: NodeJS.Immediate | null = null;

function sendLogs(): void {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
    state.mainWindow.webContents.send('desktop:logs', state.commandLogs);
}

function scheduleLogFlush(): void {
    if (logThrottleTimer) return;
    logThrottleTimer = setImmediate(() => {
        logThrottleTimer = null;
        sendLogs();
    });
}

// ── Status ────────────────────────────────────────────────────────────────

export function sendStatus(
    phase: string,
    message: string,
    progress: number | null = null
): void {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
    state.mainWindow.webContents.send('desktop:status', { phase, message, progress });
}

// ── Logging ───────────────────────────────────────────────────────────────

export function appendLog(kind: string, text: string): void {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const lines = String(text).replaceAll('\r', '').split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        state.commandLogs.push(`[${timestamp}] ${kind} ${line}`);
    }
    if (state.commandLogs.length > MAX_LOG_LINES) {
        state.commandLogs = state.commandLogs.slice(-MAX_LOG_LINES);
    }
    scheduleLogFlush();
}

export function clearLogBuffer(): void {
    state.commandLogs = [];
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        sendLogs();
    }
}

// ── Command formatting ────────────────────────────────────────────────────

export function formatCommand(file: string, args: readonly string[]): string {
    return [file, ...args]
        .map((value) => /\s/u.test(value) ? `"${value}"` : value)
        .join(' ');
}

// ── Error message extraction ──────────────────────────────────────────────

export function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message.replace(/^Error invoking remote method '[^']+': /, '');
    }
    return String(error);
}
