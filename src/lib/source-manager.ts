// ── Source directory management ───────────────────────────────────────────

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import { app } from 'electron';

import {
    EXPECTED_PACKAGE_NAME, BUILD_RECORD_PATH, CLIENT_ARTIFACT_PATTERNS,
    DEV_SOURCE_DIR, GIT_CLONE_URL
} from './constants';
import { state } from './state';
import type { SourceInspection, BuildRecord, ClientArtifactDigest } from './types';
import { runFile, runGitClone } from './process-manager';

// ── Settings ──────────────────────────────────────────────────────────────

function settingsPath(): string {
    return path.join(app.getPath('userData'), 'settings.json');
}

interface Settings {
    sourceDir?: string;
}

function readSettings(): Settings {
    try {
        return JSON.parse(readFileSync(settingsPath(), 'utf8')) as Settings;
    } catch {
        return {};
    }
}

export function saveSourceDir(selectedSourceDir: string): void {
    const file = settingsPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ sourceDir: selectedSourceDir }, null, 4)}\n`, 'utf8');
}

export function defaultCloneDir(): string {
    return path.join(app.getPath('userData'), 'deepseek-harness');
}

export async function cloneHarness(): Promise<string> {
    if (!app.isPackaged) {
        throw new Error(`开发模式固定使用源码目录：${DEV_SOURCE_DIR}，不会自动克隆。`);
    }
    const targetDir = defaultCloneDir();
    await runGitClone(GIT_CLONE_URL, targetDir, app.getPath('userData'));
    const validation = validateSourceDir(targetDir);
    if (!validation.valid || !validation.sourceDir) {
        throw new Error(`克隆完成但验证失败：${validation.error || '源码目录无效'}`);
    }
    saveSourceDir(validation.sourceDir);
    return validation.sourceDir;
}

// ── Validation ────────────────────────────────────────────────────────────

interface ValidationResult {
    valid: boolean;
    sourceDir?: string;
    error?: string;
}

function validateSourceDir(candidate: unknown): ValidationResult {
    if (typeof candidate !== 'string' || candidate.trim() === '') {
        return { valid: false, error: '请选择 deepseek-harness 源码目录。' };
    }
    const resolved = path.resolve(candidate.trim());
    const packagePath = path.join(resolved, 'package.json');
    if (!existsSync(packagePath)) {
        return { valid: false, error: '所选目录中没有 package.json。' };
    }
    try {
        const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: string };
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

export function preferredSourceDir(): string {
    if (!app.isPackaged) {
        const result = validateSourceDir(DEV_SOURCE_DIR);
        return result.valid && result.sourceDir ? result.sourceDir : '';
    }
    const settings = readSettings();
    const candidates = [
        process.env['DSH_SOURCE_DIR'],
        settings.sourceDir
    ];
    for (const candidate of candidates) {
        const result = validateSourceDir(candidate);
        if (result.valid && result.sourceDir) return result.sourceDir;
    }
    return '';
}

export function preferredDefaultCloneDir(): string {
    const result = validateSourceDir(defaultCloneDir());
    return result.valid && result.sourceDir ? result.sourceDir : '';
}

// ── Build record ──────────────────────────────────────────────────────────

export function clientArtifactDigest(selectedSourceDir: string): ClientArtifactDigest | undefined {
    const patterns = [...CLIENT_ARTIFACT_PATTERNS];
    const paths = globSync(patterns, { cwd: selectedSourceDir })
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

export function readBuildRecord(selectedSourceDir: string): BuildRecord | undefined {
    const recordPath = path.join(selectedSourceDir, BUILD_RECORD_PATH);
    if (!existsSync(recordPath)) return undefined;
    try {
        const record = JSON.parse(readFileSync(recordPath, 'utf8')) as BuildRecord;
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
        return {
            formatVersion: 1,
            environment: { DSH_CLIENT_COMMIT_HASH: commit.toLowerCase() },
            artifacts: { fileCount, sha256 }
        };
    } catch {
        return undefined;
    }
}

// ── Source inspection ────────────────────────────────────────────────────

export async function inspectSource(candidate: unknown): Promise<SourceInspection> {
    const validation = validateSourceDir(candidate);
    if (!validation.valid) return validation;

    const selectedSourceDir = validation.sourceDir!;
    const hasDependencies = existsSync(path.join(selectedSourceDir, 'node_modules', '.pnpm'));
    const buildRecord = readBuildRecord(selectedSourceDir);

    // Cache currentCommit to avoid spawning git on every call
    let currentCommit: string | undefined;
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
    let digest: ClientArtifactDigest | undefined;
    if (buildRecord && currentCommit && buildRecord.environment.DSH_CLIENT_COMMIT_HASH === currentCommit) {
        digest = clientArtifactDigest(selectedSourceDir);
    }

    const hasCurrentBuild = buildRecord !== undefined
        && currentCommit !== undefined
        && buildRecord.environment.DSH_CLIENT_COMMIT_HASH === currentCommit
        && digest !== undefined
        && buildRecord.artifacts.fileCount === digest.fileCount
        && buildRecord.artifacts.sha256 === digest.sha256;

    return {
        valid: true,
        sourceDir: selectedSourceDir,
        hasDependencies,
        hasCurrentBuild,
        artifactCount: buildRecord?.artifacts.fileCount,
        buildCommit: buildRecord?.environment.DSH_CLIENT_COMMIT_HASH,
        currentCommit,
        ready: hasDependencies && hasCurrentBuild
    };
}

export { validateSourceDir };
