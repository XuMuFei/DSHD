// ── Shared mutable state ──────────────────────────────────────────────────

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;

/** @type {string} */
let sourceDir = '';

/** @type {import('node:child_process').ChildProcess | null} */
let webProcess = null;

/** @type {import('node:child_process').ChildProcess | null} */
let activeCommandProcess = null;

/** @type {Set<import('node:child_process').ChildProcess>} */
let activeProcesses = new Set();

/** @type {string | undefined} */
let webProcessSourceDir = undefined;

/** @type {boolean} */
let webProcessOwned = false;

/** @type {string | null} */
let activeOperation = null;

/** @type {object | null} */
let pendingUpdate = null;

/** @type {boolean} */
let expectedWebStop = false;

/** @type {string | undefined} */
let webExitMessage = undefined;

/** @type {boolean} */
let quitting = false;

/** @type {boolean} */
let cleanupComplete = false;

/** @type {boolean} */
let cleanupStarted = false;

/** @type {string[]} */
let commandLogs = [];

/** @type {number} */
let webRestartAttempts = 0;

/** @type {string | undefined} */
let cachedCommit = undefined;

/** @type {string | undefined} */
let cachedSourceDir = undefined;

// ── Setters ───────────────────────────────────────────────────────────────

function reset() {
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

module.exports = {
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

    reset
};
