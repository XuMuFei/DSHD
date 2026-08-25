// ── Configuration constants ──────────────────────────────────────────────

const WEB_URL = 'http://127.0.0.1:3080/';
const GIT_CLONE_URL = 'https://github.com/deepseek-ai/deepseek-harness.git';
const EXPECTED_PACKAGE_NAME = '@deepseek-ai/dsh-root';
const BUILD_RECORD_PATH = '.dsh-build/client-build-environment.json';
const CLIENT_ARTIFACT_PATTERNS = [
    'apps/web/dist/**/*',
    'packages/*/*/lib/client.js',
    'packages/*/*/lib/client.js.map'
];
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const WEB_START_TIMEOUT_MS = 2 * 60 * 1000;
const CMD_EXE = process.env.ComSpec || 'cmd.exe';
const WEB_ENDPOINT = new URL(WEB_URL);
const MAX_LOG_LINES = 1200;
const WEB_POLL_INTERVAL_MS = 500;
const WEB_POLL_TIMEOUT_MS = 3000;
const STREAM_POLL_TIMEOUT_MS = 1000;
const STDERR_MAX_LENGTH = 8000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 1000;
const MAX_WEB_RESTART_ATTEMPTS = 3;

// ── Progress phases ──────────────────────────────────────────────────────

const PHASE = Object.freeze({
    IDLE: 'idle',
    CLONING: 'cloning',
    PREPARING: 'preparing',
    CHECKING: 'checking',
    UPDATING: 'updating',
    INSTALLING: 'installing',
    BUILDING: 'building',
    STARTING: 'starting',
    READY: 'ready',
    ERROR: 'error'
});

// ── Progress percentages for prepareAndStart pipeline ─────────────────────

const PROGRESS = Object.freeze({
    PREPARE: 5,
    INSTALL: 18,
    BUILD: 55,
    START: 84,
    DONE: 100
});

module.exports = {
    WEB_URL,
    GIT_CLONE_URL,
    EXPECTED_PACKAGE_NAME,
    BUILD_RECORD_PATH,
    CLIENT_ARTIFACT_PATTERNS,
    COMMAND_TIMEOUT_MS,
    WEB_START_TIMEOUT_MS,
    CMD_EXE,
    WEB_ENDPOINT,
    MAX_LOG_LINES,
    WEB_POLL_INTERVAL_MS,
    WEB_POLL_TIMEOUT_MS,
    STREAM_POLL_TIMEOUT_MS,
    STDERR_MAX_LENGTH,
    MAX_BUFFER_BYTES,
    PROBE_TIMEOUT_MS,
    MAX_WEB_RESTART_ATTEMPTS,
    PHASE,
    PROGRESS
};