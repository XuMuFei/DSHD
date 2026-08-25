// ── Source directory management ───────────────────────────────────────────

const { createHash } = require('node:crypto');
const { existsSync, globSync, mkdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const { EXPECTED_PACKAGE_NAME, BUILD_RECORD_PATH, CLIENT_ARTIFACT_PATTERNS, GIT_CLONE_URL } = require('./constants');
const state = require('./state');
const { runFile, runGitClone } = require('./process-manager');

// ── Settings ──────────────────────────────────────────────────────────────

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

// ── Default clone location ─────────────────────────────────────────────────

/**
 * Returns the default deepseek-harness clone directory.
 * Uses app.getPath('userData') (e.g. %APPDATA%/DSHD/) so that it works
 * in both development and packaged (ASAR) builds — the ASAR is read-only
 * and app.getAppPath() points to the archive itself, not a writable folder.
 */
function defaultCloneDir() {
    return path.join(app.getPath('userData'), 'deepseek-harness');
}

async function cloneHarness() {
    const targetDir = defaultCloneDir();
    await runGitClone(GIT_CLONE_URL, targetDir, app.getPath('userData'));
    const validation = validateSourceDir(targetDir);
    if (!validation.valid) throw new Error(`克隆完成但验证失败：${validation.error}`);
    saveSourceDir(validation.sourceDir);
    return validation.sourceDir;
}

// ── Validation ────────────────────────────────────────────────────────────

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
            return {
                valid: false,
                error: `所选目录不是 DeepSeek Harness 源码仓库（package.json 的 name 应为 "${EXPECTED_PACKAGE_NAME}"，实际为 "${manifest.name ?? '未定义'}"）。请选择正确的 deepseek-harness 源码目录。`
            };
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { valid: false, error: `无法读取所选目录的 package.json：${detail}` };
    }
    if (!existsSync(path.join(resolved, '.git'))) {
        return { valid: false, error: '所选目录不是 Git 工作区（缺少 .git），请选择 deepseek-harness 的 Git 克隆目录。' };
    }
    return { valid: true, sourceDir: resolved };
}

function preferredSourceDir() {
    const settings = readSettings();
    const candidates = [
        process.env.DSH_SOURCE_DIR,
        settings.sourceDir,
        defaultCloneDir()
    ];
    for (const candidate of candidates) {
        const result = validateSourceDir(candidate);
        if (result.valid) return result.sourceDir;
    }
    return '';
}

/**
 * Check if the default clone dir exists and is valid.
 * Returns the sourceDir if valid, empty string otherwise.
 */
function preferredDefaultCloneDir() {
    const result = validateSourceDir(defaultCloneDir());
    return result.valid ? result.sourceDir : '';
}

// ── Build record ──────────────────────────────────────────────────────────

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

// ── Source inspection ────────────────────────────────────────────────────

async function inspectSource(candidate) {
    const validation = validateSourceDir(candidate);
    if (!validation.valid) return validation;

    const selectedSourceDir = validation.sourceDir;
    const hasDependencies = existsSync(path.join(selectedSourceDir, 'node_modules', '.pnpm'));
    const buildRecord = readBuildRecord(selectedSourceDir);

    // Cache currentCommit to avoid spawning git on every call
    let currentCommit;
    if (state.cachedSourceDir === selectedSourceDir && state.cachedCommit) {
        currentCommit = state.cachedCommit;
    } else {
        try {
            const result = await runFile('git.exe', ['rev-parse', '--short=7', 'HEAD'], selectedSourceDir);
            currentCommit = result.stdout.trim().toLowerCase();
            state.cachedCommit = currentCommit;
            state.cachedSourceDir = selectedSourceDir;
        } catch {
            currentCommit = undefined;
        }
    }

    // Cache digest: only compute when build record exists and commit matches
    let digest;
    const cacheKey = `${selectedSourceDir}:${currentCommit}`;
    if (buildRecord && currentCommit && buildRecord.commit === currentCommit) {
        digest = clientArtifactDigest(selectedSourceDir);
    }

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

module.exports = {
    validateSourceDir,
    preferredSourceDir,
    preferredDefaultCloneDir,
    defaultCloneDir,
    cloneHarness,
    saveSourceDir,
    inspectSource,
    readBuildRecord,
    clientArtifactDigest
};