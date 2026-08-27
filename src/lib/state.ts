// ── Shared mutable state ──────────────────────────────────────────────────

import type { BrowserWindow } from 'electron';
import type { ChildProcess } from 'node:child_process';
import type { AppState, PendingUpdate } from './types';

// ── Internal state variables ──────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let sourceDir = '';
let webProcess: ChildProcess | null = null;
let activeCommandProcess: ChildProcess | null = null;
let activeProcesses = new Set<ChildProcess>();
let webProcessSourceDir: string | undefined = undefined;
let webProcessOwned = false;
let activeOperation: string | null = null;
let pendingUpdate: PendingUpdate | null = null;
let expectedWebStop = false;
let webExitMessage: string | undefined = undefined;
let quitting = false;
let cleanupComplete = false;
let cleanupStarted = false;
let commandLogs: string[] = [];
let webRestartAttempts = 0;
let cachedCommit: string | undefined = undefined;
let cachedSourceDir: string | undefined = undefined;

// ── Reset function ────────────────────────────────────────────────────────

function reset(): void {
    mainWindow = null;
    sourceDir = '';
    webProcess = null;
    activeCommandProcess = null;
    activeProcesses = new Set();
    webProcessSourceDir = undefined;
    webProcessOwned = false;
    activeOperation = null;
    pendingUpdate = null;
    expectedWebStop = false;
    webExitMessage = undefined;
    quitting = false;
    cleanupComplete = false;
    cleanupStarted = false;
    commandLogs = [];
    webRestartAttempts = 0;
    cachedCommit = undefined;
    cachedSourceDir = undefined;
}

// ── State accessor object ─────────────────────────────────────────────────

export const state: AppState = {
    get mainWindow() { return mainWindow; },
    set mainWindow(v) { mainWindow = v; },

    get sourceDir() { return sourceDir; },
    set sourceDir(v) { sourceDir = v; },

    get webProcess() { return webProcess; },
    set webProcess(v) { webProcess = v; },

    get activeCommandProcess() { return activeCommandProcess; },
    set activeCommandProcess(v) { activeCommandProcess = v; },

    get activeProcesses() { return activeProcesses; },

    get webProcessSourceDir() { return webProcessSourceDir; },
    set webProcessSourceDir(v) { webProcessSourceDir = v; },

    get webProcessOwned() { return webProcessOwned; },
    set webProcessOwned(v) { webProcessOwned = v; },

    get activeOperation() { return activeOperation; },
    set activeOperation(v) { activeOperation = v; },

    get pendingUpdate() { return pendingUpdate; },
    set pendingUpdate(v) { pendingUpdate = v; },

    get expectedWebStop() { return expectedWebStop; },
    set expectedWebStop(v) { expectedWebStop = v; },

    get webExitMessage() { return webExitMessage; },
    set webExitMessage(v) { webExitMessage = v; },

    get quitting() { return quitting; },
    set quitting(v) { quitting = v; },

    get cleanupComplete() { return cleanupComplete; },
    set cleanupComplete(v) { cleanupComplete = v; },

    get cleanupStarted() { return cleanupStarted; },
    set cleanupStarted(v) { cleanupStarted = v; },

    get commandLogs() { return commandLogs; },
    set commandLogs(v) { commandLogs = v; },

    get webRestartAttempts() { return webRestartAttempts; },
    set webRestartAttempts(v) { webRestartAttempts = v; },

    get cachedCommit() { return cachedCommit; },
    set cachedCommit(v) { cachedCommit = v; },

    get cachedSourceDir() { return cachedSourceDir; },
    set cachedSourceDir(v) { cachedSourceDir = v; },
};

export { reset };
