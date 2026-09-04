// ── Process management ────────────────────────────────────────────────────

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';

import { state } from './state';
import {
    CMD_EXE, COMMAND_TIMEOUT_MS, WEB_START_TIMEOUT_MS,
    WEB_URL, WEB_ENDPOINT, WEB_POLL_INTERVAL_MS, WEB_POLL_TIMEOUT_MS,
    STREAM_POLL_TIMEOUT_MS, STDERR_MAX_LENGTH, MAX_BUFFER_BYTES,
    PROBE_TIMEOUT_MS, MAX_WEB_RESTART_ATTEMPTS, PHASE
} from './constants';
import { appendLog, formatCommand, sendStatus } from './utils';
import type { ExecResult, WebServerProbeResult } from './types';

// ── Run a file (exec) ─────────────────────────────────────────────────────

export function runFile(file: string, args: readonly string[], cwd: string): Promise<ExecResult> {
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

export function stopProcessTree(child: ChildProcess | null): Promise<void> {
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

// ── Port-based orphan cleanup (Windows) ───────────────────────────────────
// The web process is spawned as `cmd.exe → pnpm.cmd → node(dsh)`. The cmd
// wrapper is what we track, but a Windows batch script can detach: the
// batch interpreter exits, and the node(dsh) grandchild gets reparented.
// `taskkill /t` from the cmd wrapper's PID then does NOT reach the actual
// port-3080 owner, so quit leaks the listener. As a safety net, look up
// whatever PID is currently LISTENING on the web port and kill it directly.
// Gated by `webProcessOwned` so we never kill an unrelated service that
// happened to occupy the port (e.g., a manually-started external DSH).

/** Find the PID currently LISTENING on `port` (TCP). Returns null if none. */
function findListeningPid(port: number): Promise<number | null> {
    if (process.platform !== 'win32') return Promise.resolve(null);
    return new Promise((resolve) => {
        execFile('netstat.exe', ['-ano', '-p', 'tcp'], {
            windowsHide: true,
            maxBuffer: MAX_BUFFER_BYTES,
        }, (error, stdout) => {
            if (error || !stdout) { resolve(null); return; }
            const portSuffix = `:${port}`;
            for (const line of stdout.split(/\r?\n/)) {
                // netstat -ano columns: Proto LocalAddress ForeignAddress State PID
                const cols = line.trim().split(/\s+/);
                if (cols.length < 5) continue;
                const local = cols[1] ?? '';
                if (!local.endsWith(portSuffix)) continue;
                if (cols[3] !== 'LISTENING') continue;
                const pid = Number.parseInt(cols[4] ?? '', 10);
                if (!Number.isFinite(pid) || pid <= 0) continue;
                if (pid === process.pid) continue; // never kill ourselves
                resolve(pid);
                return;
            }
            resolve(null);
        });
    });
}

/** Kill a PID and its descendants (Windows). Resolves regardless of outcome. */
function killPidTree(pid: number): Promise<void> {
    if (process.platform !== 'win32') return Promise.resolve();
    return new Promise((resolve) => {
        execFile('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
            windowsHide: true,
        }, () => resolve());
    });
}

// ── Run pnpm ──────────────────────────────────────────────────────────────

export function runPnpm(args: readonly string[], cwd: string): Promise<void> {
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
            state.activeCommandProcess = null;
            reject(error);
        });
        child.once('exit', (code, signal) => {
            state.activeProcesses.delete(child);
            if (settled) return;
            settled = true;
            state.activeCommandProcess = null;
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

export async function runPnpmBuild(cwd: string): Promise<void> {
    try {
        await runPnpm(['run', 'build'], cwd);
    } catch {
        sendStatus(PHASE.BUILDING, 'pnpm run build 失败，正在执行 pnpm run clean', null);
        await runPnpm(['run', 'clean'], cwd);
        sendStatus(PHASE.BUILDING, '正在重新执行 pnpm run build', null);
        await runPnpm(['run', 'build'], cwd);
    }
}

export function runGitClone(url: string, targetDir: string, cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        appendLog('CMD', formatCommand('git.exe', ['clone', url, targetDir]));
        const child = spawn('git.exe', ['clone', url, targetDir], {
            cwd,
            windowsHide: true,
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
            state.activeCommandProcess = null;
            void stopProcessTree(child);
            reject(new Error(`git clone 执行超过 ${COMMAND_TIMEOUT_MS / 60000} 分钟。`));
        }, COMMAND_TIMEOUT_MS);
        child.stdout?.on('data', (chunk: Buffer) => appendLog('OUT', chunk.toString()));
        child.stderr?.on('data', (chunk: Buffer) => {
            const output = chunk.toString();
            stderr = `${stderr}${output}`.slice(-STDERR_MAX_LENGTH);
            appendLog('ERR', output);
        });
        child.once('error', (error) => {
            state.activeProcesses.delete(child);
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            state.activeCommandProcess = null;
            reject(error);
        });
        child.once('exit', (code, signal) => {
            state.activeProcesses.delete(child);
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            state.activeCommandProcess = null;
            if (code === 0) {
                appendLog('EXIT', 'code 0');
                resolve();
                return;
            }
            appendLog('EXIT', `code ${code ?? signal}`);
            reject(new Error(`git clone 失败 (${code ?? signal})：${stderr.trim()}`));
        });
    });
}

// ── Web process ───────────────────────────────────────────────────────────

function startWebProcess(selectedSourceDir: string): void {
    state.webExitMessage = undefined;
    state.webUrl = WEB_URL;
    state.expectedWebStop = false;
    appendLog('CMD', formatCommand('pnpm.cmd', ['dsh', 'web', '--no-open']));
    const proc = spawn(CMD_EXE, [
        '/d', '/s', '/c', 'pnpm.cmd', 'dsh', 'web', '--no-open'
    ], {
        cwd: selectedSourceDir,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    state.webProcess = proc;
    state.webProcessSourceDir = selectedSourceDir;
    let outputBuffer = '';
    const captureOutput = (kind: 'OUT' | 'ERR', chunk: Buffer): void => {
        const output = chunk.toString();
        appendLog(kind, output);
        outputBuffer = `${outputBuffer}${output}`.slice(-4096);
        const urlMatch = outputBuffer.match(/https?:\/\/127\.0\.0\.1:3080\/\?token=[^\s"'<>]+/u);
        if (urlMatch) state.webUrl = urlMatch[0];
        console[kind === 'OUT' ? 'log' : 'error'](`[dsh] ${output.trimEnd()}`);
    };
    proc.stdout?.on('data', (chunk: Buffer) => captureOutput('OUT', chunk));
    proc.stderr?.on('data', (chunk: Buffer) => captureOutput('ERR', chunk));
    proc.once('error', (error) => {
        if (state.webProcess !== proc) return;
        state.webExitMessage = `启动 Web 服务失败：${error.message}`;
    });
    proc.once('exit', (code, signal) => {
        // A deliberate restart clears the old process before starting its
        // replacement. Ignore late events from that old process so they
        // cannot clear or restart the replacement service.
        if (state.webProcess !== proc) return;
        state.webProcess = null;
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
                sendStatus(PHASE.READY, 'Web 服务运行中', 100);
            }).catch((restartError) => {
                sendStatus(PHASE.ERROR, `自动重试失败：${restartError instanceof Error ? restartError.message : String(restartError)}`);
            });
        } else {
            sendStatus(PHASE.ERROR, state.webExitMessage);
        }
    });
}

export async function stopWebProcess(): Promise<void> {
    state.expectedWebStop = true;
    const tracked = state.webProcess;
    const owned = state.webProcessOwned;
    state.webProcess = null;
    state.webProcessSourceDir = undefined;
    state.webProcessOwned = false;

    // 1) Kill the tracked cmd wrapper tree (covers the common case).
    if (tracked) {
        await stopProcessTree(tracked);
    }

    // 2) Port-3080 fallback: catch a reparented orphan node(dsh) that
    //    taskkill /t couldn't reach. Only when we owned the process, to
    //    avoid killing an unrelated service on the same port.
    if (owned && process.platform === 'win32') {
        // Brief settle so taskkill can release the socket before we re-check.
        await new Promise((r) => setTimeout(r, 200));
        const orphan = await findListeningPid(Number(WEB_ENDPOINT.port));
        if (orphan !== null) {
            appendLog('CMD',
                `port-fallback: killing orphan listener pid=${orphan} on port=${WEB_ENDPOINT.port}`);
            await killPidTree(orphan);
        }
    }
}

// ── Web server probe / wait ───────────────────────────────────────────────

export function probeWebServer(): Promise<WebServerProbeResult> {
    return new Promise((resolve) => {
        let settled = false;
        const guard = (value: WebServerProbeResult) => { if (!settled) { settled = true; resolve(value); } };

        const request = http.get(WEB_URL, (response) => {
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

export function waitForWebServer(): Promise<void> {
    const startedAt = Date.now();
    let pollCount = 0;
    const maxPolls = Math.ceil(WEB_START_TIMEOUT_MS / WEB_POLL_INTERVAL_MS);

    return new Promise((resolve, reject) => {
        let settled = false;
        const guardResolve = () => { if (!settled) { settled = true; resolve(); } };
        const guardReject = (error: Error) => { if (!settled) { settled = true; reject(error); } };

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

// ── Start prepared web service ────────────────────────────────────────────

export async function startPreparedWebService(selectedSourceDir: string): Promise<string> {
    if (state.webProcess) {
        if (state.webProcessSourceDir !== selectedSourceDir) {
            throw new Error('当前已有其他源码目录的 Web 服务正在运行，请先停止该服务。');
        }
        await waitForWebServer();
        sendStatus(PHASE.READY, 'Web 服务运行中', 100);
        return state.webUrl;
    }

    const probe = await probeWebServer();
    if (probe.occupied) {
        if (probe.isDsh) {
            state.webProcess = null;
            state.webProcessSourceDir = undefined;
            state.webProcessOwned = false;
            state.webUrl = WEB_URL;
            sendStatus(PHASE.READY, '检测到外部 DSH 服务（无法验证源码目录），直接连接', 100);
            return state.webUrl;
        }
        throw new Error('端口 3080 已被其他服务占用，请先关闭该服务。');
    }
    sendStatus(PHASE.STARTING, '正在执行 pnpm dsh web', 84);
    startWebProcess(selectedSourceDir);
    state.webProcessOwned = true;
    await waitForWebServer();
    sendStatus(PHASE.READY, '服务运行中', 100);
    return state.webUrl;
}
