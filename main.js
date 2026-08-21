const { createHash } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const {
    existsSync,
    globSync,
    mkdirSync,
    readFileSync,
    statSync,
    writeFileSync
} = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');

const WEB_URL = 'http://127.0.0.1:3080/';
const EXPECTED_PACKAGE_NAME = '@deepseek-ai/dsh-root';
const BUILD_RECORD_PATH = '.dsh-build/client-build-environment.json';
const CLIENT_ARTIFACT_PATTERNS = [
    'apps/web/dist/**/*',
    'packages/*/*/lib/client.js',
    'packages/*/*/lib/client.js.map'
];
const DEFAULT_SOURCE_DIRS = [
    'E:\\git_workspace\\github\\deepseek-harness',
    'E:\\git\\_workspace\\github\\deepseek-harness'
];
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const WEB_START_TIMEOUT_MS = 2 * 60 * 1000;
const CMD_EXE = process.env.ComSpec || 'cmd.exe';
const WEB_ENDPOINT = new URL(WEB_URL);
const MAX_LOG_LINES = 1200;

let mainWindow;
let sourceDir;
let webProcess;
let activeCommandProcess;
let activeOperation;
let pendingUpdate;
let expectedWebStop = false;
let webExitMessage;
let quitting = false;
let cleanupComplete = false;
let cleanupStarted = false;
let commandLogs = [];

function sendStatus(phase, message, progress = null) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('desktop:status', { phase, message, progress });
}

function appendLog(kind, text) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const lines = String(text).replaceAll('\r', '').split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        commandLogs.push(`[${timestamp}] ${kind} ${line}`);
    }
    if (commandLogs.length > MAX_LOG_LINES) {
        commandLogs = commandLogs.slice(-MAX_LOG_LINES);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop:logs', commandLogs);
    }
}

function clearLogBuffer() {
    commandLogs = [];
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop:logs', commandLogs);
    }
}

function formatCommand(file, args) {
    return [file, ...args].map((value) => /\s/u.test(value) ? `"${value}"` : value).join(' ');
}

function settingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
    try {
        return JSON.parse(readFileSync(settingsPath(), 'utf8'));
    } catch {
        return {};
    }
}

function saveSourceDir(selectedSourceDir) {
    const file = settingsPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ sourceDir: selectedSourceDir }, null, 4)}\n`, 'utf8');
}

function validateSourceDir(candidate) {
    if (typeof candidate !== 'string' || candidate.trim() === '') {
        return { valid: false, error: '请选择 deepseek-harness 源码目录。' };
    }
    const resolved = path.resolve(candidate.trim());
    const packagePath = path.join(resolved, 'package.json');
    if (!existsSync(packagePath)) {
        return { valid: false, error: '所选目录中没有 package.json。' };
    }
    try {
        const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
        if (manifest.name !== EXPECTED_PACKAGE_NAME) {
            return { valid: false, error: `所选目录不是 ${EXPECTED_PACKAGE_NAME} 源码仓库。` };
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { valid: false, error: `无法读取 package.json：${detail}` };
    }
    if (!existsSync(path.join(resolved, '.git'))) {
        return { valid: false, error: '所选目录不是 Git 工作区。' };
    }
    return { valid: true, sourceDir: resolved };
}

function preferredSourceDir() {
    const settings = readSettings();
    const candidates = [
        process.env.DSH_SOURCE_DIR,
        settings.sourceDir,
        ...DEFAULT_SOURCE_DIRS
    ];
    for (const candidate of candidates) {
        const result = validateSourceDir(candidate);
        if (result.valid) return result.sourceDir;
    }
    return '';
}

function runFile(file, args, cwd) {
    return new Promise((resolve, reject) => {
        appendLog('CMD', formatCommand(file, args));
        const child = execFile(file, args, {
            cwd,
            windowsHide: true,
            timeout: COMMAND_TIMEOUT_MS,
            maxBuffer: 8 * 1024 * 1024
        }, (error, stdout, stderr) => {
            appendLog('OUT', stdout);
            appendLog('ERR', stderr);
            if (error) {
                appendLog('EXIT', `failed: ${error.message}`);
                reject(new Error(`${file} ${args.join(' ')} 失败：${stderr.trim() || error.message}`));
                return;
            }
            appendLog('EXIT', 'code 0');
            resolve({ stdout, stderr });
        });
        child.stdin?.end();
    });
}

function stopProcessTree(child) {
    if (!child || child.killed) return Promise.resolve();
    if (process.platform !== 'win32') {
        child.kill();
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        execFile('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
            windowsHide: true
        }, () => resolve());
    });
}

function runPnpm(args, cwd) {
    return new Promise((resolve, reject) => {
        appendLog('CMD', formatCommand('pnpm.cmd', args));
        const child = spawn(CMD_EXE, ['/d', '/s', '/c', 'pnpm.cmd', ...args], {
            cwd,
            windowsHide: true,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        activeCommandProcess = child;
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            void stopProcessTree(child);
            reject(new Error(`pnpm ${args.join(' ')} 执行超过 ${COMMAND_TIMEOUT_MS / 60000} 分钟。`));
        }, COMMAND_TIMEOUT_MS);

        child.stdout.on('data', (chunk) => {
            appendLog('OUT', chunk.toString());
            console.log(`[pnpm] ${chunk.toString().trimEnd()}`);
        });
        child.stderr.on('data', (chunk) => {
            const output = chunk.toString();
            stderr = `${stderr}${output}`.slice(-8000);
            appendLog('ERR', output);
            console.error(`[pnpm] ${output.trimEnd()}`);
        });
        child.once('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            activeCommandProcess = undefined;
            reject(error);
        });
        child.once('exit', (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            activeCommandProcess = undefined;
            if (code === 0) {
                appendLog('EXIT', 'code 0');
                resolve();
                return;
            }
            appendLog('EXIT', `code ${code ?? signal}`);
            reject(new Error(`pnpm ${args.join(' ')} 失败 (${code ?? signal})：${stderr.trim()}`));
        });
    });
}

function clientArtifactDigest(selectedSourceDir) {
    const paths = globSync(CLIENT_ARTIFACT_PATTERNS, { cwd: selectedSourceDir })
        .map(candidate => candidate.replaceAll('\\', '/'))
        .filter(candidate => statSync(path.resolve(selectedSourceDir, candidate)).isFile())
        .sort();
    if (paths.length === 0) return undefined;
    const digest = createHash('sha256');
    for (const artifactPath of paths) {
        const content = readFileSync(path.resolve(selectedSourceDir, artifactPath));
        digest.update(`${Buffer.byteLength(artifactPath)}:`);
        digest.update(artifactPath);
        digest.update(`${content.byteLength}:`);
        digest.update(content);
    }
    return { fileCount: paths.length, sha256: digest.digest('hex') };
}

function readBuildRecord(selectedSourceDir) {
    const recordPath = path.join(selectedSourceDir, BUILD_RECORD_PATH);
    if (!existsSync(recordPath)) return undefined;
    try {
        const record = JSON.parse(readFileSync(recordPath, 'utf8'));
        const commit = record?.environment?.DSH_CLIENT_COMMIT_HASH;
        const fileCount = record?.artifacts?.fileCount;
        const sha256 = record?.artifacts?.sha256;
        if (record?.formatVersion !== 1
            || !/^[0-9a-f]{7}$/i.test(commit)
            || !Number.isSafeInteger(fileCount)
            || fileCount < 1
            || !/^[0-9a-f]{64}$/.test(sha256)) {
            return undefined;
        }
        return { commit: commit.toLowerCase(), fileCount, sha256 };
    } catch {
        return undefined;
    }
}

async function inspectSource(candidate) {
    const validation = validateSourceDir(candidate);
    if (!validation.valid) return validation;
    const selectedSourceDir = validation.sourceDir;
    const hasDependencies = existsSync(path.join(selectedSourceDir, 'node_modules', '.pnpm'));
    const buildRecord = readBuildRecord(selectedSourceDir);
    let currentCommit;
    try {
        const result = await runFile('git.exe', ['rev-parse', '--short=7', 'HEAD'], selectedSourceDir);
        currentCommit = result.stdout.trim().toLowerCase();
    } catch {
        currentCommit = undefined;
    }
    const digest = buildRecord ? clientArtifactDigest(selectedSourceDir) : undefined;
    const hasCurrentBuild = buildRecord !== undefined
        && currentCommit !== undefined
        && buildRecord.commit === currentCommit
        && digest !== undefined
        && buildRecord.fileCount === digest.fileCount
        && buildRecord.sha256 === digest.sha256;
    return {
        valid: true,
        sourceDir: selectedSourceDir,
        hasDependencies,
        hasCurrentBuild,
        artifactCount: buildRecord?.fileCount,
        buildCommit: buildRecord?.commit,
        currentCommit,
        ready: hasDependencies && hasCurrentBuild
    };
}

function startWebProcess(selectedSourceDir) {
    webExitMessage = undefined;
    expectedWebStop = false;
    appendLog('CMD', formatCommand('pnpm.cmd', ['dsh', 'web', '--no-open']));
    webProcess = spawn(CMD_EXE, [
        '/d', '/s', '/c', 'pnpm.cmd', 'dsh', 'web', '--no-open'
    ], {
        cwd: selectedSourceDir,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    webProcess.stdout.on('data', (chunk) => {
        appendLog('OUT', chunk.toString());
        console.log(`[dsh] ${chunk.toString().trimEnd()}`);
    });
    webProcess.stderr.on('data', (chunk) => {
        appendLog('ERR', chunk.toString());
        console.error(`[dsh] ${chunk.toString().trimEnd()}`);
    });
    webProcess.once('error', (error) => {
        webExitMessage = `启动 Web 服务失败：${error.message}`;
    });
    webProcess.once('exit', (code, signal) => {
        webProcess = undefined;
        if (expectedWebStop || quitting) return;
        webExitMessage = `Web 服务已停止 (${code ?? signal})。`;
        sendStatus('error', webExitMessage);
    });
}

async function stopWebProcess() {
    if (!webProcess) return;
    expectedWebStop = true;
    const child = webProcess;
    webProcess = undefined;
    await stopProcessTree(child);
}

function probeWebServer() {
    return new Promise((resolve) => {
        const request = http.get(WEB_URL, (response) => {
            response.resume();
            resolve(true);
        });
        request.once('error', () => resolve(false));
        request.setTimeout(1000, () => request.destroy());
    });
}

function waitForWebServer() {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const poll = () => {
            if (webExitMessage) {
                reject(new Error(webExitMessage));
                return;
            }
            const request = http.get(WEB_URL, (response) => {
                response.resume();
                if (response.statusCode && response.statusCode < 500) {
                    resolve();
                    return;
                }
                retry();
            });
            request.on('error', retry);
            request.setTimeout(3000, () => request.destroy());
        };
        const retry = () => {
            if (Date.now() - startedAt >= WEB_START_TIMEOUT_MS) {
                reject(new Error(`Web 服务在 ${WEB_START_TIMEOUT_MS / 1000} 秒内未监听 ${WEB_URL}`));
                return;
            }
            setTimeout(poll, 500);
        };
        poll();
    });
}

async function startPreparedWebService(selectedSourceDir) {
    if (await probeWebServer()) throw new Error('端口 3080 已被其他服务占用，请先关闭该服务。');
    sendStatus('starting', '正在执行 pnpm dsh web', 84);
    startWebProcess(selectedSourceDir);
    await waitForWebServer();
    sendStatus('ready', '服务运行中', 100);
}

async function prepareAndStart(selectedSourceDir) {
    clearLogBuffer();
    sendStatus('preparing', '正在检查依赖和构建状态', 5);
    const inspection = await inspectSource(selectedSourceDir);
    if (!inspection.valid) throw new Error(inspection.error);
    sourceDir = inspection.sourceDir;
    saveSourceDir(sourceDir);

    if (!inspection.ready) {
        sendStatus('installing', '正在执行 pnpm install', 18);
        await runPnpm(['install'], sourceDir);
        sendStatus('building', '正在执行 pnpm run build', 55);
        await runPnpm(['run', 'build'], sourceDir);
        const completed = await inspectSource(sourceDir);
        if (!completed.hasCurrentBuild) {
            throw new Error(`构建完成，但 ${BUILD_RECORD_PATH} 与实际产物不一致。`);
        }
    }

    await startPreparedWebService(sourceDir);
    return { url: WEB_URL, sourceDir, built: !inspection.ready };
}

async function checkForUpdates() {
    if (!sourceDir) throw new Error('尚未选择源码目录。');
    clearLogBuffer();
    sendStatus('checking', '正在检查 Git 更新', 15);
    let upstream = 'origin/master';
    try {
        const result = await runFile('git.exe', [
            'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'
        ], sourceDir);
        upstream = result.stdout.trim() || upstream;
    } catch {
        // 未设置上游分支时继续检查 origin/master。
    }
    await runFile('git.exe', ['fetch', '--quiet', '--prune', 'origin'], sourceDir);
    const [behindResult, currentResult, latestResult] = await Promise.all([
        runFile('git.exe', ['rev-list', '--count', `HEAD..${upstream}`], sourceDir),
        runFile('git.exe', ['rev-parse', '--short=7', 'HEAD'], sourceDir),
        runFile('git.exe', ['rev-parse', '--short=7', upstream], sourceDir)
    ]);
    const behind = Number.parseInt(behindResult.stdout.trim(), 10);
    const result = {
        hasUpdate: behind > 0,
        behind,
        upstream,
        currentCommit: currentResult.stdout.trim(),
        latestCommit: latestResult.stdout.trim()
    };
    pendingUpdate = result.hasUpdate ? result : undefined;
    sendStatus('ready', result.hasUpdate ? `发现 ${behind} 个新提交` : '当前已是最新版本', 100);
    return result;
}

async function applyUpdate() {
    if (!sourceDir || !pendingUpdate) throw new Error('没有可应用的更新。');
    clearLogBuffer();
    sendStatus('updating', '正在停止 Web 服务', 8);
    await stopWebProcess();
    sendStatus('updating', '正在同步源码', 16);
    await runFile('git.exe', ['merge', '--ff-only', pendingUpdate.upstream], sourceDir);
    sendStatus('installing', '正在执行 pnpm install', 34);
    await runPnpm(['install'], sourceDir);
    sendStatus('building', '正在执行 pnpm run build', 62);
    await runPnpm(['run', 'build'], sourceDir);
    const completed = await inspectSource(sourceDir);
    if (!completed.hasCurrentBuild) {
        throw new Error(`更新构建完成，但 ${BUILD_RECORD_PATH} 与实际产物不一致。`);
    }
    await startPreparedWebService(sourceDir);
    pendingUpdate = undefined;
    sendStatus('ready', '更新完成');
    return { url: WEB_URL, sourceDir };
}

async function withOperation(name, operation) {
    if (activeOperation) throw new Error(`正在执行“${activeOperation}”，请稍候。`);
    activeOperation = name;
    try {
        return await operation();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendStatus('error', message);
        throw error;
    } finally {
        activeOperation = undefined;
    }
}

function registerIpcHandlers() {
    ipcMain.handle('desktop:get-info', () => ({
        version: app.getVersion(),
        host: WEB_ENDPOINT.hostname,
        port: WEB_ENDPOINT.port,
        url: WEB_URL
    }));
    ipcMain.handle('desktop:get-logs', () => commandLogs);
    ipcMain.handle('desktop:clear-logs', () => {
        clearLogBuffer();
        return [];
    });
    ipcMain.handle('desktop:get-state', async () => {
        const candidate = preferredSourceDir();
        return candidate ? inspectSource(candidate) : { valid: false, sourceDir: '' };
    });
    ipcMain.handle('desktop:select-source', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: '选择 deepseek-harness 源码目录',
            defaultPath: sourceDir || preferredSourceDir() || undefined,
            properties: ['openDirectory']
        });
        if (result.canceled || result.filePaths.length === 0) return { canceled: true };
        return inspectSource(result.filePaths[0]);
    });
    ipcMain.handle('desktop:start', (_event, selectedSourceDir) => withOperation(
        '启动服务',
        () => prepareAndStart(selectedSourceDir)
    ));
    ipcMain.handle('desktop:check-update', () => withOperation('检查更新', checkForUpdates));
    ipcMain.handle('desktop:apply-update', () => withOperation('应用更新', applyUpdate));
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 680,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#eef0eb',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: true
        }
    });
    mainWindow.webContents.on('did-attach-webview', (_event, contents) => {
        contents.setWindowOpenHandler(({ url }) => {
            void shell.openExternal(url);
            return { action: 'deny' };
        });
    });
    mainWindow.once('ready-to-show', () => mainWindow.show());
    void mainWindow.loadFile(path.join(__dirname, 'shell.html'));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });
    app.whenReady().then(() => {
        registerIpcHandlers();
        createWindow();
    });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
    if (cleanupComplete) return;
    event.preventDefault();
    if (cleanupStarted) return;
    cleanupStarted = true;
    quitting = true;
    void Promise.all([
        stopProcessTree(activeCommandProcess),
        stopProcessTree(webProcess)
    ]).finally(() => {
        cleanupComplete = true;
        app.quit();
    });
});
