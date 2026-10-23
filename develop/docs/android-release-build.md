# Android APK 打包（Windows 手工流程）

> 本文记录**在 Windows 上实际可用的手工打包链路**。原因是 `tauri android build` 存在一个已知限制，
> 与仓库配置无关（见下文）。命令与路径均已在本机实测。

## 0. 一键脚本（推荐）

上述流程已脚本化，不必再手工敲每一步：

```powershell
cd develop

# 完整打包（前端 + Rust + APK 签名，产物落到 dist-android/）
pwsh -File scripts/build-android-apk.ps1 -Label beta22

# 只改前端时：跳过 Rust 编译（复用已有 .so），最省时间
pwsh -File scripts/build-android-apk.ps1 -SkipRust -Label beta23

# 只验证 Rust 能编出 .so 并放好产物，不打包 APK
pwsh -File scripts/build-android-apk.ps1 -RustOnly

# 复用已有 dist 与 .so，只重新打包 + 签名
pwsh -File scripts/build-android-apk.ps1 -SkipWeb -SkipRust -Label beta24
```

脚本读取 `gen/android/key.properties` 取签名凭据（该文件被 git 忽略），
并通过 `apksigner verify` 自校验签名。下面是它等价的手工步骤，供排错时对照。

> ⚠️ `-SkipRust` 会复用**上次编译的** `.so`。只要动过 `src-tauri/src/**` 或插件，
> 就必须让它重新编译，否则打出来的 APK 里跑的是旧后端。

## 1. 为什么要手工做

Windows 上 `tauri android build` 在 Rust 的 `libonetotp_lib.so` 编译完成之后会失败：
Tauri 需要在 `jniLibs/<abi>/` 下为产物创建**符号链接**，而 Windows 默认不允许创建符号链接
（未开启开发者模式 / 进程无 `SeCreateSymbolicLinkPrivilege`）。

所以流程被拆成「Rust 产物 + 前端产物手工就位 → 只让 gradle 做打包」。

## 2. 步骤

以下命令的工作目录为 `develop/`（除第 4 步的 gradle 需在 `gen/android/` 下执行）。

### 2.1 前端产物

```bash
cd develop
npm run build        # 产出 develop/dist/
```

### 2.2 Rust Android 产物

编译 aarch64 目标的 `libonetotp_lib.so`（crate 名来自 `src-tauri/Cargo.toml` 的 `[lib] name = "onetotp_lib"`）。

### 2.3 手工放置两类产物

| 产物 | 目标位置 | 说明 |
| --- | --- | --- |
| `libonetotp_lib.so` | `src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/` | 替代 Tauri 本应创建的符号链接 |
| `dist/*` | `src-tauri/gen/android/app/src/main/assets/` | **必须同步**。该目录是 WebView 加载的前端内容，保留旧文件就会打出旧界面 |

`assets/` 的形态应包含 `index.html`、`splash.css`、`theme-boot.js`、`favicon.svg` 以及 `assets/`（vite 的 js/css 分包）。

### 2.4 打包（跳过 rust 任务）

```bash
cd develop/src-tauri/gen/android
gradlew assembleArm64Release -x rustBuildArm64Release
```

产物：`app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk`

> `-x rustBuildArm64Release` 是关键：跳过 gradle 侧触发的 rust 构建与符号链接步骤，
> 直接使用 2.3 手工放置的 `.so`。

## 3. 签名

`app/build.gradle.kts` **没有** `signingConfigs` 配置，所以 gradle 只产出 **unsigned** APK
（`apksigner verify` 对它报 `Missing META-INF/MANIFEST.MF`，属预期）。签名必须手工补一步：

- keystore：`develop/src-tauri/gen/android/onetotp-release.keystore`（PKCS12，别名 `onetotp`）
- 密码：见 `develop/src-tauri/gen/android/key.properties`（该文件与 `*.keystore` 均被 git 忽略）

```bash
apksigner sign \
  --ks onetotp-release.keystore --ks-key-alias onetotp \
  --ks-pass pass:<storePassword> --key-pass pass:<keyPassword> \
  --out OneTotp_<版本>_android_arm64.apk \
  app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk
```

签名证书（已核对，`dist-android/` 内历史 beta 包与本 keystore 一致）：

```
CN=OneTotp, OU=Dev, O=OneTotp, L=NA, ST=NA, C=CN
SHA-256: 0E:FE:3E:59:3B:FD:FF:82:6F:C5:74:82:3B:A3:E9:F3:0B:5E:41:43:E0:4D:74:D2:0B:E6:F0:A9:5D:3D:D4:3E
```

最后把 apk 复制到仓库根的 `dist-android/`（该目录与 `*.apk` 均被 git 忽略）。

## 4. 版本号来源

- 应用版本：`src-tauri/tauri.conf.json` 的 `version`（当前 `0.4.0`）
- Android 侧：`app/tauri.properties` 的 `tauri.android.versionName=0.4.0` / `versionCode=2000`
  （由 Tauri 生成，改版本号需同步）

## 5. 备注

- 历史 beta 包散落在 `gen/android/` 根目录与 `dist-android/`（beta1…beta21），不要误当源码提交。
- `gradle.properties` 里有 `android.overridePathCheck=true`：仓库路径含中文（`D:\开发\...`），
  Windows 下需跳过 AGP 的非 ASCII 路径检查。
- 现有产物的命名是 `OneTotp_{版本}_android_arm64.apk`，与 README 中 `OneTotp_{版本}_{系统}_{架构}-{类型}`
  的规则不完全一致（缺 `-{类型}` 后缀），如需统一要连同 CI 的命名逻辑一起改。
