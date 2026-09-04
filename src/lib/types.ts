// ── Type definitions for DSH Desktop ───────────────────────────────────────

import type { ChildProcess } from 'node:child_process';
import type { BrowserWindow } from 'electron';

/**
 * 应用状态
 */
export interface AppState {
    mainWindow: BrowserWindow | null;
    sourceDir: string;
    webProcess: ChildProcess | null;
    activeCommandProcess: ChildProcess | null;
    activeProcesses: Set<ChildProcess>;
    webProcessSourceDir: string | undefined;
    webUrl: string;
    webProcessOwned: boolean;
    activeOperation: string | null;
    pendingUpdate: PendingUpdate | null;
    expectedWebStop: boolean;
    webExitMessage: string | undefined;
    quitting: boolean;
    cleanupComplete: boolean;
    cleanupStarted: boolean;
    commandLogs: string[];
    webRestartAttempts: number;
    cachedCommit: string | undefined;
    cachedSourceDir: string | undefined;
}

/**
 * 待应用的更新
 */
export interface PendingUpdate {
    hasUpdate: boolean;
    behind: number;
    upstream: string;
    currentCommit: string;
    latestCommit: string;
}

/**
 * 源码检查结果
 */
export interface SourceInspection {
    valid: boolean;
    sourceDir?: string;
    error?: string;
    hasDependencies?: boolean;
    hasCurrentBuild?: boolean;
    artifactCount?: number;
    buildCommit?: string;
    currentCommit?: string;
    ready?: boolean;
    needsClone?: boolean;
    cloneDir?: string;
}

/**
 * 构建记录
 */
export interface BuildRecord {
    formatVersion: 1;
    environment: {
        DSH_CLIENT_COMMIT_HASH: string;
    };
    artifacts: {
        fileCount: number;
        sha256: string;
    };
}

/**
 * 进程阶段
 */
export type Phase =
    | 'idle'
    | 'cloning'
    | 'preparing'
    | 'checking'
    | 'updating'
    | 'installing'
    | 'building'
    | 'starting'
    | 'ready'
    | 'error';

/**
 * 桌面客户端信息
 */
export interface DesktopInfo {
    version: string;
    host: string;
    port: number;
    url: string;
}

/**
 * IPC 状态推送
 */
export interface IpcStatusPayload {
    phase: Phase;
    message: string;
    progress: number | null;
}

/**
 * IPC 启动响应
 */
export interface IpcStartResponse {
    url: string;
    sourceDir: string;
    built: boolean;
}

/**
 * Web 服务探测结果
 */
export interface WebServerProbeResult {
    occupied: boolean;
    isDsh: boolean;
}

/**
 * 文件执行结果
 */
export interface ExecResult {
    stdout: string;
    stderr: string;
}

/**
 * 客户端产物摘要
 */
export interface ClientArtifactDigest {
    fileCount: number;
    sha256: string;
}
