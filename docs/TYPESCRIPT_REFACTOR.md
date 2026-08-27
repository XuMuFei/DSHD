# TypeScript 重构文档

## 一、重构目标

将 DSH Desktop 项目从 JavaScript 迁移到 TypeScript，提升代码质量和可维护性。

### 收益

- **类型安全**：编译期捕获类型错误，减少运行时 bug
- **IDE 支持**：自动补全、重构、跳转定义
- **接口契约**：IPC 通信、状态管理有明确类型约束
- **代码可维护性**：大型项目更易理解和修改

## 二、迁移策略

采用**渐进式迁移**策略，从简单模块开始，逐步迁移复杂模块。

### 迁移顺序

| 阶段 | 模块 | 复杂度 | 预估时间 |
|------|------|--------|----------|
| 1 | 项目配置 | - | 2h |
| 2 | `constants.ts` | 低 | 0.5h |
| 3 | `state.ts` | 低 | 1h |
| 4 | `utils.ts` | 低 | 1h |
| 5 | `source-manager.ts` | 中 | 2h |
| 6 | `git-updater.ts` | 中 | 2h |
| 7 | `ipc-handlers.ts` | 中 | 2h |
| 8 | `process-manager.ts` | 高 | 4h |
| 9 | `main.ts` | 中 | 2h |
| 10 | `preload.ts` | 低 | 0.5h |
| 11 | `renderer.ts` | 中 | 3h |
| 12 | 测试验证 | - | 4h |

**总计：约 4 个工作日**

## 三、项目结构

### 重构前

```
DSH-Desktop/
├── main.js
├── preload.js
├── renderer.js
├── lib/
│   ├── constants.js
│   ├── state.js
│   ├── utils.js
│   ├── source-manager.js
│   ├── git-updater.js
│   ├── ipc-handlers.js
│   └── process-manager.js
└── package.json
```

### 重构后

```
DSH-Desktop/
├── src/
│   ├── main.ts
│   ├── preload.ts
│   ├── renderer.ts
│   └── lib/
│       ├── constants.ts
│       ├── state.ts
│       ├── utils.ts
│       ├── source-manager.ts
│       ├── git-updater.ts
│       ├── ipc-handlers.ts
│       ├── process-manager.ts
│       └── types.ts
├── dist/                    # 编译输出
│   ├── main.js
│   ├── preload.js
│   ├── renderer.js
│   └── lib/
├── tsconfig.json
├── package.json
└── docs/
    └── TYPESCRIPT_REFACTOR.md
```

## 四、类型定义

### 核心接口

```typescript
// src/lib/types.ts

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
  | 'preparing'
  | 'checking'
  | 'updating'
  | 'installing'
  | 'building'
  | 'starting'
  | 'ready'
  | 'error';

/**
 * IPC 状态响应
 */
export interface IpcStateResponse extends SourceInspection {}

/**
 * IPC 启动响应
 */
export interface IpcStartResponse {
  url: string;
  sourceDir: string;
  built: boolean;
}

/**
 * IPC 更新检查响应
 */
export interface IpcCheckUpdateResponse extends PendingUpdate {}

/**
 * Web 服务探测结果
 */
export interface WebServerProbeResult {
  occupied: boolean;
  isDsh: boolean;
}
```

### IPC 通道类型

```typescript
// src/lib/types.ts

/**
 * IPC 通道定义
 */
export interface IpcChannels {
  'desktop:get-info': () => DesktopInfo;
  'desktop:get-logs': () => string[];
  'desktop:clear-logs': () => string[];
  'desktop:get-state': () => Promise<IpcStateResponse>;
  'desktop:select-source': () => Promise<SourceInspection | { canceled: true }>;
  'desktop:start': (sourceDir: string) => Promise<IpcStartResponse>;
  'desktop:check-update': () => Promise<IpcCheckUpdateResponse>;
  'desktop:apply-update': () => Promise<IpcStartResponse>;
}

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
```

## 五、配置文件

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "allowJs": false,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "release"]
}
```

### package.json scripts

```json
{
  "scripts": {
    "build:ts": "tsc",
    "build:ts:watch": "tsc --watch",
    "copy:static": "node scripts/copy-static.js",
    "build": "npm run build:ts && npm run copy:static",
    "start": "electron ./dist/main.js",
    "dist": "npm run build && electron-builder --win nsis --config.directories.output=release",
    "dist:mac": "npm run build && electron-builder --mac dmg --config.directories.output=release",
    "typecheck": "tsc --noEmit"
  }
}
```

## 六、迁移步骤

### 步骤 1：项目初始化

```bash
# 安装 TypeScript 和类型定义
pnpm add -D typescript @types/node

# 创建目录结构
mkdir -p src/lib

# 创建配置文件
touch tsconfig.json
```

### 步骤 2：迁移 constants.ts

```typescript
// src/lib/constants.ts

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

export const PROGRESS = {
    PREPARE: 5,
    INSTALL: 18,
    BUILD: 55,
    START: 84,
    DONE: 100
} as const;
```

### 步骤 3：迁移 state.ts

```typescript
// src/lib/state.ts

import type { BrowserWindow } from 'electron';
import type { ChildProcess } from 'node:child_process';
import type { AppState, PendingUpdate } from './types';

// 内部状态变量
let mainWindow: BrowserWindow | null = null;
let sourceDir = '';
let webProcess: ChildProcess | null = null;
let activeCommandProcess: ChildProcess | null = null;
let activeProcesses = new Set<ChildProcess>();
let webProcessSourceDir: string | undefined = undefined;
let webProcessOwned = false;
let activeOperation: string | null = null;
let pendingUpdate: PendingUpdate | null = null;
let expectedWebStop = false;
let webExitMessage: string | undefined = undefined;
let quitting = false;
let cleanupComplete = false;
let cleanupStarted = false;
let commandLogs: string[] = [];
let webRestartAttempts = 0;
let cachedCommit: string | undefined = undefined;
let cachedSourceDir: string | undefined = undefined;

// 重置状态
function reset(): void {
    mainWindow = null;
    sourceDir = '';
    webProcess = null;
    activeCommandProcess = null;
    activeProcesses = new Set();
    webProcessSourceDir = undefined;
    webProcessOwned = false;
    activeOperation = null;
    pendingUpdate = null;
    expectedWebStop = false;
    webExitMessage = undefined;
    quitting = false;
    cleanupComplete = false;
    cleanupStarted = false;
    commandLogs = [];
    webRestartAttempts = 0;
    cachedCommit = undefined;
    cachedSourceDir = undefined;
}

// 导出状态访问器
export const state: AppState = {
    get mainWindow() { return mainWindow; },
    set mainWindow(v) { mainWindow = v; },

    get sourceDir() { return sourceDir; },
    set sourceDir(v) { sourceDir = v; },

    get webProcess() { return webProcess; },
    set webProcess(v) { webProcess = v; },

    get activeCommandProcess() { return activeCommandProcess; },
    set activeCommandProcess(v) { activeCommandProcess = v; },

    get activeProcesses() { return activeProcesses; },

    get webProcessSourceDir() { return webProcessSourceDir; },
    set webProcessSourceDir(v) { webProcessSourceDir = v; },

    get webProcessOwned() { return webProcessOwned; },
    set webProcessOwned(v) { webProcessOwned = v; },

    get activeOperation() { return activeOperation; },
    set activeOperation(v) { activeOperation = v; },

    get pendingUpdate() { return pendingUpdate; },
    set pendingUpdate(v) { pendingUpdate = v; },

    get expectedWebStop() { return expectedWebStop; },
    set expectedWebStop(v) { expectedWebStop = v; },

    get webExitMessage() { return webExitMessage; },
    set webExitMessage(v) { webExitMessage = v; },

    get quitting() { return quitting; },
    set quitting(v) { quitting = v; },

    get cleanupComplete() { return cleanupComplete; },
    set cleanupComplete(v) { cleanupComplete = v; },

    get cleanupStarted() { return cleanupStarted; },
    set cleanupStarted(v) { cleanupStarted = v; },

    get commandLogs() { return commandLogs; },
    set commandLogs(v) { commandLogs = v; },

    get webRestartAttempts() { return webRestartAttempts; },
    set webRestartAttempts(v) { webRestartAttempts = v; },

    get cachedCommit() { return cachedCommit; },
    set cachedCommit(v) { cachedCommit = v; },

    get cachedSourceDir() { return cachedSourceDir; },
    set cachedSourceDir(v) { cachedSourceDir = v; },
};

export { reset };
```

### 步骤 4：迁移 utils.ts

```typescript
// src/lib/utils.ts

import type { BrowserWindow } from 'electron';
import { MAX_LOG_LINES } from './constants';
import { state } from './state';

// 日志节流
let logThrottleTimer: NodeJS.Immediate | null = null;

function sendLogs(): void {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
    state.mainWindow.webContents.send('desktop:logs', state.commandLogs);
}

function scheduleLogFlush(): void {
    if (logThrottleTimer) return;
    logThrottleTimer = setImmediate(() => {
        logThrottleTimer = null;
        sendLogs();
    });
}

export function sendStatus(
    phase: string,
    message: string,
    progress: number | null = null
): void {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
    state.mainWindow.webContents.send('desktop:status', { phase, message, progress });
}

export function appendLog(kind: string, text: string): void {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const lines = String(text).replaceAll('\r', '').split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        state.commandLogs.push(`[${timestamp}] ${kind} ${line}`);
    }
    if (state.commandLogs.length > MAX_LOG_LINES) {
        state.commandLogs = state.commandLogs.slice(-MAX_LOG_LINES);
    }
    scheduleLogFlush();
}

export function clearLogBuffer(): void {
    state.commandLogs = [];
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        sendLogs();
    }
}

export function formatCommand(file: string, args: readonly string[]): string {
    return [file, ...args]
        .map((value) => /\s/u.test(value) ? `"${value}"` : value)
        .join(' ');
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message.replace(/^Error invoking remote method '[^']+': /, '');
    }
    return String(error);
}
```

## 七、验证清单

### 编译验证

- [ ] `pnpm run typecheck` 无错误
- [ ] `pnpm run build` 成功生成 dist 目录
- [ ] `pnpm run start` 应用正常启动

### 功能验证

- [ ] 选择源码目录
- [ ] 启动 Web 服务
- [ ] 检查更新
- [ ] 应用更新
- [ ] 托盘图标交互
- [ ] 窗口最小化到托盘
- [ ] 单实例锁
- [ ] 退出清理

### 打包验证

- [ ] Windows 安装包构建
- [ ] macOS DMG 构建（CI）

## 八、回滚方案

如果重构出现问题，可以快速回滚：

```bash
# 切回 master 分支
git checkout master

# 或删除重构分支
git branch -D refactor/typescript
```

## 九、参考资料

- [TypeScript 官方文档](https://www.typescriptlang.org/docs/)
- [Electron TypeScript 指南](https://www.electronjs.org/docs/latest/tutorial/typescript)
- [Node.js 类型定义](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node)
