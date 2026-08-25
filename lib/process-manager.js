// ── Process management ────────────────────────────────────────────────────

const { execFile, spawn } = require('node:child_process');
const http = require('node:http');
const state = require('./state');
const {
    CMD_EXE, COMMAND_TIMEOUT_MS, WEB_START_TIMEOUT_MS,
    WEB_URL, WEB_POLL_INTERVAL_MS, WEB_POLL_TIMEOUT_MS,
    STREAM_POLL_TIMEOUT_MS, STDERR_MAX_LENGTH, MAX_BUFFER_BYTES,
    PROBE_TIMEOUT_MS, MAX_WEB_RESTART_ATTEMPTS, PHASE
} = require('./constants');
const { appendLog, formatCommand, sendStatus } = require('./utils');

// ── Run a file (exec) ─────────────────────────────────────────────────────

function runFile(file, args, cwd) {
    return new Promise((resolve, reject) => {
        appendLog('CMD', formatCommand(file, args));
        const child = execFile(file, args, {
            cwd,
            windowsHide: true,
            timeout: COMMAND_TIMEOUT_MS,
            maxBuffer: MAX_BUFFER_BYTES
        }, (error, stdout, stderr) => {
            state.activeProcesses.delete(child);
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
        state.activeProcesses.add(child);
        child.stdin?.end();
    });
}

// ── Stop a process tree ──────────────────────────────────────────────────

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

// ── Run pnpm ──────────────────────────────────────────────────────────────

function runPnpm(args, cwd) {
    return new Promise((resolve, reject) => {
        appendLog('CMD', formatCommand('pnpm.cmd', args));
        const child = spawn(CMD_EXE, ['/d', '/s', '/c', 'pnpm.cmd', ...args], {
            cwd,
            windowsHide: true,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        state.activeCommandProcess = child;
        state.activeProcesses.add(child);
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            state.activeProcesses.delete(child);
            state.activeCommandProcess = undefined;
            void stopProcessTree(child);
            reject(new Error(`pnpm ${args.join(' ')} 执行超过 ${COMMAND_TIMEOUT_MS / 60000} 分钟。`));
        }, COMMAND_TIMEOUT_MS);

        child.stdout.on('data', (chunk) => {
            appendLog('OUT', chunk.toString());
            console.log(`[pnpm] ${chunk.toString().trimEnd()}`);
        });
        child.stderr.on('data', (chunk) => {
            const output = chunk.toString();
            stderr = `${stderr}${output}`.slice(-STDERR_MAX_LENGTH);
            appendLog('ERR', output);
            console.error(`[pnpm] ${output.trimEnd()}`);
        });
        child.once('error', (error) => {
            state.activeProcesses.delete(child);
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            state.activeCommandProcess = undefined;
            reject(error);
        });
        child.once('exit', (code, signal) => {
            state.activeProcesses.delete(child);
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            state.activeCommandProcess = undefined;
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

// ── Web process ───────────────────────────────────────────────────────────

function startWebProcess(selectedSourceDir) {
    state.webExitMessage = undefined;
    state.expectedWebStop = false;
    appendLog('CMD', formatCommand('pnpm.cmd', ['dsh', 'web', '--no-open']));
    state.webProcess = spawn(CMD_EXE, [
        '/d', '/s', '/c', 'pnpm.cmd', 'dsh', 'web', '--no-open'
    ], {
        cwd: selectedSourceDir,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    state.webProcessSourceDir = selectedSourceDir;
    state.webProcess.stdout.on('data', (chunk) => {
        appendLog('OUT', chunk.toString());
        console.log(`[dsh] ${chunk.toString().trimEnd()}`);
    });
    state.webProcess.stderr.on('data', (chunk) => {
        appendLog('ERR', chunk.toString());
        console.error(`[dsh] ${chunk.toString().trimEnd()}`);
    });
    state.webProcess.once('error', (error) => {
        state.webExitMessage = `启动 Web 服务失败：${error.message}`;
    });
    state.webProcess.once('exit', (code, signal) => {
        state.webProcess = undefined;
        state.webProcessSourceDir = undefined;
        state.webProcessOwned = false;
        if (state.expectedWebStop || state.quitting) return;
        state.webExitMessage = `Web 服务已停止 (${code ?? signal})。`;

        // Auto-restart: attempt to recover from unexpected crashes
        if (state.webRestartAttempts < MAX_WEB_RESTART_ATTEMPTS) {
            state.webRestartAttempts++;
            sendStatus(PHASE.STARTING,
                `Web 服务意外停止，正在自动重试 (${state.webRestartAttempts}/${MAX_WEB_RESTART_ATTEMPTS})...`,
                50);
            startWebProcess(selectedSourceDir);
            state.webProcessOwned = true;
            waitForWebServer().then(() => {
                sendStatus(PHASE.READY, '服务运行中', 100);
                state.webRestartAttempts = 0;
            }).catch(() => {
                // If restart fails, show error
                sendStatus(PHASE.ERROR, state.webExitMessage || 'Web 服务重启失败');
            });
        } else {
            sendStatus(PHASE.ERROR, state.webExitMessage);
        }
    });
}

async function stopWebProcess() {
    if (!state.webProcess) return;
    state.expectedWebStop = true;
    const child = state.webProcess;
    state.webProcess = undefined;
    state.webProcessSourceDir = undefined;
    state.webProcessOwned = false;
    await stopProcessTree(child);
}

// ── Web server probe / wait ───────────────────────────────────────────────

/**
 * Probes whether port 3080 is already serving HTTP.
 * @returns {Promise<{occupied: boolean, isDsh: boolean}>}
 */
function probeWebServer() {
    return new Promise((resolve) => {
        let settled = false;
        const guard = (value) => { if (!settled) { settled = true; resolve(value); } };

        const request = http.get(WEB_URL, (response) => {
            // Collect a small chunk to identify the service
            let body = '';
            const finish = () => {
                const isDsh = body.includes('deepseek') || body.includes('dsh')
                    || body.includes('harness') || /DSH|DeepSeek/i.test(body);
                guard({ occupied: true, isDsh });
            };
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                body = `${body}${chunk}`.slice(0, 64 * 1024);
            });
            response.once('end', finish);
            response.once('close', finish);
            response.resume();
        });
        request.once('error', () => guard({ occupied: false, isDsh: false }));
        request.setTimeout(PROBE_TIMEOUT_MS, () => {
            request.destroy();
            guard({ occupied: false, isDsh: false });
        });
    });
}

function waitForWebServer() {
    const startedAt = Date.now();
    let pollCount = 0;
    const maxPolls = Math.ceil(WEB_START_TIMEOUT_MS / WEB_POLL_INTERVAL_MS);

    return new Promise((resolve, reject) => {
        let settled = false;
        const guardResolve = (value) => { if (!settled) { settled = true; resolve(value); } };
        const guardReject = (error) => { if (!settled) { settled = true; reject(error); } };

        const poll = () => {
            if (state.webExitMessage && !state.expectedWebStop) {
                guardReject(new Error(state.webExitMessage));
                return;
            }
            const request = http.get(WEB_URL, (response) => {
                response.resume();
                if (response.statusCode && response.statusCode < 500) {
                    guardResolve();
                    return;
                }
                retry();
            });
            request.on('error', retry);
            request.setTimeout(WEB_POLL_TIMEOUT_MS, () => {
                request.destroy();
                retry();
            });
        };
        const retry = () => {
            pollCount++;
            if (Date.now() - startedAt >= WEB_START_TIMEOUT_MS || pollCount >= maxPolls) {
                guardReject(new Error(`Web 服务在 ${WEB_START_TIMEOUT_MS / 1000} 秒内未监听 ${WEB_URL}`));
                return;
            }
            setTimeout(poll, WEB_POLL_INTERVAL_MS);
        };
        poll();
    });
}

async function startPreparedWebService(selectedSourceDir) {
    if (state.webProcess) {
        if (state.webProcessSourceDir !== selectedSourceDir) {
            throw new Error('当前已有其他源码目录的 Web 服务正在运行，请先停止该服务。');
        }
        await waitForWebServer();
        sendStatus(PHASE.READY, 'Web 服务运行中', 100);
        return;
    }

    const probe = await probeWebServer();
    if (probe.occupied) {
        if (probe.isDsh) {
            // External service: cannot verify ownership or source directory
            state.webProcess = null;
            state.webProcessSourceDir = undefined;
            state.webProcessOwned = false;
            sendStatus(PHASE.READY, '检测到外部 DSH 服务（无法验证源码目录），直接连接', 100);
            return;
        }
        throw new Error('端口 3080 已被其他服务占用，请先关闭该服务。');
    }
    sendStatus(PHASE.STARTING, '正在执行 pnpm dsh web', 84);
    startWebProcess(selectedSourceDir);
    state.webProcessOwned = true;
    await waitForWebServer();
    sendStatus(PHASE.READY, '服务运行中', 100);
}

module.exports = {
    runFile,
    runPnpm,
    stopProcessTree,
    startWebProcess,
    stopWebProcess,
    probeWebServer,
    waitForWebServer,
    startPreparedWebService
};
