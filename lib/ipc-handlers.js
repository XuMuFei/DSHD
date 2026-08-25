// ── IPC handler registration ──────────────────────────────────────────────

const { app, ipcMain, dialog } = require('electron');
const { WEB_URL, WEB_ENDPOINT } = require('./constants');
const state = require('./state');
const { sendStatus, clearLogBuffer } = require('./utils');
const { preferredSourceDir, preferredDefaultCloneDir, defaultCloneDir, cloneHarness, inspectSource, saveSourceDir } = require('./source-manager');
const { runPnpm, startPreparedWebService } = require('./process-manager');
const { checkForUpdates, applyUpdate } = require('./git-updater');
const { BUILD_RECORD_PATH, PHASE, PROGRESS } = require('./constants');

// ── Operation lock ────────────────────────────────────────────────────────

async function withOperation(name, operation) {
    if (state.activeOperation) throw new Error(`正在执行"${state.activeOperation}"，请稍候。`);
    state.activeOperation = name;
    try {
        return await operation();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendStatus(PHASE.ERROR, message);
        throw error;
    } finally {
        state.activeOperation = undefined;
    }
}

// ── Prepare and start pipeline ────────────────────────────────────────────

async function prepareAndStart(selectedSourceDir) {
    clearLogBuffer();
    sendStatus(PHASE.PREPARING, '正在检查依赖和构建状态', PROGRESS.PREPARE);

    const inspection = await inspectSource(selectedSourceDir);
    if (!inspection.valid) throw new Error(inspection.error);
    state.sourceDir = inspection.sourceDir;
    saveSourceDir(state.sourceDir);

    if (!inspection.ready) {
        sendStatus(PHASE.INSTALLING, '正在执行 pnpm install', PROGRESS.INSTALL);
        await runPnpm(['install'], state.sourceDir);

        sendStatus(PHASE.BUILDING, '正在执行 pnpm run build', PROGRESS.BUILD);
        await runPnpm(['run', 'build'], state.sourceDir);

        const completed = await inspectSource(state.sourceDir);
        if (!completed.hasCurrentBuild) {
            throw new Error(`构建完成，但 ${BUILD_RECORD_PATH} 与实际产物不一致。`);
        }
    }

    await startPreparedWebService(state.sourceDir);
    return { url: WEB_URL, sourceDir: state.sourceDir, built: !inspection.ready };
}

// ── Register handlers ────────────────────────────────────────────────────

function registerIpcHandlers() {
    ipcMain.handle('desktop:get-info', () => ({
        version: app.getVersion(),
        host: WEB_ENDPOINT.hostname,
        port: WEB_ENDPOINT.port,
        url: WEB_URL
    }));

    ipcMain.handle('desktop:get-logs', () => state.commandLogs);

    ipcMain.handle('desktop:clear-logs', () => {
        clearLogBuffer();
        return [];
    });

    ipcMain.handle('desktop:get-state', async () => {
        const candidate = preferredSourceDir();
        if (candidate) return inspectSource(candidate);

        // Check if default clone dir exists and is valid
        const defaultCandidate = preferredDefaultCloneDir();
        if (defaultCandidate) {
            state.sourceDir = defaultCandidate;
            saveSourceDir(defaultCandidate);
            return inspectSource(defaultCandidate);
        }

        return {
            valid: false,
            sourceDir: '',
            needsClone: true,
            cloneDir: defaultCloneDir()
        };
    });

    ipcMain.handle('desktop:select-source', async () => {
        const result = await dialog.showOpenDialog(state.mainWindow, {
            title: '选择 deepseek-harness 源码目录',
            defaultPath: state.sourceDir || preferredSourceDir() || undefined,
            properties: ['openDirectory']
        });
        if (result.canceled || result.filePaths.length === 0) return { canceled: true };
        const inspection = await inspectSource(result.filePaths[0]);
        if (inspection.valid) {
            state.sourceDir = inspection.sourceDir;
            saveSourceDir(state.sourceDir);
        }
        return inspection;
    });

    ipcMain.handle('desktop:clone-source', async () => {
        clearLogBuffer();
        sendStatus(PHASE.CLONING, '正在克隆 deepseek-harness 源码仓库', 10);
        try {
            const clonedDir = await cloneHarness();
            state.sourceDir = clonedDir;
            sendStatus(PHASE.PREPARING, '克隆完成，正在验证', 95);
            const inspection = await inspectSource(clonedDir);
            return inspection;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendStatus(PHASE.ERROR, message);
            throw error;
        }
    });

    ipcMain.handle('desktop:start', (_event, selectedSourceDir) =>
        withOperation('启动服务', () => prepareAndStart(selectedSourceDir)));

    ipcMain.handle('desktop:check-update', () =>
        withOperation('检查更新', checkForUpdates));

    ipcMain.handle('desktop:apply-update', () =>
        withOperation('应用更新', applyUpdate));
}

module.exports = { registerIpcHandlers };