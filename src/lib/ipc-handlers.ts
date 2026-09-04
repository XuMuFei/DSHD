// ── IPC handler registration ──────────────────────────────────────────────

import { app, ipcMain, dialog } from 'electron';

import { WEB_URL, WEB_ENDPOINT, BUILD_RECORD_PATH, DEV_SOURCE_DIR, PHASE, PROGRESS } from './constants';
import { state } from './state';
import { sendStatus, clearLogBuffer } from './utils';
import {
    preferredSourceDir, preferredDefaultCloneDir, defaultCloneDir,
    cloneHarness, inspectSource, saveSourceDir
} from './source-manager';
import { runPnpm, runPnpmBuild, stopWebProcess, startPreparedWebService } from './process-manager';
import { checkForUpdates, applyUpdate } from './git-updater';
import type { SourceInspection, IpcStartResponse, DesktopInfo } from './types';

// ── Operation lock ────────────────────────────────────────────────────────

async function withOperation<T>(
    name: string,
    operation: () => Promise<T>,
    options: { failurePhase?: string } = {}
): Promise<T> {
    if (state.activeOperation) throw new Error(`正在执行"${state.activeOperation}"，请稍候。`);
    state.activeOperation = name;
    try {
        return await operation();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // `failurePhase` lets a read-only operation (e.g. update check) avoid
        // painting the service-status dot red: the running 3080 service is
        // unaffected by a failed check, so the failure surfaces as a toast
        // and a READY-status message instead of an ERROR.
        sendStatus(options.failurePhase ?? PHASE.ERROR, message);
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
        await runPnpmBuild(state.sourceDir);

        const completed = await inspectSource(state.sourceDir);
        if (!completed.hasCurrentBuild) {
            throw new Error(`构建完成，但 ${BUILD_RECORD_PATH} 与实际产物不一致。`);
        }
    }

    const url = await startPreparedWebService(state.sourceDir);
    return { url, sourceDir: state.sourceDir, built: !inspection.ready };
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
        if (candidate) return inspectSource(candidate);
        const defaultCandidate = preferredDefaultCloneDir();
        if (defaultCandidate) {
            state.sourceDir = defaultCandidate;
            saveSourceDir(defaultCandidate);
            return inspectSource(defaultCandidate);
        }
        if (!app.isPackaged) {
            return {
                valid: false,
                sourceDir: '',
                needsClone: false,
                error: `开发模式源码目录无效：${DEV_SOURCE_DIR}`
            };
        }
        return { valid: false, sourceDir: '', needsClone: true, cloneDir: defaultCloneDir() };
    });

    ipcMain.handle('desktop:clone-source', async (): Promise<SourceInspection> => {
        clearLogBuffer();
        sendStatus(PHASE.CLONING, '正在克隆 deepseek-harness 源码仓库', 10);
        try {
            const clonedDir = await cloneHarness();
            state.sourceDir = clonedDir;
            sendStatus(PHASE.PREPARING, '克隆完成，正在验证', 95);
            return await inspectSource(clonedDir);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendStatus(PHASE.ERROR, message);
            throw error;
        }
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

    ipcMain.handle('desktop:restart-service', async (): Promise<{ url: string; sourceDir: string }> =>
        withOperation('重启服务', async () => {
            if (!state.sourceDir) throw new Error('尚未选择源码目录，无法重启服务。');
            if (!state.webProcessOwned) {
                throw new Error('当前 3080 服务不是由本客户端启动，无法重启。');
            }

            sendStatus(PHASE.STARTING, '正在停止 3080 服务', 20);
            await stopWebProcess();
            sendStatus(PHASE.STARTING, '正在重新启动 3080 服务', 60);
            const url = await startPreparedWebService(state.sourceDir);
            return { url, sourceDir: state.sourceDir };
        }));

    ipcMain.handle('desktop:check-update', () =>
        withOperation('检查更新', checkForUpdates, { failurePhase: PHASE.READY }));

    ipcMain.handle('desktop:apply-update', (): Promise<{ url: string; sourceDir: string }> =>
        withOperation('应用更新', applyUpdate));
}
