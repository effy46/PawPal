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

> Design note: I personally love Line Dog, so new updates are designed around the Line Dog style, including new actions, thought bubbles, and text styling.

### Features

- **Break reminders** — timed nudges to get up and move; the dog can run across your screen to get your attention
- **Hydration reminders** — gentle prompts to drink water
- **Focus mode** — detects your active app; if you drift into social media, the dog nudges you back to work
- **Agent activity** — White Line Dog watches Codex session logs; Xiao Ji Mao watches Claude Code transcripts. PawPal summarizes active chats, file reads, searches, edits, tool calls, and web searches in the same thought-bubble UI; double-click a task bubble to jump to the matching agent chat
- **Resizable desktop pet** — hover the lower-right corner of the pet window to reveal a resize handle, then drag to make PawPal bigger or smaller
- **Multiple pet styles** — includes White Line Dog, Xiao Ji Mao, Golden Puppy, and custom GIF uploads for each pet state
- **Settings dashboard** — tracks today's breaks, waters, focus minutes, and distraction warnings, with runtime diagnostics for agent activity and focus detection
- **System controls** — launch-at-login, manual or startup update checks, configurable reminder timing, blocked apps, and blocked keywords
- **Chinese / English UI**
- **Local-first data** — settings and stats stay on your machine; PawPal only contacts GitHub Releases when you check for updates manually or enable update checks on launch

### Reminder Timing

Break and hydration reminders count active desk time. When the Mac locks or sleeps, PawPal clears the current reminder countdown; after unlock or wake, the countdown starts again from the full interval. This avoids stale reminders firing immediately after you step away, commute, or log back in.

### What's New

- Xiao Ji Mao can now connect to Claude Code activity
- White Line Dog remains linked to Codex status
- Agent bubbles and chat cards can jump back to the matching Codex or Claude Code chat
- Agent status bubbles use clearer text color for better readability
- Release builds now include a Windows `.exe` installer

### Install

Download the latest installer from [Releases](../../releases):

| File | Platform |
|------|----------|
| `PawPal-0.3.0-effy.2-arm64.dmg` | macOS Apple Silicon |
| `PawPal-0.3.0-effy.2.dmg` | macOS Intel / universal build |
| `PawPal-0.3.0-effy.2-setup-x64.exe` | Windows 64-bit |

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
> **Windows**: download the `.exe` installer from Releases. Distraction detection is not supported yet; the rest of the app works normally. Unsigned Windows builds may show a SmartScreen warning.

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

After the build finishes, run the generated `dist/PawPal.Setup.*.exe`. Windows packages are best built on Windows; building them on macOS may require Wine.

### Build

```bash
pnpm test         # run logic tests
pnpm build        # type-check and build
pnpm dist         # build and package macOS + Windows
pnpm dist:mac     # package macOS only
pnpm dist:win     # package Windows only; on macOS this may require Wine
```

Release builds are produced by GitHub Actions on native runners: macOS artifacts are built on `macos-latest`, and the Windows `.exe` is built on `windows-latest`. Pushing a `v*` tag creates a draft GitHub Release with all installers attached.

### Agent Activity Bridge

PawPal can reflect live coding-agent work directly in the pet UI. White Line Dog is linked to Codex status; Xiao Ji Mao is linked to Claude Code status. When an agent is active, the pet shows a compact status badge; hover it for a manga-style thought bubble with the current chat summary.

If several chats are active, PawPal groups them behind a count badge that can expand into separate chat cards. Agent bubbles and chat cards can open the matching Codex or Claude Code chat. Break, hydration, and focus reminders still take priority, so health nudges never get buried behind coding status.

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

- [ ] More built-in pet styles, including Chiikawa
- [ ] Sound effects
- [ ] Windows distraction detection
- [ ] Slack linkage
- [ ] Calendar-aware Pomodoro mode with meeting countdowns and auto-muted reminders

### License

Source code is released under the [MIT License](LICENSE). Pet animation assets have separate licensing; see [ASSET_LICENSE.md](ASSET_LICENSE.md).

---

## 中文

PawPal 是一款支持 macOS 和 Windows 的桌面宠物应用。一只透明、始终置顶的小狗会陪在屏幕上，提醒你休息、喝水，并帮助你保持专注。

> 设计说明：因为我本人喜欢线条小狗，所以所有更新都是围绕线条小狗来制作的，包括新动作、思考内容泡泡🫧和文字 style。

### 功能

- **休息提醒** — 按设定时间提醒你站起来活动；小狗可以跑过屏幕来吸引注意
- **喝水提醒** — 温和提醒你补充水分
- **专注模式** — 检测当前使用的应用；如果你切到社交媒体，小狗会提醒你回到工作状态
- **Agent 状态** — 白色线条小狗读取 Codex 会话日志；小鸡毛读取 Claude Code 记录，并用同一套思考泡泡显示活跃聊天、读文件、搜索、改文件、调用工具和网页搜索；双击任务泡泡可跳转到对应的 Agent 对话
- **桌宠大小调整** — 鼠标移到宠物窗口右下角会出现调整手柄，拖动即可放大或缩小 PawPal
- **多种宠物外观** — 包含白色线条小狗、小鸡毛、金毛 puppy，也支持为每个宠物状态上传自定义 GIF
- **设置仪表盘** — 记录当天休息、喝水、专注分钟和分心提醒次数，并提供 Agent 状态与专注检测运行诊断
- **系统控制** — 支持开机自启、手动或启动时检查更新、提醒时间配置、分心应用和关键词配置
- **中文 / English 界面**
- **本地优先** — 设置和统计数据保存在本机；只有手动检查更新或开启启动时检查更新时，PawPal 才会访问 GitHub Releases

### 提醒计时

休息和喝水提醒按实际桌面使用时间计时。Mac 锁屏或进入睡眠时，PawPal 会清空当前提醒倒计时；解锁或唤醒后，倒计时会从完整间隔重新开始。这样你短暂离开、合盖通勤或重新登录后，不会立刻收到已经过期的提醒。

### 本次更新

- 小鸡毛现在可以连接 Claude Code 状态
- 白色线条小狗继续对应 Codex 状态
- Agent 状态泡泡和聊天卡片可以跳回对应的 Codex 或 Claude Code 聊天
- Agent 状态泡泡文字颜色更清晰，阅读性更好
- Release 现在包含 Windows `.exe` 安装包

### 安装

从 [Releases](../../releases) 下载对应平台的安装包：

| 文件 | 适用设备 |
|------|----------|
| `PawPal-0.3.0-effy.2-arm64.dmg` | macOS Apple Silicon |
| `PawPal-0.3.0-effy.2.dmg` | macOS Intel / universal build |
| `PawPal-0.3.0-effy.2-setup-x64.exe` | Windows 64 位 |

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
> **Windows**：从 Releases 下载 `.exe` 安装包即可。分心检测目前仍不支持 Windows，其余功能可正常使用。未签名的 Windows 构建可能会触发 SmartScreen 提示。

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

构建完成后，运行生成的 `dist/PawPal.Setup.*.exe` 安装。Windows 安装包建议在 Windows 机器上构建；如果在 macOS 上构建，可能需要额外安装 Wine。

### 构建

```bash
pnpm test         # 运行逻辑测试
pnpm build        # 类型检查并构建
pnpm dist         # 构建并打包 macOS + Windows
pnpm dist:mac     # 仅打包 macOS
pnpm dist:win     # 仅打包 Windows；在 macOS 上可能需要 Wine
```

正式发布包由 GitHub Actions 在原生 runner 上构建：macOS 安装包由 `macos-latest` 构建，Windows `.exe` 由 `windows-latest` 构建。推送 `v*` tag 后会自动创建带全部安装包附件的 draft GitHub Release。

### Agent 状态联动

PawPal 可以把 coding agent 的工作状态直接显示在桌宠 UI 里。白色线条小狗对应 Codex 状态，小鸡毛对应 Claude Code 状态。Agent 活跃时，桌宠会显示一个简洁的状态徽标；鼠标悬停可用漫画风思考泡泡查看当前聊天摘要。

如果多个聊天同时活跃，PawPal 会先显示数量徽标，点击后展开为独立聊天卡片。Agent 状态泡泡和聊天卡片可以跳回对应的 Codex 或 Claude Code 聊天。休息、喝水和专注提醒仍然优先显示，所以健康提醒不会被编码状态挡住。

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

- [ ] 更多内置宠物外观，包括 Chiikawa
- [ ] 声音效果
- [ ] Windows 分心检测
- [ ] Slack 联动
- [ ] 日历感知的番茄钟模式，包含会议倒计时和提醒自动静音

### 许可

源代码基于 [MIT License](LICENSE) 发布。宠物动画素材有单独的授权说明，详见 [ASSET_LICENSE.md](ASSET_LICENSE.md)。
