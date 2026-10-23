<p align="center">
  <img src="develop/src-tauri/app-icon.svg" width="112" height="112" alt="OneTOTP" />
</p>

<h1 align="center">OneTOTP</h1>

<p align="center">
  <strong>纯离线身份验证器 · TOTP / HOTP</strong><br>
  <sub>密钥永不出本机，验证码按 RFC 4226 / RFC 6238 在本地计算。</sub>
</p>

<p align="center">
  <a href="https://github.com/Xiaoph123/OneTOTP/releases/latest"><img src="https://img.shields.io/github/v/release/Xiaoph123/OneTOTP?label=release&color=34D399" alt="Release"></a>
  <a href="https://github.com/Xiaoph123/OneTOTP/releases"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-1664FF" alt="Platform"></a>
  <a href="https://github.com/Xiaoph123/OneTOTP/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-22D3EE" alt="License"></a>
  <img src="https://img.shields.io/badge/Tauri-2-6366F1" alt="Tauri 2">
  <img src="https://img.shields.io/badge/React-19-61DAFB" alt="React 19">
</p>

<p align="center">
  <a href="#简体中文"><strong>简体中文</strong></a> · <a href="#english">English</a>
</p>

---

## 简体中文

> [!IMPORTANT]
> **离线是设计前提，不是可选项。** OneTOTP 不发起任何网络请求、不接入云端同步、不含遥测与统计。你的账户密钥从头到尾只存在于本机，加密后落盘，解密只在内存中发生。

### 它是什么

一个把「两步验证」这件事做干净的桌面 / 移动端应用：把各家网站的 `otpauth://` 密钥收进来，按标准算法在本地算出 6~8 位验证码，复制、输入、完成。没有账号体系，没有服务器，没有「同步中」的转圈。

### 它不做什么

- ❌ **不联网**：无云端同步、无账号登录、无崩溃上报、无使用统计。
- ❌ **不托管密钥**：密钥不经过任何第三方，也不写入日志。
- ❌ **不申请多余权限**：Android 端仅申请相机（扫码）、生物识别（解锁）与网络（WebView 本地资源），相机与生物识别权限均为可选。

### 功能

| 能力 | 说明 |
| --- | --- |
| **TOTP / HOTP** | 完整实现 RFC 6238（TOTP）与 RFC 4226（HOTP），支持 `SHA1` / `SHA256` / `SHA512` 三种 HMAC 摘要 |
| **验证码位数与周期** | 支持 6 / 7 / 8 位；TOTP 周期 1~3600 秒可配（默认 30）；8 位验证码按 4+4 分组显示 |
| **实时进度环** | 卡片展示当前周期的剩余时间与进度，末 5 秒验证码转红提示，并预览「下一个验证码」 |
| **一键复制** | 点击卡片复制验证码，复制后短暂反馈；支持全局快捷键唤起主窗口 |
| **剪贴板自动清除** | 复制后默认 30 秒清空剪贴板（可选 15 秒 / 1 分钟 / 不清除）；清除前核对内容仍是刚复制的验证码，不会误删你后来复制的东西 |
| **扫码录入** | Android 使用 CameraX + ZXing 原生解码（零 GMS 依赖、完全离线）；桌面端用 `jsqr` 本地解析；也可粘贴 `otpauth://` 链接或批量文本导入 |
| **重复账户检测** | 以密钥为唯一标识，重复添加时明确提示并拒绝 |
| **分类管理** | 自建分类，每个分类可指定主题色；折叠时按分类色淡色高亮，账户可在分类间移动；展开策略可选自动展开 / 不自动展开 / 按上次状态 |
| **搜索与收藏** | 按服务名 / 账户标识实时过滤（200ms 防抖）；收藏账户优先排序 |
| **加密保险库** | AES-256-GCM 加密落盘，密钥由 Argon2id 从口令派生（16 字节随机 salt + 12 字节随机 nonce）；派生参数随文件落盘，旧库按历史参数读取 |
| **锁定密码** | 可选启用解锁口令（至少 8 位），带弱口令黑名单校验与即时强度提示；支持密码提示；也可仅靠机器本地密钥保护 |
| **生物识别解锁** | Windows Hello、macOS Touch ID、Android / iOS 指纹或面容；Android 侧用 Keystore AES-256-GCM，密钥由系统瞬时生成 |
| **自动锁定** | 离开应用即锁定，或空闲 30 秒 / 1 / 5 / 15 分钟后锁定，也可设为从不；解锁失败按落盘计数指数退避，重启不清零 |
| **重新加密保险库** | 用全新随机盐重新派生密钥并重写本地数据，使旧密钥立即作废 |
| **加密备份** | 导出为独立口令加密的 JSON 文件（可选仅账户 / 仅配置），经系统文件管理器选择保存位置；导入时先选文件再输密码，按密钥去重合并 |
| **自动备份快照** | 每次写盘自动留存时间戳快照，可配置保留份数（默认 3，最多 10），支持一键清理；删除账户时可同步从历史快照中清除其密钥 |
| **隐私保护** | 截屏 / 录屏时隐藏内容（Windows / macOS / Android `FLAG_SECURE`）、远程会话时隐藏窗口（桌面）、窗口失焦时遮挡验证码 |
| **数据存储目录** | 账户、备份与密钥可迁移到自定义目录，切换后自动重启生效 |
| **托盘与自启** | 桌面端支持最小化到托盘、关闭行为可选（退出 / 托盘）、开机自启，托盘菜单可直接进入设置 |
| **主题与语言** | 浅色 / 深色 / 跟随系统；界面字体缩放；中文 / English 双语 |
| **开屏动画** | 四种样式可选（描边绘制 / 弹入光扫 / 环形进度 / 光点聚合，默认光点聚合），停留 1 秒后淡出，配色随明暗模式切换 |
| **移动端适配** | 独立移动布局（`data-platform` 钩子），底部四项导航（验证码 / 收藏 / 最近 / 设置），触控尺寸按移动端重新校准；「复制后自动隐藏」在 Android 上表现为切到后台 |

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
| 密钥派生 | **Argon2id**，每次生成 16 字节随机 salt；参数（`m` / `t` / `p`）随保险库文件落盘，新库用 `m=64 MiB / t=3 / p=1`，旧库按文件中记录的历史参数（`m=19 MiB / t=2 / p=1`）读取 |
| 加密 | **AES-256-GCM**（AEAD），每次写入生成 12 字节随机 nonce |
| 落盘 | 仅密文 + salt + nonce + KDF 参数 + 元数据（JSON），无明文密钥 |
| 运行期 | 解锁密钥仅存于内存（`Mutex<Option<[u8;32]>>`），锁定即按字节擦除（`zeroize`），而非仅丢弃引用 |
| 口令校验 | 独立 verifier：`HMAC-SHA256(保险库密钥, 固定上下文)`，与保险库密钥分离且不可反推 |
| 无口令模式 | 首次使用时生成 32 字节随机「机器本地密钥」并原子落盘（`onetotp.machine.key`），与设备绑定；旧版按 OS + ARCH 派生的密钥仅用于兼容读取旧数据 |
| 生物识别 | 凭据由系统安全模块保管：Windows Hello / macOS Keychain / Android Keystore（AES-256-GCM），应用侧不接触原始生物特征 |
| 备份 | 导出时用**独立新口令**重新派生密钥加密，可跨设备迁移 |
| 截屏保护 | Windows `WDA_EXCLUDEFROMCAPTURE` / macOS 内容保护 / Android `FLAG_SECURE` |
| 输入校验 | 密钥（Base32）、位数（6/7/8）、算法、周期（1~3600s）、分类名（≤20 字符）、枚举型设置项（开屏动画 / 分类展开策略）均在服务端二次校验 |
| 文件读写 | 导出仅允许 `.json` / `.txt` 后缀；导入导出均限制 10MB；Android `content://` URI 经 ContentResolver 打开，不接受前端任意构造的地址 |
| 数据目录 | 指针只接受「绝对路径 + 本地路径 + 真实存在的目录」，拒绝 UNC 网络路径；非法指针回退默认目录并在界面说明原因；迁移时目标同名文件先另存为 `.bak-<时间戳>` |
| 颜色注入 | 分类色经正则规范化，非法值回退主题蓝，杜绝越界输入 |

> [!NOTE]
> 「机器本地密钥」用于**未设置解锁口令**的场景，其作用是避免密钥明文落盘，而非抵御能读取本机文件的攻击者。若设备可能被他人物理接触，请启用解锁口令。

### 下载

前往 **[Releases](https://github.com/Xiaoph123/OneTOTP/releases/latest)** 获取最新版本。命名规则为 `OneTOTP_{版本}_{系统}_{架构}-{类型}`。

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

- **macOS**：未签名分发包首次打开需右键 →「打开」，或执行 `xattr -dr com.apple.quarantine OneTOTP.app`。
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

> [!TIP]
> Windows 上 `tauri android build` 会在 Rust 编译完成后失败——Tauri 需要在 `jniLibs/<abi>/` 下创建符号链接，而 Windows 默认不允许（未开启开发者模式）。此时可用仓库内的一键脚本绕过该限制，它手工完成「编译 Rust → 放置 `.so` → 同步前端 → gradle 打包 → 签名」全流程，并自动递增 `versionCode`：
>
> ```powershell
> cd develop
> pwsh -File scripts/build-android-apk.ps1 -Label beta
> ```
>
> 详细说明见 [android-release-build.md](develop/docs/android-release-build.md)。

**全端自动构建**

仓库内置 [GitHub Actions](.github/workflows/release.yml)，推送 `v*` 标签即触发矩阵构建，覆盖 Windows / macOS / Linux / Android 多架构，并自动创建 Release。iOS 任务在配置 Apple 证书 Secrets 后自动启用，未配置时静默跳过。

### 项目结构

```text
OneTOTP/
├─ .github/workflows/
│  └─ release.yml          # 全端构建矩阵
├─ develop/
│  ├─ docs/                # 构建与发布说明、威胁模型
│  ├─ scripts/             # Android 一键打包、本地数据重置
│  ├─ tests/               # 自动锁定判定、下拉浮层定位单元测试
│  ├─ public/              # 启动画面样式与首帧主题脚本
│  ├─ src/                 # React 前端
│  │  ├─ components/       # 通用组件（标题栏、按钮、弹窗、Toast…）
│  │  ├─ pages/            # 页面（验证码、详情、设置、安全、导入导出…）
│  │  ├─ state/            # 应用状态、自动锁定、隐私保护
│  │  ├─ lib/              # API 封装、主题、平台、二维码、快捷键、生物识别
│  │  ├─ i18n/             # 中英文案
│  │  └─ styles/           # 设计 token 与样式
│  └─ src-tauri/           # Rust 后端
│     ├─ src/
│     │  ├─ crypto.rs      # Argon2id 派生（参数随文件落盘）+ AES-256-GCM 加解密
│     │  ├─ totp.rs        # RFC 4226 / RFC 6238 算法实现
│     │  ├─ store.rs       # 保险库读写、备份、数据目录迁移与指针校验
│     │  ├─ commands.rs    # Tauri 命令（账户 / 分类 / 设置 / 备份）
│     │  └─ models.rs      # 数据模型
│     ├─ plugins/          # 内置插件（生物识别、原生扫码）
│     └─ tauri.conf.json
```

### 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面 / 移动外壳 | **Tauri 2**（Rust） |
| 前端 | **React 19** + **TypeScript** + **Vite 8** |
| 加密 | `aes-gcm` · `argon2` · `rand` · `zeroize` |
| OTP 算法 | `hmac` · `sha1` · `sha2` · `base32` |
| 扫码 | Android：CameraX + ZXing（原生）；桌面：`jsqr`（本地解析） |
| 生物识别 | `tauri-plugin-biometry`（Windows Hello / Touch ID / Android Keystore） |
| 设计系统 | 火山引擎源力（Volcengine） |

### 常见问题

**会不会把我的密钥上传到服务器？**

不会。OneTOTP 没有服务器。你可以断网使用，功能完全一致——这是验证「纯离线」最直接的方式。

**换电脑怎么办？**

用「导出配置」生成加密备份文件（**用独立口令加密**），在新设备「导入配置」即可。备份可选只导出账户或只导出配置，导入按密钥去重，不会覆盖目标设备已有账户。

**忘记解锁口令了？**

无法找回。密钥由口令经 Argon2id 派生，口令即密钥，没有任何后门或重置通道——这是安全设计的必然代价。建议启用自动备份并异地保存；若设置过密码提示，锁屏页会显示该提示。

**支持哪些导入格式？**

标准 `otpauth://` 链接（单条或每行一条批量）。主流验证器导出的二维码 / 链接均可识别。

**验证码位数不是 6 位？**

支持 6 / 7 / 8 位。8 位验证码会按 4+4 分组显示，便于核对与输入。

### 许可证

[MIT License](LICENSE)

### 反馈

欢迎通过 [GitHub Issues](https://github.com/Xiaoph123/OneTOTP/issues) 提交问题与建议。反馈时请注明系统平台、架构与 OneTOTP 版本号。

<p align="right"><a href="#english">English →</a></p>

---

## English

<p align="right"><a href="#简体中文">← 简体中文</a></p>

> [!IMPORTANT]
> **Offline by design, not by option.** OneTOTP makes no network requests, has no cloud sync, and contains no telemetry or analytics. Your account secrets never leave your device — they are encrypted at rest and decrypted only in memory.

### What it is

A desktop and mobile app that does two-factor authentication properly: collect `otpauth://` secrets from any service, compute 6–8 digit codes locally using standard algorithms, copy, paste, done. No accounts, no servers, no "syncing…" spinner.

### What it does not do

- ❌ **No networking**: no cloud sync, no sign-in, no crash reporting, no usage analytics.
- ❌ **No secret hosting**: secrets never pass through any third party and are never written to logs.
- ❌ **No unnecessary permissions**: on Android only camera (QR scanning), biometrics (unlock) and network (local WebView assets) are requested; camera and biometrics are optional.

### Features

| Capability | Description |
| --- | --- |
| **TOTP / HOTP** | Full RFC 6238 (TOTP) and RFC 4226 (HOTP) implementation, with `SHA1` / `SHA256` / `SHA512` HMAC digests |
| **Digits & period** | 6 / 7 / 8 digits; TOTP period configurable from 1 to 3600 seconds (default 30); 8-digit codes are shown as 4+4 groups |
| **Live progress ring** | Each card shows the remaining time and progress of the current period, turns red in the last 5 seconds, and previews the next code |
| **One-tap copy** | Click a card to copy the code, with brief feedback; a global shortcut can bring up the main window |
| **Clipboard auto-clear** | The clipboard is cleared 30 seconds after copying by default (15 s / 1 min / never); the content is checked first, so anything you copied later is left alone |
| **QR scanning** | Android uses native CameraX + ZXing decoding (zero GMS dependency, fully offline); desktop uses `jsqr` locally; you can also paste `otpauth://` links or import bulk text |
| **Duplicate detection** | The secret is the unique key — duplicates are rejected with a clear message |
| **Categories** | Create your own categories, each with a theme color; collapsed groups are tinted with the category color; accounts can be moved between categories; expansion policy can be always expand / always collapse / restore last state |
| **Search & favorites** | Live filtering by issuer / account label (200 ms debounce); favorites are sorted first |
| **Encrypted vault** | AES-256-GCM encryption at rest; key derived from your passphrase with Argon2id (16-byte random salt + 12-byte random nonce); KDF parameters are stored with the file, so older vaults keep working with their historical settings |
| **Lock passphrase** | Optional unlock passphrase (at least 8 characters) with a weak-password blocklist and live strength hints; supports a hint; or rely on the machine-local key alone |
| **Biometric unlock** | Windows Hello, macOS Touch ID, Android / iOS fingerprint or face; on Android the credential is an AES-256-GCM key in Keystore, generated instantly by the system |
| **Auto-lock** | Lock on leaving the app, or after 30 s / 1 / 5 / 15 minutes idle, or never; failed unlocks back off exponentially using a persisted counter that survives restarts |
| **Re-encrypt vault** | Re-derive the key with a fresh random salt and rewrite local data, invalidating the old key immediately |
| **Encrypted backup** | Export a JSON file encrypted with a separate passphrase (accounts only / settings only) via the system file picker; import picks the file first, then asks for the password, and merges by secret |
| **Automatic snapshots** | A timestamped snapshot is kept on every write; retention is configurable (default 3, up to 10) with one-tap cleanup; deleting an account can also purge its secret from historical snapshots |
| **Privacy protection** | Hide content from screenshots / recording (Windows / macOS / Android `FLAG_SECURE`), hide the window during remote sessions (desktop), mask codes when the window loses focus |
| **Data directory** | Move accounts, backups and keys to a custom folder; the app restarts automatically after the change |
| **Tray & autostart** | On desktop, minimize to tray, choose close behavior (quit / tray), start on login, and jump to Settings from the tray menu |
| **Theme & language** | Light / dark / follow system; UI font scaling; Chinese / English |
| **Splash animation** | Four styles (outline draw / pop with light sweep / ring progress / dot convergence, default dot convergence), 1-second hold then fade-out, colors follow the light/dark theme |
| **Mobile layout** | A dedicated mobile layout (`data-platform` hook) with a four-item bottom bar (codes / favorites / recent / settings) and touch-calibrated sizing; "hide after copy" sends the app to the background on Android |

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
| Key derivation | **Argon2id** with a fresh 16-byte random salt; parameters (`m` / `t` / `p`) are stored with the vault file — new vaults use `m=64 MiB / t=3 / p=1`, older ones are read with their recorded historical parameters (`m=19 MiB / t=2 / p=1`) |
| Encryption | **AES-256-GCM** (AEAD), fresh 12-byte random nonce on every write |
| At rest | Ciphertext + salt + nonce + KDF parameters + metadata (JSON) only — no plaintext key |
| Runtime | The unlock key lives in memory only (`Mutex<Option<[u8;32]>>`) and is byte-wiped on lock (`zeroize`), not merely dropped |
| Passphrase check | A separate verifier — `HMAC-SHA256(vault key, fixed context)` — decoupled from the vault key and not reversible |
| No-passphrase mode | A 32-byte random "machine-local key" generated on first use and written atomically (`onetotp.machine.key`), bound to the device; the legacy OS + ARCH derived key is only used to read old data |
| Biometrics | Credentials are held by the OS secure module: Windows Hello / macOS Keychain / Android Keystore (AES-256-GCM); the app never touches raw biometric data |
| Backup | Exports are re-encrypted with a **separate passphrase**, so they can move across devices |
| Screenshot protection | Windows `WDA_EXCLUDEFROMCAPTURE` / macOS content protection / Android `FLAG_SECURE` |
| Input validation | Secret (Base32), digits (6/7/8), algorithm, period (1–3600s), category name (≤20 chars) and enumerated settings (splash animation / category expansion) are all re-validated on the backend |
| File I/O | Exports are limited to `.json` / `.txt`; both import and export cap at 10 MB; Android `content://` URIs are opened through ContentResolver and never accepted as arbitrary frontend-supplied paths |
| Data directory | The pointer accepts only an absolute, local, existing directory — UNC network paths are rejected; an invalid pointer falls back to the default directory with the reason shown in the UI; on migration an existing same-named file is first saved as `.bak-<timestamp>` |
| Color injection | Category colors are normalized by regex; invalid values fall back to the theme blue |

> [!NOTE]
> The "machine-local key" is for the **no-passphrase** case. It prevents plaintext at rest; it is not a defense against an attacker who can read files on your machine. If the device may be physically accessed by others, enable an unlock passphrase.

### Download

Grab the latest build from **[Releases](https://github.com/Xiaoph123/OneTOTP/releases/latest)**. Artifacts follow `OneTOTP_{version}_{os}_{arch}-{type}`.

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

- **macOS**: an unsigned build must be opened via right-click → Open, or run `xattr -dr com.apple.quarantine OneTOTP.app`.
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

> [!TIP]
> On Windows, `tauri android build` fails after the Rust build — Tauri needs to create a symlink under `jniLibs/<abi>/`, which Windows disallows by default (unless Developer Mode is on). Use the bundled script to work around it; it performs the whole flow manually (build Rust → place `.so` → sync frontend → gradle package → sign) and bumps `versionCode` automatically:
>
> ```powershell
> cd develop
> pwsh -File scripts/build-android-apk.ps1 -Label beta
> ```
>
> See [android-release-build.md](develop/docs/android-release-build.md) for details.

**Automated all-platform builds**

The repo ships a [GitHub Actions workflow](.github/workflows/release.yml). Pushing a `v*` tag triggers a build matrix covering Windows / macOS / Linux / Android across architectures and creates a Release automatically. The iOS job turns on once Apple certificate secrets are configured, and is skipped silently otherwise.

### Project layout

```text
OneTOTP/
├─ .github/workflows/
│  └─ release.yml          # all-platform build matrix
├─ develop/
│  ├─ docs/                # build & release notes, threat model
│  ├─ scripts/             # Android one-shot packaging, local data reset
│  ├─ tests/               # auto-lock decision, dropdown placement unit tests
│  ├─ public/              # splash styles and first-frame theme script
│  ├─ src/                 # React frontend
│  │  ├─ components/       # shared UI (title bar, buttons, dialogs, toast…)
│  │  ├─ pages/            # screens (codes, detail, settings, security, import/export…)
│  │  ├─ state/            # app state, auto-lock, privacy protection
│  │  ├─ lib/              # API wrapper, theme, platform, QR, shortcuts, biometrics
│  │  ├─ i18n/             # Chinese / English strings
│  │  └─ styles/           # design tokens and styles
│  └─ src-tauri/           # Rust backend
│     ├─ src/
│     │  ├─ crypto.rs      # Argon2id derivation (params stored with the file) + AES-256-GCM
│     │  ├─ totp.rs        # RFC 4226 / RFC 6238 implementation
│     │  ├─ store.rs       # vault I/O, backups, data directory migration and pointer validation
│     │  ├─ commands.rs    # Tauri commands (accounts / categories / settings / backup)
│     │  └─ models.rs      # data models
│     ├─ plugins/          # bundled plugins (biometrics, native QR scanner)
│     └─ tauri.conf.json
```

### Tech stack

| Layer | Technology |
| --- | --- |
| Desktop / mobile shell | **Tauri 2** (Rust) |
| Frontend | **React 19** + **TypeScript** + **Vite 8** |
| Cryptography | `aes-gcm` · `argon2` · `rand` · `zeroize` |
| OTP algorithms | `hmac` · `sha1` · `sha2` · `base32` |
| QR scanning | Android: CameraX + ZXing (native); desktop: `jsqr` (parsed locally) |
| Biometrics | `tauri-plugin-biometry` (Windows Hello / Touch ID / Android Keystore) |
| Design system | Volcengine Yuanli |

### FAQ

**Does it upload my secrets anywhere?**

No. OneTOTP has no server. You can use it fully offline with identical functionality — the simplest way to verify the "offline" claim.

**How do I move to another computer?**

Use Export to generate an encrypted backup file (**encrypted with a separate passphrase**) and Import it on the new device. You can export accounts only or settings only; import merges by secret and never overwrites existing accounts.

**I forgot my unlock passphrase.**

It cannot be recovered. The key is derived from the passphrase via Argon2id — the passphrase *is* the key, and there is no backdoor or reset path. That is the necessary cost of the security design. Keep automatic backups off-site; if you set a password hint, the lock screen will show it.

**Which import formats are supported?**

Standard `otpauth://` links, either a single one or one per line for bulk import. QR codes and links exported by mainstream authenticators are recognized.

**My codes are not 6 digits?**

6 / 7 / 8 digits are supported. 8-digit codes are shown as 4+4 groups for easier reading and entry.

### License

[MIT License](LICENSE)

### Feedback

Questions and suggestions are welcome via [GitHub Issues](https://github.com/Xiaoph123/OneTOTP/issues). Please include your OS, architecture, and OneTOTP version.

<p align="right"><a href="#简体中文">↑ 简体中文</a></p>
