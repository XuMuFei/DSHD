// ── Renderer process — UI logic ───────────────────────────────────────────

// ── DOM helpers ───────────────────────────────────────────────────────────

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const $$ = (sel: string): NodeListOf<HTMLElement> => document.querySelectorAll(sel);

// ── DOM refs ──────────────────────────────────────────────────────────────

const setupView = $('setup-view');
const workspaceView = $('workspace-view');
const sourcePath = $('source-path') as HTMLInputElement;
const chooseSource = $('choose-source') as HTMLButtonElement;
const startService = $('start-service') as HTMLButtonElement;
const dependencyState = $('dependency-state');
const buildState = $('build-state');
const startupStatus = $('startup-status');
const startupMessage = $('startup-message');
const startupProgress = $('startup-progress');
const progressPercent = $('progress-percent');
const progressFill = $('progress-fill');
const progressPhase = $('progress-phase');
const setupShowLogs = $('setup-show-logs') as HTMLButtonElement;
const activeSource = $('active-source');
const serviceStatus = $('service-status');
const serviceMessage = $('service-message');
const checkUpdate = $('check-update') as HTMLButtonElement;
const workspaceShowLogs = $('workspace-show-logs') as HTMLButtonElement;
const webContent = $('web-content') as HTMLIFrameElement;
const serviceOverlay = $('service-overlay');
const overlayMessage = $('overlay-message');
const updateDialog = $('update-dialog');
const updateSummary = $('update-summary');
const currentCommit = $('current-commit');
const latestCommit = $('latest-commit');
const closeUpdate = $('close-update') as HTMLButtonElement;
const cancelUpdate = $('cancel-update') as HTMLButtonElement;
const applyUpdateBtn = $('apply-update') as HTMLButtonElement;
const toast = $('toast');
const logDrawer = $('log-drawer');
const logScrim = $('log-scrim');
const closeLogs = $('close-logs') as HTMLButtonElement;
const clearLogs = $('clear-logs') as HTMLButtonElement;
const commandLog = $('command-log');
const logCount = $('log-count');
const versionFields = $$('[data-role="client-version"]');
const endpointFields = $$('[data-role="endpoint"]');
const endpointChips = $$('.endpoint-chip');

// ── State ─────────────────────────────────────────────────────────────────

let selectedSourceDir = '';
let toastTimer: ReturnType<typeof setTimeout>;
let serviceReady = false;

// ── Cleanup registrations ─────────────────────────────────────────────────

const cleanupFns: (() => void)[] = [];

// ── Error message extraction ──────────────────────────────────────────────

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message.replace(/^Error invoking remote method '[^']+': /, '');
    return String(error);
}

// ── UI helpers ────────────────────────────────────────────────────────────

function setCheck(element: HTMLElement, state: string, text: string): void {
    element.dataset.state = state;
    element.textContent = text;
}

function renderInspection(inspection: SourceInspection | undefined): void {
    if (!inspection?.valid) {
        selectedSourceDir = '';
        sourcePath.value = inspection?.sourceDir || '';
        setCheck(dependencyState, 'idle', '等待检测');
        setCheck(buildState, 'idle', '等待检测');
        startupMessage.textContent = inspection?.error || '请选择源码目录';
        startService.disabled = true;
        return;
    }
    selectedSourceDir = inspection.sourceDir ?? '';
    sourcePath.value = inspection.sourceDir ?? '';
    setCheck(
        dependencyState,
        inspection.hasDependencies ? 'ready' : 'missing',
        inspection.hasDependencies ? '依赖就绪' : '需要安装'
    );
    const buildText = inspection.hasCurrentBuild
        ? `构建有效 · ${inspection.artifactCount} 个产物`
        : '需要构建';
    setCheck(buildState, inspection.hasCurrentBuild ? 'ready' : 'missing', buildText);
    startupMessage.textContent = inspection.ready
        ? '可直接启动 Web 服务'
        : '启动时将安装依赖并构建';
    startService.disabled = false;
}

function setBusy(busy: boolean): void {
    chooseSource.disabled = busy;
    startService.disabled = busy || !selectedSourceDir;
    startupStatus.dataset.active = String(busy);
    if (busy) startupProgress.hidden = false;
}

function setProgress(progress: number | null, message?: string): void {
    if (typeof progress === 'number') {
        const value = Math.max(0, Math.min(100, Math.round(progress)));
        progressFill.style.width = `${value}%`;
        progressPercent.textContent = `${value}%`;
    }
    if (message) progressPhase.textContent = message;
}

function showToast(message: string, kind: 'success' | 'error' = 'success'): void {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.kind = kind;
    toast.hidden = false;
    toastTimer = setTimeout(() => {
        toast.hidden = true;
    }, 4200);
}

function showWorkspace(result: { url: string; sourceDir: string }): void {
    serviceReady = true;
    setupView.hidden = true;
    workspaceView.hidden = false;
    activeSource.textContent = result.sourceDir;
    activeSource.title = result.sourceDir;
    webContent.src = result.url;
}

function updateStatus(status: IpcStatusPayload): void {
    startupMessage.textContent = status.message;
    serviceMessage.textContent = status.message;
    serviceStatus.dataset.phase = status.phase;
    endpointChips.forEach((chip) => {
        chip.dataset.phase = status.phase;
    });
    setProgress(status.progress, status.message);
    const busy = ['preparing', 'updating', 'installing', 'building', 'starting'].includes(status.phase);
    if (!serviceReady && (busy || status.phase === 'error')) startupProgress.hidden = false;
    if (serviceReady) {
        serviceOverlay.hidden = !['updating', 'installing', 'building', 'starting'].includes(status.phase);
        overlayMessage.textContent = status.message;
        checkUpdate.disabled = busy || status.phase === 'checking';
    }
}

function renderLogs(logs: string[]): void {
    const entries = Array.isArray(logs) ? logs : [];
    commandLog.textContent = entries.length ? entries.join('\n') : '等待命令输出...';
    logCount.textContent = `${entries.length} 条记录`;
    requestAnimationFrame(() => {
        commandLog.scrollTop = commandLog.scrollHeight;
    });
}

function showLogs(): void {
    logDrawer.hidden = false;
    logScrim.hidden = false;
    void window.desktopApi.getLogs().then(renderLogs);
}

function hideLogs(): void {
    logDrawer.hidden = true;
    logScrim.hidden = true;
}

// ── Data loading ──────────────────────────────────────────────────────────

async function loadInfo(): Promise<void> {
    const info = await window.desktopApi.getInfo();
    const endpoint = `${info.host}:${info.port}`;
    versionFields.forEach((field) => {
        field.textContent = `DSH Desktop · v${info.version}`;
    });
    endpointFields.forEach((field) => {
        field.textContent = endpoint;
        field.title = info.url;
    });
}

async function loadInitialState(): Promise<void> {
    try {
        renderInspection(await window.desktopApi.getState());
    } catch (error) {
        showToast(errorMessage(error), 'error');
    }
}

// ── Event listeners ───────────────────────────────────────────────────────

setupShowLogs.addEventListener('click', showLogs);
workspaceShowLogs.addEventListener('click', showLogs);
closeLogs.addEventListener('click', hideLogs);
logScrim.addEventListener('click', hideLogs);
clearLogs.addEventListener('click', async () => {
    await window.desktopApi.clearLogs();
    renderLogs([]);
});

chooseSource.addEventListener('click', async () => {
    try {
        const result = await window.desktopApi.selectSource();
        if (!('canceled' in result)) renderInspection(result);
    } catch (error) {
        showToast(errorMessage(error), 'error');
    }
});

startService.addEventListener('click', async () => {
    setBusy(true);
    try {
        const result = await window.desktopApi.start(selectedSourceDir);
        showWorkspace(result);
    } catch (error) {
        startupMessage.textContent = errorMessage(error);
        showToast(errorMessage(error), 'error');
    } finally {
        setBusy(false);
    }
});

checkUpdate.addEventListener('click', async () => {
    checkUpdate.disabled = true;
    try {
        const result = await window.desktopApi.checkForUpdate();
        if (!result.hasUpdate) {
            showToast(`当前已是最新版本 · ${result.currentCommit}`);
            return;
        }
        updateSummary.textContent = `${result.upstream} 领先当前版本 ${result.behind} 个提交。`;
        currentCommit.textContent = result.currentCommit;
        latestCommit.textContent = result.latestCommit;
        updateDialog.hidden = false;
    } catch (error) {
        showToast(errorMessage(error), 'error');
    } finally {
        checkUpdate.disabled = false;
    }
});

function hideUpdateDialog(): void {
    updateDialog.hidden = true;
}

closeUpdate.addEventListener('click', hideUpdateDialog);
cancelUpdate.addEventListener('click', hideUpdateDialog);
updateDialog.addEventListener('click', (event) => {
    if (event.target === updateDialog) hideUpdateDialog();
});

applyUpdateBtn.addEventListener('click', async () => {
    hideUpdateDialog();
    serviceOverlay.hidden = false;
    checkUpdate.disabled = true;
    try {
        const result = await window.desktopApi.applyUpdate();
        // HTMLIFrameElement has no reload() - reload by re-setting src
        webContent.src = result.url;
        showToast('更新完成，服务已重新启动');
    } catch (error) {
        showToast(errorMessage(error), 'error');
    } finally {
        serviceOverlay.hidden = true;
        checkUpdate.disabled = false;
    }
});

// ── IPC listener registration with cleanup ───────────────────────────────

const unsubStatus = window.desktopApi.onStatus(updateStatus);
const unsubLogs = window.desktopApi.onLogs(renderLogs);
cleanupFns.push(unsubStatus, unsubLogs);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    for (const fn of cleanupFns) {
        if (typeof fn === 'function') fn();
    }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────

void loadInfo().catch((error) => showToast(errorMessage(error), 'error'));
void window.desktopApi.getLogs().then(renderLogs).catch((error) => showToast(errorMessage(error), 'error'));
void loadInitialState();
