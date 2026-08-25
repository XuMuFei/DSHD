// ── Global type declarations for renderer process ─────────────────────────

interface DesktopApi {
    getInfo: () => Promise<{ version: string; host: string; port: number; url: string }>;
    getLogs: () => Promise<string[]>;
    clearLogs: () => Promise<string[]>;
    getState: () => Promise<SourceInspection>;
    selectSource: () => Promise<SourceInspection | { canceled: true }>;
    start: (sourceDir: string) => Promise<{ url: string; sourceDir: string; built: boolean }>;
    checkForUpdate: () => Promise<PendingUpdate>;
    applyUpdate: () => Promise<{ url: string; sourceDir: string }>;
    onStatus: (callback: (status: IpcStatusPayload) => void) => () => void;
    onLogs: (callback: (logs: string[]) => void) => () => void;
}

interface SourceInspection {
    valid: boolean;
    sourceDir?: string;
    error?: string;
    hasDependencies?: boolean;
    hasCurrentBuild?: boolean;
    artifactCount?: number;
    buildCommit?: string;
    currentCommit?: string;
    ready?: boolean;
}

interface PendingUpdate {
    hasUpdate: boolean;
    behind: number;
    upstream: string;
    currentCommit: string;
    latestCommit: string;
}

interface IpcStatusPayload {
    phase: string;
    message: string;
    progress: number | null;
}

interface Window {
    desktopApi: DesktopApi;
}