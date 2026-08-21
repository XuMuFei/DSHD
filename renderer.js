const setupView = document.getElementById('setup-view');
const workspaceView = document.getElementById('workspace-view');
const sourcePath = document.getElementById('source-path');
const chooseSource = document.getElementById('choose-source');
const startService = document.getElementById('start-service');
const dependencyState = document.getElementById('dependency-state');
const buildState = document.getElementById('build-state');
const startupStatus = document.getElementById('startup-status');
const startupMessage = document.getElementById('startup-message');
const startupProgress = document.getElementById('startup-progress');
const progressPercent = document.getElementById('progress-percent');
const progressFill = document.getElementById('progress-fill');
const progressPhase = document.getElementById('progress-phase');
const setupShowLogs = document.getElementById('setup-show-logs');
const activeSource = document.getElementById('active-source');
const serviceStatus = document.getElementById('service-status');
const serviceMessage = document.getElementById('service-message');
const checkUpdate = document.getElementById('check-update');
const workspaceShowLogs = document.getElementById('workspace-show-logs');
const webContent = document.getElementById('web-content');
const serviceOverlay = document.getElementById('service-overlay');
const overlayMessage = document.getElementById('overlay-message');
const updateDialog = document.getElementById('update-dialog');
const updateSummary = document.getElementById('update-summary');
const currentCommit = document.getElementById('current-commit');
const latestCommit = document.getElementById('latest-commit');
const closeUpdate = document.getElementById('close-update');
const cancelUpdate = document.getElementById('cancel-update');
const applyUpdate = document.getElementById('apply-update');
const toast = document.getElementById('toast');
const logDrawer = document.getElementById('log-drawer');
const logScrim = document.getElementById('log-scrim');
const closeLogs = document.getElementById('close-logs');
const clearLogs = document.getElementById('clear-logs');
const commandLog = document.getElementById('command-log');
const logCount = document.getElementById('log-count');
const versionFields = document.querySelectorAll('[data-role="client-version"]');
const endpointFields = document.querySelectorAll('[data-role="endpoint"]');

let selectedSourceDir = '';
let toastTimer;
let serviceReady = false;

function errorMessage(error) {
    if (error instanceof Error) return error.message.replace(/^Error invoking remote method '[^']+': /, '');
    return String(error);
}

function setCheck(element, state, text) {
    element.dataset.state = state;
    element.textContent = text;
}

function renderInspection(inspection) {
    if (!inspection?.valid) {
        selectedSourceDir = '';
        sourcePath.value = inspection?.sourceDir || '';
        setCheck(dependencyState, 'idle', '等待检测');
        setCheck(buildState, 'idle', '等待检测');
        startupMessage.textContent = inspection?.error || '请选择源码目录';
        startService.disabled = true;
        return;
    }
    selectedSourceDir = inspection.sourceDir;
    sourcePath.value = inspection.sourceDir;
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

function setBusy(busy) {
    chooseSource.disabled = busy;
    startService.disabled = busy || !selectedSourceDir;
    startupStatus.dataset.active = String(busy);
    if (busy) startupProgress.hidden = false;
}

function setProgress(progress, message) {
    if (typeof progress === 'number') {
        const value = Math.max(0, Math.min(100, Math.round(progress)));
        progressFill.style.width = `${value}%`;
        progressPercent.textContent = `${value}%`;
    }
    if (message) progressPhase.textContent = message;
}

function showToast(message, kind = 'success') {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.kind = kind;
    toast.hidden = false;
    toastTimer = setTimeout(() => {
        toast.hidden = true;
    }, 4200);
}

function showWorkspace(result) {
    serviceReady = true;
    setupView.hidden = true;
    workspaceView.hidden = false;
    activeSource.textContent = result.sourceDir;
    activeSource.title = result.sourceDir;
    webContent.src = result.url;
}

function updateStatus(status) {
    startupMessage.textContent = status.message;
    serviceMessage.textContent = status.message;
    serviceStatus.dataset.phase = status.phase;
    setProgress(status.progress, status.message);
    const busy = ['preparing', 'updating', 'installing', 'building', 'starting'].includes(status.phase);
    if (!serviceReady && (busy || status.phase === 'error')) startupProgress.hidden = false;
    if (serviceReady) {
        serviceOverlay.hidden = !['updating', 'installing', 'building', 'starting'].includes(status.phase);
        overlayMessage.textContent = status.message;
        checkUpdate.disabled = busy || status.phase === 'checking';
    }
}

function renderLogs(logs) {
    const entries = Array.isArray(logs) ? logs : [];
    commandLog.textContent = entries.length ? entries.join('\n') : '等待命令输出...';
    logCount.textContent = `${entries.length} 条记录`;
    requestAnimationFrame(() => {
        commandLog.scrollTop = commandLog.scrollHeight;
    });
}

function showLogs() {
    logDrawer.hidden = false;
    logScrim.hidden = false;
    void window.desktopApi.getLogs().then(renderLogs);
}

function hideLogs() {
    logDrawer.hidden = true;
    logScrim.hidden = true;
}

async function loadInfo() {
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

async function loadInitialState() {
    try {
        renderInspection(await window.desktopApi.getState());
    } catch (error) {
        showToast(errorMessage(error), 'error');
    }
}

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
        if (!result.canceled) renderInspection(result);
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

function hideUpdateDialog() {
    updateDialog.hidden = true;
}

closeUpdate.addEventListener('click', hideUpdateDialog);
cancelUpdate.addEventListener('click', hideUpdateDialog);
updateDialog.addEventListener('click', (event) => {
    if (event.target === updateDialog) hideUpdateDialog();
});

applyUpdate.addEventListener('click', async () => {
    hideUpdateDialog();
    serviceOverlay.hidden = false;
    checkUpdate.disabled = true;
    try {
        await window.desktopApi.applyUpdate();
        webContent.reload();
        showToast('更新完成，服务已重新启动');
    } catch (error) {
        showToast(errorMessage(error), 'error');
    } finally {
        serviceOverlay.hidden = true;
        checkUpdate.disabled = false;
    }
});

window.desktopApi.onStatus(updateStatus);
window.desktopApi.onLogs(renderLogs);
void loadInfo().catch((error) => showToast(errorMessage(error), 'error'));
void window.desktopApi.getLogs().then(renderLogs).catch((error) => showToast(errorMessage(error), 'error'));
void loadInitialState();
