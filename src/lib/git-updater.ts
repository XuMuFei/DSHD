// ── Git update operations ─────────────────────────────────────────────────

import { runFile, runPnpm, runPnpmBuild, stopWebProcess, startPreparedWebService } from './process-manager';
import { inspectSource } from './source-manager';
import { sendStatus, clearLogBuffer } from './utils';
import { BUILD_RECORD_PATH, PHASE } from './constants';
import { state } from './state';
import type { PendingUpdate } from './types';

// ── Check for updates ──────────────────────────────────────────────────────

export async function checkForUpdates(): Promise<PendingUpdate> {
    if (!state.sourceDir) throw new Error('尚未选择源码目录。');
    clearLogBuffer();
    sendStatus(PHASE.CHECKING, '正在检查 Git 更新', 15);

    let upstream = 'origin/master';
    try {
        const result = await runFile('git.exe', [
            'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'
        ], state.sourceDir);
        upstream = result.stdout.trim() || upstream;
    } catch {
        // 未设置上游分支时继续检查 origin/master
    }

    await runFile('git.exe', ['fetch', '--quiet', '--prune', 'origin'], state.sourceDir);

    const [behindResult, currentResult, latestResult] = await Promise.all([
        runFile('git.exe', ['rev-list', '--count', `HEAD..${upstream}`], state.sourceDir),
        runFile('git.exe', ['rev-parse', '--short=7', 'HEAD'], state.sourceDir),
        runFile('git.exe', ['rev-parse', '--short=7', upstream], state.sourceDir)
    ]);

    const behind = Number.parseInt(behindResult.stdout.trim(), 10);
    const result: PendingUpdate = {
        hasUpdate: behind > 0,
        behind,
        upstream,
        currentCommit: currentResult.stdout.trim(),
        latestCommit: latestResult.stdout.trim()
    };

    state.pendingUpdate = result.hasUpdate ? result : null;
    sendStatus(PHASE.READY, result.hasUpdate ? `发现 ${behind} 个新提交` : '当前已是最新版本', 100);
    return result;
}

// ── Apply update ──────────────────────────────────────────────────────────

export async function applyUpdate(): Promise<{ url: string; sourceDir: string }> {
    if (!state.sourceDir || !state.pendingUpdate) throw new Error('没有可应用的更新。');
    clearLogBuffer();

    // Phase 1: Pre-update checks (before stopping service)
    // Check if service is owned by this client
    if (!state.webProcessOwned) {
        throw new Error('当前连接的是外部 DSH 服务，无法执行更新。请先关闭外部服务，再由本客户端启动服务后进行更新。');
    }

    // Verify service source directory matches current selection
    if (state.webProcessSourceDir && state.webProcessSourceDir !== state.sourceDir) {
        throw new Error(`当前服务的源码目录 (${state.webProcessSourceDir}) 与所选目录 (${state.sourceDir}) 不一致，无法执行更新。`);
    }

    sendStatus(PHASE.UPDATING, '正在检查本地修改', 10);
    const statusResult = await runFile('git.exe', ['status', '--porcelain'], state.sourceDir);
    if (statusResult.stdout.trim()) {
        throw new Error('本地有未提交的修改，请先提交或暂存后再更新。');
    }

    // Phase 2: Stop service and perform update with recovery guarantee
    const wasRunning = state.webProcess !== null && state.webProcess !== undefined;
    sendStatus(PHASE.UPDATING, '正在停止 Web 服务', 15);
    await stopWebProcess();

    try {
        sendStatus(PHASE.UPDATING, '正在同步源码', 20);
        await runFile('git.exe', ['merge', '--ff-only', state.pendingUpdate.upstream], state.sourceDir);

        // Invalidate cached commit
        state.cachedCommit = undefined;
        state.cachedSourceDir = undefined;

        sendStatus(PHASE.INSTALLING, '正在执行 pnpm install', 40);
        await runPnpm(['install'], state.sourceDir);

        sendStatus(PHASE.BUILDING, '正在执行 pnpm run build', 65);
        await runPnpmBuild(state.sourceDir);

        const completed = await inspectSource(state.sourceDir);
        if (!completed.hasCurrentBuild) {
            throw new Error(`更新构建完成，但 ${BUILD_RECORD_PATH} 与实际产物不一致。`);
        }

        const url = await startPreparedWebService(state.sourceDir);
        state.pendingUpdate = null;
        sendStatus(PHASE.READY, '更新完成');
        return { url, sourceDir: state.sourceDir };
    } catch (error) {
        // Recovery: restart the original service if it was running before update
        if (wasRunning) {
            sendStatus(PHASE.UPDATING, '更新失败，正在恢复服务...', 90);
            try {
                await startPreparedWebService(state.sourceDir);
            } catch (recoveryError) {
                console.error('服务恢复失败:', recoveryError);
            }
        }
        throw error;
    }
}
