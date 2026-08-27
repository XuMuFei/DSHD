// ── Global type declarations for renderer process ─────────────────────────

interface DesktopApi {
    getInfo: () => Promise<{ version: string; host: string; port: number; url: string }>;
    getLogs: () => Promise<string[]>;
    clearLogs: () => Promise<string[]>;
    getState: () => Promise<SourceInspection>;
    selectSource: () => Promise<SourceInspection | { canceled: true }>;
    cloneSource: () => Promise<SourceInspection>;
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
    needsClone?: boolean;
    cloneDir?: string;
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

/** Detail payload of the Electron <webview> `did-fail-load` DOM event. */
interface DidFailLoadEventDetail {
    errorCode: number;
    errorDescription: string;
    validatedURL: string;
    isMainFrame: boolean;
}

/** Minimal Electron <webview> element surface used by the renderer. */
interface WebviewElement extends HTMLElement {
    /** Page URL the webview is loading. Mirrors the standard attribute. */
    src: string;
    /** Reload the current page. */
    reload(): void;
    /** Stop the in-flight load. */
    stop(): void;
    /** A CustomEvent carrying {@link DidFailLoadEventDetail}. */
    addEventListener(type: 'did-fail-load', listener: (event: Event & { detail?: DidFailLoadEventDetail }) => void): void;
    addEventListener(type: 'did-finish-load', listener: (event: Event) => void): void;
    addEventListener(type: 'did-start-loading', listener: (event: Event) => void): void;
    addEventListener(type: 'did-stop-loading', listener: (event: Event) => void): void;
    addEventListener(type: 'crashed', listener: (event: Event) => void): void;
}
