// ── IPC handler registration ──────────────────────────────────────────────

import { app, ipcMain, dialog } from 'electron';

import { WEB_URL, WEB_ENDPOINT, BUILD_RECORD_PATH, PHASE, PROGRESS } from './constants';
import { state } from './state';
import { sendStatus, clearLogBuffer } from './utils';
import { preferredSourceDir, inspectSource, saveSourceDir } from './source-manager';
import { runPnpm, startPreparedWebService } from './process-manager';
import { checkForUpdates, applyUpdate } from './git-updater';
import type { SourceInspection, IpcStartResponse, DesktopInfo } from './types';

// ── Operation lock ────────────────────────────────────────────────────────

async function withOperation<T>(name: string, operation: () => Promise<T>): Promise<T> {
    if (state.activeOperation) throw new Error(`正在执行"${state.activeOperation}"，请稍候。`);
    state.activeOperation = name;
    try {
        return await operation();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendStatus(PHASE.ERROR, message);
        throw error;
    } finally {
        state.activeOperation = null;
    }
}

// ── Prepare and start pipeline ────────────────────────────────────────────

async function prepareAndStart(selectedSourceDir: string): Promise<IpcStartResponse> {
    clearLogBuffer();
    sendStatus(PHASE.PREPARING, '正在检查依赖和构建状态', PROGRESS.PREPARE);

    const inspection = await inspectSource(selectedSourceDir);
    if (!inspection.valid || !inspection.sourceDir) throw new Error(inspection.error);
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

export function registerIpcHandlers(): void {
    ipcMain.handle('desktop:get-info', (): DesktopInfo => ({
        version: app.getVersion(),
        host: WEB_ENDPOINT.hostname,
        port: Number(WEB_ENDPOINT.port) || 3080,
        url: WEB_URL
    }));

    ipcMain.handle('desktop:get-logs', () => state.commandLogs);

    ipcMain.handle('desktop:clear-logs', () => {
        clearLogBuffer();
        return [];
    });

    ipcMain.handle('desktop:get-state', async (): Promise<SourceInspection> => {
        const candidate = preferredSourceDir();
        return candidate ? inspectSource(candidate) : { valid: false, sourceDir: '' };
    });

    ipcMain.handle('desktop:select-source', async (): Promise<SourceInspection | { canceled: true }> => {
        const result = await dialog.showOpenDialog(state.mainWindow!, {
            title: '选择 deepseek-harness 源码目录',
            defaultPath: state.sourceDir || preferredSourceDir() || undefined,
            properties: ['openDirectory']
        });
        if (result.canceled || result.filePaths.length === 0) return { canceled: true };
        const inspection = await inspectSource(result.filePaths[0]);
        if (inspection.valid && inspection.sourceDir) {
            state.sourceDir = inspection.sourceDir;
            saveSourceDir(state.sourceDir);
        }
        return inspection;
    });

    ipcMain.handle('desktop:start', async (_event, selectedSourceDir: string): Promise<IpcStartResponse> =>
        withOperation('启动服务', () => prepareAndStart(selectedSourceDir)));

    ipcMain.handle('desktop:check-update', () =>
        withOperation('检查更新', checkForUpdates));

    ipcMain.handle('desktop:apply-update', (): Promise<{ url: string; sourceDir: string }> =>
        withOperation('应用更新', applyUpdate));
}
