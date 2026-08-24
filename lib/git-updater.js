// ── Git update operations ─────────────────────────────────────────────────

const { runFile, runPnpm, stopWebProcess, startPreparedWebService } = require('./process-manager');
const { inspectSource } = require('./source-manager');
const { sendStatus, clearLogBuffer } = require('./utils');
const { BUILD_RECORD_PATH, PHASE } = require('./constants');
const state = require('./state');

async function checkForUpdates() {
    if (!state.sourceDir) throw new Error('尚未选择源码目录。');
    clearLogBuffer();
    sendStatus(PHASE.CHECKING, '正在检查 Git 更新', 15);

    // Use stored upstream or fallback
    let upstream = 'origin/master';
    try {
        const result = await runFile('git.exe', [
            'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'
        ], state.sourceDir);
        upstream = result.stdout.trim() || upstream;
    } catch {
        // 未设置上游分支时继续检查 origin/master。
    }

    await runFile('git.exe', ['fetch', '--quiet', '--prune', 'origin'], state.sourceDir);

    const [behindResult, currentResult, latestResult] = await Promise.all([
        runFile('git.exe', ['rev-list', '--count', `HEAD..${upstream}`], state.sourceDir),
        runFile('git.exe', ['rev-parse', '--short=7', 'HEAD'], state.sourceDir),
        runFile('git.exe', ['rev-parse', '--short=7', upstream], state.sourceDir)
    ]);

    const behind = Number.parseInt(behindResult.stdout.trim(), 10);
    const result = {
        hasUpdate: behind > 0,
        behind,
        upstream,
        currentCommit: currentResult.stdout.trim(),
        latestCommit: latestResult.stdout.trim()
    };

    state.pendingUpdate = result.hasUpdate ? result : undefined;
    sendStatus(PHASE.READY, result.hasUpdate ? `发现 ${behind} 个新提交` : '当前已是最新版本', 100);
    return result;
}

async function applyUpdate() {
    if (!state.sourceDir || !state.pendingUpdate) throw new Error('没有可应用的更新。');
    clearLogBuffer();
    sendStatus(PHASE.UPDATING, '正在停止 Web 服务', 8);
    await stopWebProcess();

    // Check for uncommitted changes before merge
    sendStatus(PHASE.UPDATING, '正在检查本地修改', 10);
    try {
        const statusResult = await runFile('git.exe', ['status', '--porcelain'], state.sourceDir);
        if (statusResult.stdout.trim()) {
            throw new Error('本地有未提交的修改，请先提交或暂存后再更新。');
        }
    } catch (error) {
        if (error.message.includes('本地有未提交的修改')) throw error;
        // Ignore other git status errors, proceed with merge
    }

    sendStatus(PHASE.UPDATING, '正在同步源码', 16);
    await runFile('git.exe', ['merge', '--ff-only', state.pendingUpdate.upstream], state.sourceDir);

    // Invalidate cached commit
    state.cachedCommit = undefined;
    state.cachedSourceDir = undefined;

    sendStatus(PHASE.INSTALLING, '正在执行 pnpm install', 34);
    await runPnpm(['install'], state.sourceDir);

    sendStatus(PHASE.BUILDING, '正在执行 pnpm run build', 62);
    await runPnpm(['run', 'build'], state.sourceDir);

    const completed = await inspectSource(state.sourceDir);
    if (!completed.hasCurrentBuild) {
        throw new Error(`更新构建完成，但 ${BUILD_RECORD_PATH} 与实际产物不一致。`);
    }

    await startPreparedWebService(state.sourceDir);
    state.pendingUpdate = undefined;
    sendStatus(PHASE.READY, '更新完成');
    return { url: 'http://127.0.0.1:3080/', sourceDir: state.sourceDir };
}

module.exports = {
    checkForUpdates,
    applyUpdate
};