<p align="center">
  <img src="develop/src-tauri/app-icon.svg" width="112" height="112" alt="OneTotp" />
</p>

<h1 align="center">OneTotp</h1>

<p align="center">
  <strong>纯离线身份验证器 · TOTP / HOTP</strong><br>
  <sub>密钥永不出本机，验证码按 RFC 4226 / RFC 6238 在本地计算。</sub>
</p>

<p align="center">
  <a href="https://github.com/Xiaoph123/OneTotp/releases/latest"><img src="https://img.shields.io/github/v/release/Xiaoph123/OneTotp?label=release&color=34D399" alt="Release"></a>
  <a href="https://github.com/Xiaoph123/OneTotp/releases"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-1664FF" alt="Platform"></a>
  <a href="https://github.com/Xiaoph123/OneTotp/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-22D3EE" alt="License"></a>
  <img src="https://img.shields.io/badge/Tauri-2-6366F1" alt="Tauri 2">
  <img src="https://img.shields.io/badge/React-19-61DAFB" alt="React 19">
</p>

<p align="center">
  <a href="#简体中文"><strong>简体中文</strong></a> · <a href="#english">English</a>
</p>

---

## 简体中文

> [!IMPORTANT]
> **离线是设计前提，不是可选项。** OneTotp 不发起任何网络请求、不接入云端同步、不含遥测与统计。你的账户密钥从头到尾只存在于本机，加密后落盘，解密只在内存中发生。

### 它是什么

一个把「两步验证」这件事做干净的桌面 / 移动端应用：把各家网站的 `otpauth://` 密钥收进来，按标准算法在本地算出 6~8 位验证码，复制、输入、完成。没有账号体系，没有服务器，没有「同步中」的转圈。

### 它不做什么

- ❌ **不联网**：无云端同步、无账号登录、无崩溃上报、无使用统计。
- ❌ **不托管密钥**：密钥不经过任何第三方，也不写入日志。
- ❌ **不申请多余权限**：Android 端仅申请相机（扫码）与网络（WebView 本地资源），相机权限为可选。

### 功能

| 能力 | 说明 |
| --- | --- |
| **TOTP / HOTP** | 完整实现 RFC 6238（TOTP）与 RFC 4226（HOTP），支持 `SHA1` / `SHA256` / `SHA512` 三种 HMAC 摘要 |
| **验证码位数与周期** | 支持 6 / 7 / 8 位；TOTP 周期 1~3600 秒可配（默认 30）；8 位验证码按 4+4 分组显示 |
| **实时进度环** | 卡片展示当前周期的剩余时间与进度，末 5 秒验证码转红提示，并预览「下一个验证码」 |
| **一键复制** | 点击卡片复制验证码，复制后短暂反馈；支持全局快捷键唤起主窗口 |
| **扫码录入** | 摄像头扫描二维码（`jsqr` 本地解析）或粘贴 `otpauth://` 链接，支持批量文本导入 |
| **分类管理** | 自建分类，每个分类可指定主题色；折叠时按分类色淡色高亮，账户可在分类间移动 |
| **搜索与收藏** | 按服务名 / 账户标识实时过滤；收藏账户优先排序 |
| **加密保险库** | AES-256-GCM 加密落盘，密钥由 Argon2id 从口令派生（16 字节随机 salt + 12 字节随机 nonce） |
| **锁定密码** | 可选启用解锁口令（至少 8 位），支持密码提示；也可仅靠机器本地密钥保护 |
| **自动锁定** | 空闲超时自动锁定；支持「仅启动时锁定」策略 |
| **加密备份** | 导出为独立口令加密的备份串（可选仅账户 / 仅配置）；导入时按 id 去重合并，不会覆盖已有账户 |
| **自动备份快照** | 每次写盘自动留存时间戳快照，可配置保留份数（最多 10 份），支持一键清理 |
| **截屏保护** | 桌面端启用后阻止窗口被截屏 / 录屏捕获 |
| **托盘与自启** | 桌面端支持最小化到托盘、关闭行为可选（退出 / 托盘）、开机自启 |
| **主题与语言** | 浅色 / 深色 / 跟随系统；界面字体缩放；中文 / English 双语 |
| **移动端适配** | 独立移动布局（`data-platform` 钩子），触控尺寸与交互按移动端重新校准 |

**状态细节**

- 验证码按期自动刷新，无需手动操作。
- 复制失败、导入解析为空等情况都有明确提示，**不会静默失败**。
- 应用未解锁时所有数据接口返回「应用未解锁」，内存中不保留任何明文。

### 界面语言

基于火山引擎 **源力（Volcengine）** 设计系统落地：主色 `#1664FF`，统一圆角 token（4 / 8 / 12 / 9999px），输入框三态（常态描边 → 悬停加深 → 聚焦蓝色描边 + 光晕），设置页分组标题采用源力竖条样式。

### 安全模型

```
        用户口令                 otpauth 密钥
            │                        │
      Argon2id 派生              （账户数据）
            │                        │
       256 位密钥 ──────► AES-256-GCM 加密 ──────► vault.json（密文落盘）
                                     │
                              salt(16B) + nonce(12B) 随机，随密文存储
```

| 环节 | 实现 |
| --- | --- |
| 密钥派生 | **Argon2id**（`argon2` crate 默认参数），每次生成 16 字节随机 salt |
| 加密 | **AES-256-GCM**（AEAD），每次写入生成 12 字节随机 nonce |
| 落盘 | 仅密文 + salt + nonce + 元数据（JSON），无明文密钥 |
| 运行期 | 解锁密钥仅存于内存（`Mutex<Option<[u8;32]>>`），锁定即清空 |
| 口令校验 | 独立 verifier（对 salt 派生的哈希），与保险库密钥分离 |
| 无口令模式 | 由设备指纹 + 固定 salt 经 Argon2 确定性派生「机器本地密钥」，防止明文落盘被直接读取 |
| 备份 | 导出时用**独立新口令**重新派生密钥加密，可跨设备迁移 |
| 输入校验 | 密钥（Base32）、位数（6/7/8）、算法、周期（1~3600s）、分类名（≤20 字符）均在服务端二次校验 |
| 颜色注入 | 分类色经正则规范化，非法值回退主题蓝，杜绝越界输入 |

> [!NOTE]
> 「机器本地密钥」用于**未设置解锁口令**的场景，其作用是避免密钥明文落盘，而非抵御能读取本机文件的攻击者。若设备可能被他人物理接触，请启用解锁口令。

### 下载

前往 **[Releases](https://github.com/Xiaoph123/OneTotp/releases/latest)** 获取最新版本。命名规则为 `OneTotp_{版本}_{系统}_{架构}-{类型}`。

| 平台 | 架构 | 产物 | 说明 |
| --- | --- | --- | --- |
| **Windows** | x64 / arm64 | `-setup.exe` | NSIS 安装包 |
| **Windows** | x64 / arm64 | `-portable.exe` | 免安装，双击即用 |
| **macOS** | x64 / arm64 / universal | `.dmg` | universal 为 Intel + Apple Silicon 二合一 |
| **Linux** | x86_64 / arm64 | `.deb` / `.rpm` / `.AppImage` | AppImage 免安装 |
| **Android** | arm64 / armv7 / x86 / x86_64 | `.apk` | arm64 覆盖绝大多数真机 |

> [!TIP]
> 32 位 Windows（x86）无产物——Tauri 2 框架本身不支持该目标平台，非配置遗漏。
> iOS 需 Apple 开发者账号（$99/年）签名，当前版本暂未发布 `.ipa`。

**首次安装提示**

- **macOS**：未签名分发包首次打开需右键 →「打开」，或执行 `xattr -dr com.apple.quarantine OneTotp.app`。
- **Windows**：SmartScreen 可能提示未知发布者，选择「更多信息 → 仍要运行」。
- **Android**：需在系统设置中允许安装来自该来源的应用。

### 从源码构建

| 工具 | 版本 |
| --- | --- |
| Node.js | ≥ 20（推荐 22） |
| Rust | stable |
| Tauri CLI | 2.x（随 `@tauri-apps/cli` 提供） |

Linux 另需：`libwebkit2gtk-4.1-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev`、`patchelf`、`build-essential`。

**桌面端**

```bash
cd develop
npm install
npm run tauri dev            # 开发调试
npm run tauri build          # 打包当前平台
```

**移动端（Android）**

```bash
cd develop
npm run tauri android init   # 首次生成工程
npm run tauri android build -- --apk --target aarch64
```

**全端自动构建**

仓库内置 [GitHub Actions](.github/workflows/release.yml)，推送 `v*` 标签即触发矩阵构建，覆盖 Windows / macOS / Linux / Android 多架构，并自动创建 Release。iOS 任务在配置 Apple 证书 Secrets 后自动启用，未配置时静默跳过。

### 项目结构

```text
OneTotp/
├─ .github/workflows/
│  └─ release.yml          # 全端构建矩阵
├─ develop/
│  ├─ src/                 # React 前端
│  │  ├─ components/       # 通用组件（标题栏、按钮、弹窗、Toast…）
│  │  ├─ pages/            # 页面（验证码、详情、设置、安全、导入导出…）
│  │  ├─ state/            # 应用状态、自动锁定、截屏保护
│  │  ├─ lib/              # API 封装、主题、平台、二维码、快捷键
│  │  ├─ i18n/             # 中英文案
│  │  └─ styles/           # 设计 token 与样式
│  └─ src-tauri/           # Rust 后端
│     ├─ src/
│     │  ├─ crypto.rs      # Argon2id 派生 + AES-256-GCM 加解密
│     │  ├─ totp.rs        # RFC 4226 / RFC 6238 算法实现
│     │  ├─ store.rs       # 保险库读写、备份、otpauth 解析
│     │  ├─ commands.rs    # Tauri 命令（账户 / 分类 / 设置 / 备份）
│     │  └─ models.rs      # 数据模型
│     └─ tauri.conf.json
└─ Design/                 # 设计稿
```

### 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面 / 移动外壳 | **Tauri 2**（Rust） |
| 前端 | **React 19** + **TypeScript** + **Vite 8** |
| 加密 | `aes-gcm` · `argon2` · `rand` |
| OTP 算法 | `hmac` · `sha1` · `sha2` · `base32` |
| 扫码 | `jsqr`（本地解析） |
| 设计系统 | 火山引擎源力（Volcengine） |

### 常见问题

**会不会把我的密钥上传到服务器？**

不会。OneTotp 没有服务器。你可以断网使用，功能完全一致——这是验证「纯离线」最直接的方式。

**换电脑怎么办？**

用「导出」功能生成加密备份串（**用独立口令加密**），在新设备「导入」即可。备份串可选只导出账户或只导出配置，导入按账户 id 去重，不会覆盖目标设备已有账户。

**忘记解锁口令了？**

无法找回。密钥由口令经 Argon2id 派生，口令即密钥，没有任何后门或重置通道——这是安全设计的必然代价。建议启用自动备份并异地保存。

**支持哪些导入格式？**

标准 `otpauth://` 链接（单条或每行一条批量）。主流验证器导出的二维码 / 链接均可识别。

**验证码位数不是 6 位？**

支持 6 / 7 / 8 位。8 位验证码会按 4+4 分组显示，便于核对与输入。

### 许可证

[MIT License](LICENSE)

### 反馈

欢迎通过 [GitHub Issues](https://github.com/Xiaoph123/OneTotp/issues) 提交问题与建议。反馈时请注明系统平台、架构与 OneTotp 版本号。

<p align="right"><a href="#english">English →</a></p>

---

## English

<p align="right"><a href="#简体中文">← 简体中文</a></p>

> [!IMPORTANT]
> **Offline by design, not by option.** OneTotp makes no network requests, has no cloud sync, and contains no telemetry or analytics. Your account secrets never leave your device — they are encrypted at rest and decrypted only in memory.

### What it is

A desktop and mobile app that does two-factor authentication properly: collect `otpauth://` secrets from any service, compute 6–8 digit codes locally using standard algorithms, copy, paste, done. No accounts, no servers, no "syncing…" spinner.

### What it does not do

- ❌ **No networking**: no cloud sync, no sign-in, no crash reporting, no usage analytics.
- ❌ **No secret hosting**: secrets never pass through any third party and are never written to logs.
- ❌ **No unnecessary permissions**: on Android only camera (for QR scanning) and network (for local WebView assets) are requested; the camera permission is optional.

### Features

| Capability | Description |
| --- | --- |
| **TOTP / HOTP** | Full RFC 6238 (TOTP) and RFC 4226 (HOTP) implementation, with `SHA1` / `SHA256` / `SHA512` HMAC digests |
| **Digits & period** | 6 / 7 / 8 digits; TOTP period configurable from 1 to 3600 seconds (default 30); 8-digit codes are shown as 4+4 groups |
| **Live progress ring** | Each card shows the remaining time and progress of the current period, turns red in the last 5 seconds, and previews the next code |
| **One-tap copy** | Click a card to copy the code, with brief feedback; a global shortcut can bring up the main window |
| **QR scanning** | Scan QR codes with the camera (`jsqr`, parsed locally) or paste `otpauth://` links; supports bulk text import |
| **Categories** | Create your own categories, each with a theme color; collapsed groups are tinted with the category color; accounts can be moved between categories |
| **Search & favorites** | Live filtering by issuer / account label; favorites are sorted first |
| **Encrypted vault** | AES-256-GCM encryption at rest; key derived from your passphrase with Argon2id (16-byte random salt + 12-byte random nonce) |
| **Lock passphrase** | Optional unlock passphrase (at least 8 characters) with a hint; or rely on the machine-local key alone |
| **Auto-lock** | Locks automatically after an idle timeout; supports a "lock only on start" policy |
| **Encrypted backup** | Export a backup string encrypted with a separate passphrase (accounts only / settings only); import merges by id without overwriting existing accounts |
| **Automatic snapshots** | A timestamped snapshot is kept on every write; retention is configurable (up to 10) with one-tap cleanup |
| **Screenshot protection** | On desktop, prevents the window from being captured by screen recorders |
| **Tray & autostart** | On desktop, minimize to tray, choose close behavior (quit / tray), and start on login |
| **Theme & language** | Light / dark / follow system; UI font scaling; Chinese / English |
| **Mobile layout** | A dedicated mobile layout (`data-platform` hook) with touch-calibrated sizing and interactions |

**Behavior notes**

- Codes refresh automatically each period — no manual action needed.
- Failures (copy errors, empty import results) always surface a message — **nothing fails silently**.
- While locked, every data command returns "application is locked"; no plaintext is kept in memory.

### Design language

Built on the Volcengine **源力 (Yuanli)** design system: primary color `#1664FF`, unified radius tokens (4 / 8 / 12 / 9999px), three-state inputs (idle outline → hover emphasis → focus blue outline with glow), and the section-title bar style on the Settings page.

### Security model

```
        passphrase              otpauth secret
            │                        │
     Argon2id derivation       (account data)
            │                        │
      256-bit key ──────► AES-256-GCM ──────► vault.json (ciphertext at rest)
                                     │
                              salt(16B) + nonce(12B), random, stored with ciphertext
```

| Stage | Implementation |
| --- | --- |
| Key derivation | **Argon2id** (`argon2` crate defaults), fresh 16-byte random salt each time |
| Encryption | **AES-256-GCM** (AEAD), fresh 12-byte random nonce on every write |
| At rest | Ciphertext + salt + nonce + metadata (JSON) only — no plaintext key |
| Runtime | The unlock key lives in memory only (`Mutex<Option<[u8;32]>>`) and is cleared on lock |
| Passphrase check | A separate verifier (hash derived from the salt), decoupled from the vault key |
| No-passphrase mode | A deterministic "machine-local key" derived from the device fingerprint and a fixed salt via Argon2, to keep secrets from being stored as plaintext |
| Backup | Exports are re-encrypted with a **separate passphrase**, so they can move across devices |
| Input validation | Secret (Base32), digits (6/7/8), algorithm, period (1–3600s) and category name (≤20 chars) are all re-validated on the backend |
| Color injection | Category colors are normalized by regex; invalid values fall back to the theme blue |

> [!NOTE]
> The "machine-local key" is for the **no-passphrase** case. It prevents plaintext at rest; it is not a defense against an attacker who can read files on your machine. If the device may be physically accessed by others, enable an unlock passphrase.

### Download

Grab the latest build from **[Releases](https://github.com/Xiaoph123/OneTotp/releases/latest)**. Artifacts follow `OneTotp_{version}_{os}_{arch}-{type}`.

| Platform | Arch | Artifact | Notes |
| --- | --- | --- | --- |
| **Windows** | x64 / arm64 | `-setup.exe` | NSIS installer |
| **Windows** | x64 / arm64 | `-portable.exe` | Portable, run directly |
| **macOS** | x64 / arm64 / universal | `.dmg` | universal = Intel + Apple Silicon |
| **Linux** | x86_64 / arm64 | `.deb` / `.rpm` / `.AppImage` | AppImage needs no install |
| **Android** | arm64 / armv7 / x86 / x86_64 | `.apk` | arm64 covers most phones |

> [!TIP]
> There is no 32-bit Windows (x86) build — Tauri 2 does not support that target, so it is not an omission.
> iOS requires an Apple Developer account ($99/yr) for signing, so no `.ipa` is published yet.

**First-run notes**

- **macOS**: an unsigned build must be opened via right-click → Open, or run `xattr -dr com.apple.quarantine OneTotp.app`.
- **Windows**: SmartScreen may warn about an unknown publisher — choose "More info → Run anyway".
- **Android**: allow installing apps from this source in system settings.

### Build from source

| Tool | Version |
| --- | --- |
| Node.js | ≥ 20 (22 recommended) |
| Rust | stable |
| Tauri CLI | 2.x (ships with `@tauri-apps/cli`) |

On Linux you also need: `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`, `build-essential`.

**Desktop**

```bash
cd develop
npm install
npm run tauri dev            # development
npm run tauri build          # package for the current platform
```

**Mobile (Android)**

```bash
cd develop
npm run tauri android init   # generate the project once
npm run tauri android build -- --apk --target aarch64
```

**Automated all-platform builds**

The repo ships a [GitHub Actions workflow](.github/workflows/release.yml). Pushing a `v*` tag triggers a build matrix covering Windows / macOS / Linux / Android across architectures and creates a Release automatically. The iOS job turns on once Apple certificate secrets are configured, and is skipped silently otherwise.

### Project layout

```text
OneTotp/
├─ .github/workflows/
│  └─ release.yml          # all-platform build matrix
├─ develop/
│  ├─ src/                 # React frontend
│  │  ├─ components/       # shared UI (title bar, buttons, dialogs, toast…)
│  │  ├─ pages/            # screens (codes, detail, settings, security, import/export…)
│  │  ├─ state/            # app state, auto-lock, screenshot protection
│  │  ├─ lib/              # API wrapper, theme, platform, QR, shortcuts
│  │  ├─ i18n/             # Chinese / English strings
│  │  └─ styles/           # design tokens and styles
│  └─ src-tauri/           # Rust backend
│     ├─ src/
│     │  ├─ crypto.rs      # Argon2id derivation + AES-256-GCM
│     │  ├─ totp.rs        # RFC 4226 / RFC 6238 implementation
│     │  ├─ store.rs       # vault I/O, backups, otpauth parsing
│     │  ├─ commands.rs    # Tauri commands (accounts / categories / settings / backup)
│     │  └─ models.rs      # data models
│     └─ tauri.conf.json
└─ Design/                 # design sources
```

### Tech stack

| Layer | Technology |
| --- | --- |
| Desktop / mobile shell | **Tauri 2** (Rust) |
| Frontend | **React 19** + **TypeScript** + **Vite 8** |
| Cryptography | `aes-gcm` · `argon2` · `rand` |
| OTP algorithms | `hmac` · `sha1` · `sha2` · `base32` |
| QR scanning | `jsqr` (parsed locally) |
| Design system | Volcengine Yuanli |

### FAQ

**Does it upload my secrets anywhere?**

No. OneTotp has no server. You can use it fully offline with identical functionality — the simplest way to verify the "offline" claim.

**How do I move to another computer?**

Use Export to generate an encrypted backup string (**encrypted with a separate passphrase**) and Import it on the new device. You can export accounts only or settings only; import merges by account id and never overwrites existing accounts.

**I forgot my unlock passphrase.**

It cannot be recovered. The key is derived from the passphrase via Argon2id — the passphrase *is* the key, and there is no backdoor or reset path. That is the necessary cost of the security design. Keep automatic backups off-site.

**Which import formats are supported?**

Standard `otpauth://` links, either a single one or one per line for bulk import. QR codes and links exported by mainstream authenticators are recognized.

**My codes are not 6 digits?**

6 / 7 / 8 digits are supported. 8-digit codes are shown as 4+4 groups for easier reading and entry.

### License

[MIT License](LICENSE)

### Feedback

Questions and suggestions are welcome via [GitHub Issues](https://github.com/Xiaoph123/OneTotp/issues). Please include your OS, architecture, and OneTotp version.

<p align="right"><a href="#简体中文">↑ 简体中文</a></p>
