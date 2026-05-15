<p align="center">
  <img src="docs/social-preview.png" alt="PawPal" width="800" />
</p>

<h1 align="center">PawPal</h1>

<p align="center">
  A tiny desktop dog that helps you pause, hydrate, and stay focused.
</p>

<p align="center">
  <img alt="Downloads" src="https://img.shields.io/github/downloads/zebangeth/PawPal/total?style=flat-square&label=downloads" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-vite-47848f?style=flat-square&logo=electron&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=111111" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" />
</p>

<p align="center">
  <a href="#english">English</a> · <a href="#中文">中文</a>
</p>

## English

PawPal is a desktop pet app for macOS and Windows. A transparent, always-on-top dog lives on your screen and gently reminds you to take breaks, drink water, and stay focused.

### Features

- **Break reminders** — timed nudges to get up and move; the dog can run across your screen to get your attention
- **Hydration reminders** — gentle prompts to drink water
- **Focus mode** — detects your active app; if you drift into social media, the dog nudges you back to work
- **Codex activity** — watches Codex session logs, summarizes multiple active chats, and shows idle, working, reviewing, complete, waiting, or error states
- **Multiple pet styles** — currently includes a line-drawing dog and a golden retriever puppy
- **Chinese / English UI**
- **Local-first data** — settings and stats stay on your machine; PawPal only contacts GitHub Releases when you check for updates manually or enable update checks on launch

### Reminder Timing

Break and hydration reminders count active desk time. When the Mac locks or sleeps, PawPal clears the current reminder countdown; after unlock or wake, the countdown starts again from the full interval. This avoids stale reminders firing immediately after you step away, commute, or log back in.

### Install

Download the latest installer from [Releases](../../releases):

| File | Platform |
|------|----------|
| `PawPal-x.x.x-arm64.dmg` | macOS Apple Silicon |
| `PawPal-x.x.x-x64.dmg` | macOS Intel |
| `PawPal.Setup.x.x.x.exe` | Windows 64-bit |

> **macOS**: On first launch, macOS may say the developer cannot be verified. Allow the app in System Settings -> Privacy & Security. Focus distraction detection also requires Accessibility permission.
>
> If you share a locally built `.dmg` without Apple Developer ID signing and notarization, another Mac may block launch. After dragging PawPal to `/Applications`, run:
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/PawPal.app
> open /Applications/PawPal.app
> ```
>
> To make a `.dmg` that opens cleanly for other people, sign it with an Apple Developer ID certificate and submit it for Apple notarization.
>
> **Windows**: distraction detection is not supported yet; the rest of the app works normally.

### Run From Source

Source builds require Node.js 20+ and pnpm 9. Corepack is recommended:

```bash
corepack enable
git clone https://github.com/zebangeth/PawPal.git
cd PawPal
pnpm install
pnpm dev
```

If `corepack enable` does not have permission to install shims, install pnpm 9 another way and verify that `pnpm --version` works.

### Install From Source

After cloning the repo, use these steps to install PawPal as a desktop app instead of running the dev server.

**macOS**

```bash
corepack enable
pnpm install
pnpm dist:mac
open dist/PawPal-*.dmg
```

Open the `.dmg`, then drag `PawPal.app` into `/Applications`. If macOS blocks a local unsigned build:

```bash
xattr -dr com.apple.quarantine /Applications/PawPal.app
open /Applications/PawPal.app
```

**Windows**

```bash
corepack enable
pnpm install
pnpm dist:win
```

After the build finishes, run `dist/PawPal.Setup.x.x.x.exe`. Windows packages are best built on Windows; building them on macOS may require Wine.

### Build

```bash
pnpm test         # run logic tests
pnpm build        # type-check and build
pnpm dist         # build and package macOS + Windows
pnpm dist:mac     # package macOS only
pnpm dist:win     # package Windows only; on macOS this may require Wine
```

### Codex Activity Bridge

While PawPal is running, it watches Codex session logs under `~/.codex/sessions`, infers `idle`, `working`, `reviewing`, `complete`, `waiting`, and `error`, and mirrors the current state to `~/.codex/pawpal/activity.json`.

When multiple Codex chats are active, PawPal first shows a small count badge. Click it to expand separate status cards for each chat. Break, hydration, and focus reminders always take priority over Codex status UI.

You can still write this shape manually to test the companion:

```json
{
  "state": "working",
  "message": "Editing files",
  "updatedAt": 1778785200000,
  "source": "manual"
}
```

Supported `state` values: `idle`, `working`, `reviewing`, `complete`, `waiting`, `error`.

### Tech Stack

- Electron + electron-vite
- React 19 + TypeScript
- electron-store for local persistence
- electron-builder for packaging

### Project Structure

```text
src/main/       Main process: windows, tray menus, timers, persistence, focus detection, updates
src/preload/    IPC bridge
src/renderer/   React UI for the pet window and settings window
src/shared/     Shared types, defaults, i18n, and pet appearance definitions
tests/          Logic tests
pet_assets/     Pet animation assets (GIF)
```

### Roadmap

- [ ] More pet styles
- [ ] Sound effects
- [ ] Windows distraction detection
- [ ] Better multi-display support

### License

Source code is released under the [MIT License](LICENSE). Pet animation assets have separate licensing; see [ASSET_LICENSE.md](ASSET_LICENSE.md).

---

## 中文

PawPal 是一款支持 macOS 和 Windows 的桌面宠物应用。一只透明、始终置顶的小狗会陪在屏幕上，提醒你休息、喝水，并帮助你保持专注。

### 功能

- **休息提醒** — 按设定时间提醒你站起来活动；小狗可以跑过屏幕来吸引注意
- **喝水提醒** — 温和提醒你补充水分
- **专注模式** — 检测当前使用的应用；如果你切到社交媒体，小狗会提醒你回到工作状态
- **Codex 状态** — 自动读取 Codex 会话日志，汇总多个活跃聊天，并显示 idle、working、reviewing、complete、waiting、error 状态
- **多种宠物外观** — 目前包含线条小狗和金毛幼犬两种风格
- **中文 / English 界面**
- **本地优先** — 设置和统计数据保存在本机；只有手动检查更新或开启启动时检查更新时，PawPal 才会访问 GitHub Releases

### 提醒计时

休息和喝水提醒按实际桌面使用时间计时。Mac 锁屏或进入睡眠时，PawPal 会清空当前提醒倒计时；解锁或唤醒后，倒计时会从完整间隔重新开始。这样你短暂离开、合盖通勤或重新登录后，不会立刻收到已经过期的提醒。

### 安装

从 [Releases](../../releases) 下载对应平台的安装包：

| 文件 | 适用设备 |
|------|----------|
| `PawPal-x.x.x-arm64.dmg` | macOS Apple Silicon |
| `PawPal-x.x.x-x64.dmg` | macOS Intel |
| `PawPal.Setup.x.x.x.exe` | Windows 64 位 |

> **macOS**：首次打开时，系统可能提示“无法验证开发者”。请到“系统设置 -> 隐私与安全性”中允许打开。专注模式的分心检测还需要授予“辅助功能”权限。
>
> 如果安装包是本地构建并直接分享的版本，没有 Apple Developer ID 签名和 Apple 公证，另一台 Mac 可能会阻止启动。把 `PawPal.app` 拖到 `/Applications` 后，可以运行：
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/PawPal.app
> open /Applications/PawPal.app
> ```
>
> 如果希望分享出去的 `.dmg` 可以直接双击打开，需要使用 Apple Developer ID 证书签名，并提交 Apple 公证。
>
> **Windows**：分心检测暂不支持 Windows；其他功能可以正常使用。

### 从源码运行

源码运行需要 Node.js 20+ 和 pnpm 9。推荐使用 Corepack：

```bash
corepack enable
git clone https://github.com/zebangeth/PawPal.git
cd PawPal
pnpm install
pnpm dev
```

如果 `corepack enable` 没有权限安装命令入口，可以用其他方式安装 pnpm 9，并确认 `pnpm --version` 可以正常运行。

### 从源码安装为桌面应用

如果你从源码克隆项目，并希望把 PawPal 安装到系统中作为桌面应用，而不是只在开发模式下运行，可以按下面步骤操作。

**macOS**

```bash
corepack enable
pnpm install
pnpm dist:mac
open dist/PawPal-*.dmg
```

打开 `.dmg` 后，把 `PawPal.app` 拖到 `/Applications`。如果 macOS 阻止打开本地未签名的构建版本：

```bash
xattr -dr com.apple.quarantine /Applications/PawPal.app
open /Applications/PawPal.app
```

**Windows**

```bash
corepack enable
pnpm install
pnpm dist:win
```

构建完成后，运行 `dist/PawPal.Setup.x.x.x.exe` 安装。Windows 安装包建议在 Windows 机器上构建；如果在 macOS 上构建，可能需要额外安装 Wine。

### 构建

```bash
pnpm test         # 运行逻辑测试
pnpm build        # 类型检查并构建
pnpm dist         # 构建并打包 macOS + Windows
pnpm dist:mac     # 仅打包 macOS
pnpm dist:win     # 仅打包 Windows；在 macOS 上可能需要 Wine
```

### Codex 状态联动

PawPal 运行时会自动读取 `~/.codex/sessions` 里的 Codex 会话日志，推断 `idle`、`working`、`reviewing`、`complete`、`waiting`、`error` 状态，并同步写入 `~/.codex/pawpal/activity.json`。

当多个 Codex 聊天同时活跃时，PawPal 会先显示一个数量徽标；点击徽标可以展开每个聊天的独立状态卡片。休息、喝水和专注提醒始终优先于 Codex 状态界面。

你也可以手动写入下面的内容来测试桌宠动画：

```json
{
  "state": "working",
  "message": "Editing files",
  "updatedAt": 1778785200000,
  "source": "manual"
}
```

支持的 `state`：`idle`、`working`、`reviewing`、`complete`、`waiting`、`error`。

### 技术栈

- Electron + electron-vite
- React 19 + TypeScript
- electron-store 用于本地持久化
- electron-builder 用于打包分发

### 项目结构

```text
src/main/       主进程：窗口管理、托盘菜单、定时器、持久化、专注检测、更新检查
src/preload/    IPC 桥接层
src/renderer/   React UI：宠物窗口和设置窗口
src/shared/     共享类型、默认配置、i18n、宠物外观定义
tests/          逻辑测试
pet_assets/     宠物动画素材（GIF）
```

### 开发路线

- [ ] 更多宠物外观
- [ ] 声音效果
- [ ] Windows 分心检测
- [ ] 优化多显示器支持

### 许可

源代码基于 [MIT License](LICENSE) 发布。宠物动画素材有单独的授权说明，详见 [ASSET_LICENSE.md](ASSET_LICENSE.md)。
