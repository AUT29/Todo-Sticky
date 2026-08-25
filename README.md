# Todo Sticky

Todo Sticky 是一个 Windows 桌面待办便签应用。它用 Tauri 打包，界面轻量，适合把每天的待办、延期待办、时间段计划和时间轴总结放在桌面边上随手记录。

## 功能

- 日期和时间段待办：支持为某一天或一段时间创建待办块。
- 优先级分组：支持 P0、P1、P2 和延期待办。
- 拖拽排序：待办可以在同一天的分组里拖动调整。
- 详情记录：每条待办都可以填写详细情况，并支持粘贴图片。
- 时间轴总结：可以按日期范围记录阶段总结，支持预览、编辑、自动保存和图片。
- 历史查看：可以查看过去任意一天的计划。
- 账号同步：支持 Supabase 邮箱登录同步，方便多设备共享数据。
- 本地优先：桌面端会把数据保存在本机应用数据目录，并在同步时尽量避免覆盖本地未上传内容。

## 安装

正式安装包建议放在 GitHub Releases 中发布，不建议直接提交到源码仓库。

本项目当前的 Windows 安装包构建产物通常位于：

```powershell
src-tauri\target\release\bundle\nsis\Todo Sticky_0.1.0_x64-setup.exe
```

## 开发环境

需要安装：

- Node.js
- pnpm
- Rust
- Tauri 依赖环境

安装依赖：

```powershell
pnpm install
```

本地 Web 预览：

```powershell
pnpm run dev
```

桌面开发模式：

```powershell
pnpm tauri:dev
```

## 构建

普通前端构建：

```powershell
pnpm run build
```

构建 Windows 安装包：

```powershell
pnpm run build:installer
```

如果要构建带账号同步配置的安装包，需要提供 Supabase 项目配置：

```powershell
$env:TODO_STICKY_SUPABASE_URL="https://your-project.supabase.co"
$env:TODO_STICKY_SUPABASE_ANON_KEY="your-anon-key"
pnpm run build:installer
```

## Supabase

数据库表结构在：

```text
supabase/schema.sql
```

新建 Supabase 项目后，先执行该 SQL，再配置邮箱登录。源码中的 `src/cloud-config.js` 默认不包含云端配置，发布安装包时通过环境变量注入。

## 数据位置

桌面端本地数据保存在 Windows 用户应用数据目录中：

```text
C:\Users\<你的用户名>\AppData\Local\Todo Sticky
```

请不要在升级或重新安装时删除该目录，除非你明确想清空本地数据。

## 检查

常用检查命令：

```powershell
pnpm run check:desktop
cargo check --manifest-path src-tauri\Cargo.toml
```

`check:desktop` 会检查核心逻辑、同步安全、Supabase schema、发布规则和本地数据结构。
