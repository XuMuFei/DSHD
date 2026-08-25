// ── Configuration constants ──────────────────────────────────────────────

export const WEB_URL = 'http://127.0.0.1:3080/' as const;
export const EXPECTED_PACKAGE_NAME = '@deepseek-ai/dsh-root' as const;
export const BUILD_RECORD_PATH = '.dsh-build/client-build-environment.json' as const;

export const CLIENT_ARTIFACT_PATTERNS: readonly string[] = [
    'apps/web/dist/**/*',
    'packages/*/*/lib/client.js',
    'packages/*/*/lib/client.js.map'
] as const;

export const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
export const WEB_START_TIMEOUT_MS = 2 * 60 * 1000;
export const CMD_EXE = process.env.ComSpec ?? 'cmd.exe';
export const WEB_ENDPOINT = new URL(WEB_URL);
export const MAX_LOG_LINES = 1200;
export const WEB_POLL_INTERVAL_MS = 500;
export const WEB_POLL_TIMEOUT_MS = 3000;
export const STREAM_POLL_TIMEOUT_MS = 1000;
export const STDERR_MAX_LENGTH = 8000;
export const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
export const PROBE_TIMEOUT_MS = 1000;
export const MAX_WEB_RESTART_ATTEMPTS = 3;

// ── Progress phases ──────────────────────────────────────────────────────

export const PHASE = {
    IDLE: 'idle',
    PREPARING: 'preparing',
    CHECKING: 'checking',
    UPDATING: 'updating',
    INSTALLING: 'installing',
    BUILDING: 'building',
    STARTING: 'starting',
    READY: 'ready',
    ERROR: 'error'
} as const;

// ── Progress percentages for prepareAndStart pipeline ─────────────────────

export const PROGRESS = {
    PREPARE: 5,
    INSTALL: 18,
    BUILD: 55,
    START: 84,
    DONE: 100
} as const;
