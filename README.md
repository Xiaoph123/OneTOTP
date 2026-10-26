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
| **扫码录入** | Android 使用 CameraX + ZXing 原生解码（零 GMS 依赖、完全离线）；iOS 使用 AVFoundation + 原生取景蒙版；桌面端用 `jsqr` 本地解析；也可粘贴 `otpauth://` 链接或批量文本导入 |
| **重复账户检测** | 以密钥为唯一标识，重复添加时明确提示并拒绝 |
| **分类管理** | 自建分类，每个分类可指定主题色；折叠时按分类色淡色高亮，账户可在分类间移动；展开策略可选自动展开 / 不自动展开 / 按上次状态 |
| **搜索与收藏** | 按服务名 / 账户标识实时过滤（200ms 防抖）；收藏账户优先排序 |
| **拖动排序** | 首页卡片长按 1 秒进入拖动（桌面端与移动端一致），长按期间底部进度条填满、拖动时其余卡片压暗并显示落点指示线；松手自动保存。手动排序后新增账户固定排在最前，排序结果随加密备份跨设备迁移 |
| **加密保险库** | AES-256-GCM 加密落盘，密钥由 Argon2id 从口令派生（16 字节随机 salt + 12 字节随机 nonce）；派生参数随文件落盘，旧库按历史参数读取 |
| **锁定密码** | 可选启用解锁口令（至少 8 位），带弱口令黑名单校验与即时强度提示；支持密码提示；也可仅靠机器本地密钥保护 |
| **生物识别解锁** | Windows Hello、macOS Touch ID、Android / iOS 指纹或面容；Android 侧用 Keystore AES-256-GCM，密钥由系统瞬时生成 |
| **自动锁定** | 离开应用即锁定，或空闲 30 秒 / 1 / 5 / 15 分钟后锁定，也可设为从不；解锁失败按落盘计数指数退避，重启不清零 |
| **重新加密保险库** | 用全新随机盐重新派生密钥并重写本地数据，使旧密钥立即作废 |
| **加密备份** | 导出为独立口令加密的 JSON 文件（可选仅账户 / 仅配置），经系统文件管理器选择保存位置；导入时先选文件再输密码，按密钥去重合并 |
| **拖拽导入** | 桌面端任意页面把备份文件拖进窗口即可导入（新增语义，重复账户跳过）；「导入 / 导出配置」页另有独立拖拽区。只接受 OneTOTP 自己的备份文件，其它文件会显示**拒绝态**遮罩并说明具体原因（文件名不符 / 超过 10MB / 内容损坏 / 不是有效备份），光标同步显示禁止符号 |
| **自动备份快照** | 每次写盘自动留存时间戳快照，可配置保留份数（默认 3，最多 10），支持一键清理；删除账户时可同步从历史快照中清除其密钥 |
| **隐私保护** | 截屏 / 录屏时隐藏内容（Windows / macOS / Android `FLAG_SECURE` / iOS secure 图层）、远程会话时隐藏窗口（桌面）、窗口失焦时遮挡验证码 |
| **数据存储目录** | 账户、备份与密钥可迁移到自定义目录，切换后自动重启生效；移动端显示系统分配的私有目录路径并支持一键复制，同时提示卸载即清空 |
| **托盘与自启** | 桌面端支持最小化到托盘、关闭行为可选（退出 / 托盘）、开机自启，托盘菜单可直接进入设置 |
| **主题与语言** | 浅色 / 深色 / 跟随系统（默认跟随系统）；界面字体缩放；中文 / English 双语 |
| **开屏动画** | 五种样式可选（汇聚光晕 / 描边绘制 / 玻璃反光 / 液态粗细 / 关闭，默认汇聚光晕），动画 1.5 秒播完后停留 0.2 秒再进入首页，配色随明暗模式切换；选「关闭」则直接进入界面 |
| **移动端适配** | 独立移动布局（`data-platform` 钩子），底部四项导航（验证码 / 收藏 / 最近 / 设置），触控尺寸按移动端重新校准；「复制后自动隐藏」在 Android 上表现为切到后台，iOS 因系统禁止程序主动切后台而改为立即锁定 |
| **内嵌字体** | 验证码使用内置 Roboto Mono（400 / 700 真实字重），不依赖系统字体，各品牌 Android ROM 上都能正确加粗 |

**状态细节**

- 验证码按期自动刷新，无需手动操作。
- 复制失败、导入解析为空等情况都有明确提示，**不会静默失败**。
- 应用未解锁时所有数据接口返回「应用未解锁」，内存中不保留任何明文。

### 界面语言

基于火山引擎 **源力（Volcengine）** 设计系统落地：主色 `#1664FF`，统一圆角 token（4 / 8 / 12 / 9999px），输入框三态（常态描边 → 悬停加深 → 聚焦蓝色描边 + 光晕），设置页分组标题采用源力竖条样式。

**视觉体系（v0.4.0 起）**

| 部分 | 做法 |
| --- | --- |
| 应用背景 | 明暗两套主题统一使用 SVG `feTurbulence` 微噪点（无周期性、不形成网格感），仅按底色深浅调整透明度；底色 `#FCFDFE` / `#0A0B0D` |
| 贴边容器 | 标题栏、页头、标签栏完全透明，让背景纹理贯穿；底部吸附操作条半透明 + 模糊，避免滚过内容互相干扰 |
| 卡片 | 半透明玻璃（`rgba(255,255,255,.62)` / `rgba(26,29,34,.72)`）+ `blur(14px) saturate(1.4)` |
| 品牌按钮 | 亮色为绿→青→靛标准渐变；暗色整体压暗 35% 并叠加顶部内高光，保留品牌色相但不刺眼 |
| 验证码 | 内置 Roboto Mono 400 / 700 两档真实字重，不依赖系统字体 |
| 移动端状态栏 | Android `enableEdgeToEdge` + WebView 铺满整屏，安全区尺寸经 CSS 变量注入后由 `.app-window` 内边距避让，使背景纹理连续覆盖到状态栏下方；iOS 无原生注入，回退到 `env(safe-area-inset-*)` |

**品牌图标**

渐变盾牌 + 反白钥匙孔，外轮廓在 24 单位坐标系中绘制，与应用内 `OneTotpMark` 同源：

| 场景 | 规格 |
| --- | --- |
| 主源文件 | `develop/src-tauri/app-icon.svg`（1024×1024，透明底） |
| 桌面 / iOS | 由 `npm run tauri icon` 从主源文件生成全部尺寸 |
| Android 自适应图标 | 独立前景层 `app-icon-android-fg.svg`，盾牌约占 108dp 画布的 60%，居中且四周留白，避免被圆形遮罩切角（`app-icon-manifest.json` 中 `android_fg_scale: 62`） |
| 配色 | 品牌渐变 `#34D399 → #22D3EE → #6366F1`，钥匙孔为纯白 |

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
| 截屏保护 | Windows `WDA_EXCLUDEFROMCAPTURE` / macOS 内容保护 / Android `FLAG_SECURE` / iOS secure text field 图层（系统未提供 `FLAG_SECURE` 等价 API） |
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
| **iOS** | arm64 | `-unsigned.ipa` | **未签名**，需自行签名安装（见下） |

> [!TIP]
> 32 位 Windows（x86）无产物——Tauri 2 框架本身不支持该目标平台，非配置遗漏。

**iOS 安装说明（未签名包）**

发布页提供的是**未签名** `.ipa`。Tauri 与 GitHub Actions 都无法代劳签名，因为签名身份属于使用者自己的 Apple ID 或开发者账号。安装前需要自己重签一次，任选一种方式：

| 方式 | 是否需要 Mac | 是否需要开发者账号 | 说明 |
| --- | --- | --- | --- |
| **Sideloadly / AltStore** | 否 | 否（免费 Apple ID 即可） | 最省事。Windows / macOS 都有客户端，登录 Apple ID 后拖入 `.ipa` 即可安装，证书 7 天有效，到期重签 |
| **Xcode** | 是 | 否（免费 Apple ID 即可） | 新建一个同名工程或用 `ios-deploy`，把 `.ipa` 里的 `.app` 拖进去，选个人团队签名后装到设备 |
| **Apple Developer 账号** | 视方式 | 是（$99/年） | 可用 Ad Hoc / TestFlight 分发，证书 1 年有效，适合长期自用或小范围分发 |

> [!IMPORTANT]
> 免费 Apple ID 签名的应用有效期为 7 天，到期需重新签名（已录入的账户数据不会丢失，除非卸载应用）。
> 重签不会影响应用内的加密数据：保险库与密钥保存在应用沙盒里，重签覆盖安装时保留。

**首次安装提示**

- **macOS**：未签名分发包首次打开需右键 →「打开」，或执行 `xattr -dr com.apple.quarantine OneTOTP.app`。
- **Windows**：SmartScreen 可能提示未知发布者，选择「更多信息 → 仍要运行」。
- **Android**：需在系统设置中允许安装来自该来源的应用。
- **iOS**：未签名包直接点击无法安装，必须先按上表重签。

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

**移动端（iOS）**

iOS 工程只能在 macOS 上生成与编译（需要 Xcode）：

```bash
cd develop
npm run tauri ios init       # 首次生成工程（macOS）
npm run tauri ios build      # 已配置签名时产出可安装的 .ipa
npm run tauri ios build -- --no-sign   # 未配置签名时产出未签名包
```

**全端自动构建**

仓库内置 [GitHub Actions](.github/workflows/release.yml)，推送 `v*` 标签即触发矩阵构建，覆盖 Windows / macOS / Linux / Android / iOS 全部平台，并自动创建 Release。

iOS 任务**不需要任何 Apple 凭据**：它只做无签名编译，产出 `OneTOTP_x.y.z_ios-unsigned.ipa`，使用者下载后按上文「iOS 安装说明」自行重签。这样做的好处是开源仓库不必持有、也不能代替使用者持有签名身份；坏处是无法提供开箱即装的 iOS 包。

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
│     ├─ plugins/          # 内置插件（生物识别、原生扫码、iOS 截屏保护）
│     ├─ Info.plist        # iOS 权限声明（相机 / Face ID），构建时合入工程
│     └─ tauri.conf.json
```

### 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面 / 移动外壳 | **Tauri 2**（Rust） |
| 前端 | **React 19** + **TypeScript** + **Vite 8** |
| 加密 | `aes-gcm` · `argon2` · `rand` · `zeroize` |
| OTP 算法 | `hmac` · `sha1` · `sha2` · `base32` |
| 扫码 | Android：CameraX + ZXing（原生）；iOS：AVFoundation + 原生取景蒙版；桌面：`jsqr`（本地解析） |
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
| **QR scanning** | Android uses native CameraX + ZXing decoding (zero GMS dependency, fully offline); iOS uses AVFoundation with a native viewfinder overlay; desktop uses `jsqr` locally; you can also paste `otpauth://` links or import bulk text |
| **Duplicate detection** | The secret is the unique key — duplicates are rejected with a clear message |
| **Categories** | Create your own categories, each with a theme color; collapsed groups are tinted with the category color; accounts can be moved between categories; expansion policy can be always expand / always collapse / restore last state |
| **Search & favorites** | Live filtering by issuer / account label (200 ms debounce); favorites are sorted first |
| **Drag to reorder** | Long-press a card for 1 second to drag it (identical on desktop and mobile); a progress bar fills during the press, other cards dim while dragging, and a drop indicator shows where it will land; the order is saved on release. After manual sorting, newly added accounts always go to the top, and the order travels with encrypted backups across devices |
| **Encrypted vault** | AES-256-GCM encryption at rest; key derived from your passphrase with Argon2id (16-byte random salt + 12-byte random nonce); KDF parameters are stored with the file, so older vaults keep working with their historical settings |
| **Lock passphrase** | Optional unlock passphrase (at least 8 characters) with a weak-password blocklist and live strength hints; supports a hint; or rely on the machine-local key alone |
| **Biometric unlock** | Windows Hello, macOS Touch ID, Android / iOS fingerprint or face; on Android the credential is an AES-256-GCM key in Keystore, generated instantly by the system |
| **Auto-lock** | Lock on leaving the app, or after 30 s / 1 / 5 / 15 minutes idle, or never; failed unlocks back off exponentially using a persisted counter that survives restarts |
| **Re-encrypt vault** | Re-derive the key with a fresh random salt and rewrite local data, invalidating the old key immediately |
| **Encrypted backup** | Export a JSON file encrypted with a separate passphrase (accounts only / settings only) via the system file picker; import picks the file first, then asks for the password, and merges by secret |
| **Drag & drop import** | On desktop, drop a backup file anywhere in the window to import it (additive: duplicates are skipped); the Import / Export page has its own drop zone. Only OneTOTP's own backup files are accepted — anything else shows a **rejection overlay** with the specific reason (wrong filename / over 10 MB / unreadable / not a valid backup), and the cursor turns into a "no drop" sign |
| **Automatic snapshots** | A timestamped snapshot is kept on every write; retention is configurable (default 3, up to 10) with one-tap cleanup; deleting an account can also purge its secret from historical snapshots |
| **Privacy protection** | Hide content from screenshots / recording (Windows / macOS / Android `FLAG_SECURE` / iOS secure layer), hide the window during remote sessions (desktop), mask codes when the window loses focus |
| **Data directory** | Move accounts, backups and keys to a custom folder; the app restarts automatically after the change; on mobile the system-assigned private folder path is shown and copyable, with a warning that uninstalling erases everything |
| **Tray & autostart** | On desktop, minimize to tray, choose close behavior (quit / tray), start on login, and jump to Settings from the tray menu |
| **Theme & language** | Light / dark / follow system (default: follow system); UI font scaling; Chinese / English |
| **Splash animation** | Five styles (converge glow / outline draw / glass gloss / liquid stroke / off, default converge glow); the 1.5 s animation completes, holds 0.2 s, then the home screen fades in; colors follow the light/dark theme. Choosing "off" goes straight to the UI |
| **Mobile layout** | A dedicated mobile layout (`data-platform` hook) with a four-item bottom bar (codes / favorites / recent / settings) and touch-calibrated sizing; "hide after copy" sends the app to the background on Android, while iOS locks immediately since the platform forbids apps from backgrounding themselves |
| **Embedded font** | Codes use a bundled Roboto Mono (real 400 / 700 weights) instead of system fonts, so bold renders correctly on every Android ROM |

**Behavior notes**

- Codes refresh automatically each period — no manual action needed.
- Failures (copy errors, empty import results) always surface a message — **nothing fails silently**.
- While locked, every data command returns "application is locked"; no plaintext is kept in memory.

### Design language

Built on the Volcengine **源力 (Yuanli)** design system: primary color `#1664FF`, unified radius tokens (4 / 8 / 12 / 9999px), three-state inputs (idle outline → hover emphasis → focus blue outline with glow), and the section-title bar style on the Settings page.

**Visual system (since v0.4.0)**

| Part | Approach |
| --- | --- |
| App background | Both themes use SVG `feTurbulence` micro-noise (non-periodic, no visible grid), with opacity tuned per theme. Base colors `#FCFDFE` / `#0A0B0D` |
| Edge containers | Title bar, page headers and the tab bar are fully transparent so the background texture runs through them; the sticky action bar is translucent with blur so scrolled content does not interfere |
| Cards | Translucent glass (`rgba(255,255,255,.62)` / `rgba(26,29,34,.72)`) with `blur(14px) saturate(1.4)` |
| Brand buttons | Light uses the green → cyan → indigo gradient; dark dims it by ~35% and adds a top inner highlight, keeping brand hue without glare |
| Codes | Bundled Roboto Mono with real 400 / 700 weights — no dependence on system fonts |
| Mobile status bar | Android `enableEdgeToEdge` with a full-bleed WebView; safe-area insets are injected as CSS variables and consumed as padding on `.app-window`, so the texture continues under the status bar. iOS has no native injection and falls back to `env(safe-area-inset-*)` |

**App icon**

A gradient shield with a white keyhole, drawn in a 24-unit coordinate system and shared with the in-app `OneTotpMark`:

| Scope | Spec |
| --- | --- |
| Source | `develop/src-tauri/app-icon.svg` (1024×1024, transparent) |
| Desktop / iOS | All sizes generated from the source via `npm run tauri icon` |
| Android adaptive icon | Separate foreground layer `app-icon-android-fg.svg` — the shield occupies ~60% of the 108 dp canvas, centered with margins so circular masks never clip its shoulders (`android_fg_scale: 62` in `app-icon-manifest.json`) |
| Colors | Brand gradient `#34D399 → #22D3EE → #6366F1`, keyhole in pure white |

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
| Screenshot protection | Windows `WDA_EXCLUDEFROMCAPTURE` / macOS content protection / Android `FLAG_SECURE` / iOS secure text field layer (the OS has no `FLAG_SECURE` equivalent) |
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
| **iOS** | arm64 | `-unsigned.ipa` | **Unsigned** — you sign it yourself (see below) |

> [!TIP]
> There is no 32-bit Windows (x86) build — Tauri 2 does not support that target, so it is not an omission.

**Installing on iOS (unsigned build)**

The release ships an **unsigned** `.ipa`. Neither Tauri nor GitHub Actions can sign it for you: the signing identity belongs to your own Apple ID. You need to re-sign it once before installing — pick one:

| Method | Needs a Mac | Needs a developer account | Notes |
| --- | --- | --- | --- |
| **Sideloadly / AltStore** | No | No (a free Apple ID works) | Easiest. Clients for Windows and macOS; sign in with your Apple ID and drop the `.ipa` in. Certificate lasts 7 days, then re-sign |
| **Xcode** | Yes | No (a free Apple ID works) | Put the `.app` from the `.ipa` into a project and sign with your personal team |
| **Apple Developer account** | Depends | Yes ($99/yr) | Ad Hoc / TestFlight distribution, certificate valid for a year — suits long-term personal use or small-scale distribution |

> [!IMPORTANT]
> Free Apple ID signatures expire after 7 days and must be re-signed. Your data is kept as long as you don't delete the app.
> Re-signing a build over the existing one preserves the vault and keys, which live inside the app sandbox.

**First-run notes**

- **macOS**: an unsigned build must be opened via right-click → Open, or run `xattr -dr com.apple.quarantine OneTOTP.app`.
- **Windows**: SmartScreen may warn about an unknown publisher — choose "More info → Run anyway".
- **Android**: allow installing apps from this source in system settings.
- **iOS**: tapping an unsigned `.ipa` will not install anything — re-sign it first using the table above.

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

**Mobile (iOS)**

The iOS project can only be generated and built on macOS (Xcode required):

```bash
cd develop
npm run tauri ios init       # first-time project generation (macOS)
npm run tauri ios build      # produces an installable .ipa when signing is configured
npm run tauri ios build -- --no-sign   # produces an unsigned build
```

**Automated all-platform builds**

The repo ships a [GitHub Actions workflow](.github/workflows/release.yml). Pushing a `v*` tag triggers a build matrix covering Windows / macOS / Linux / Android / iOS and creates a Release automatically.

The iOS job needs **no Apple credentials at all** — it only performs an unsigned build and produces `OneTOTP_x.y.z_ios-unsigned.ipa`, which you re-sign yourself following the "Installing on iOS" section above. This keeps signing identities out of an open-source repo (and they belong to the user anyway); the trade-off is that there is no ready-to-install iOS artifact.

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
│     ├─ plugins/          # bundled plugins (biometrics, native QR scanner, iOS screen guard)
│     ├─ Info.plist        # iOS usage descriptions (camera / Face ID), merged at build time
│     └─ tauri.conf.json
```

### Tech stack

| Layer | Technology |
| --- | --- |
| Desktop / mobile shell | **Tauri 2** (Rust) |
| Frontend | **React 19** + **TypeScript** + **Vite 8** |
| Cryptography | `aes-gcm` · `argon2` · `rand` · `zeroize` |
| OTP algorithms | `hmac` · `sha1` · `sha2` · `base32` |
| QR scanning | Android: CameraX + ZXing (native); iOS: AVFoundation + 取景蒙版; desktop: `jsqr` (parsed locally) |
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
