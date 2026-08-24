# DSH Desktop

Windows Electron 客户端，用于启动本机 `deepseek-harness` Web 服务并加载
`http://127.0.0.1:3080/`。

## 使用

```powershell
pnpm install
pnpm start
```

启动后选择 `deepseek-harness` 源码目录。客户端检查：

- `node_modules\.pnpm`：pnpm 工作区依赖是否存在。
- `.dsh-build\client-build-environment.json`：完整构建是否成功，构建提交是否与当前
  `HEAD` 一致，并且记录的产物数量和 SHA-256 是否与实际产物一致。

两项均有效时直接执行 `pnpm dsh web --no-open`。任一项无效时依次执行：

```powershell
pnpm install
pnpm run build
pnpm dsh web --no-open
```

进入 Web 界面后，通过顶部的“检查更新”按钮手动执行 Git 更新检查。发现新提交并确认更新后，
客户端会快进同步源码、重新安装依赖、构建并重启 Web 服务。

生成 Windows 安装程序：

```powershell
npm run dist
```
