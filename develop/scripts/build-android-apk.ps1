<#
.SYNOPSIS
    OneTotp Android APK 一键打包（Windows 手工链路）。

.DESCRIPTION
    在 Windows 上 `tauri android build` 会在 Rust 的 .so 编译完成后失败——Tauri 需要在
    jniLibs/<abi>/ 下创建符号链接，而 Windows 默认不允许（未开启开发者模式）。本脚本
    把该限制绕过去：Rust 产物与前端产物手工就位，只让 gradle 负责打包与签名。

    与手工流程完全等价：
      1. npm run build                        → develop/dist
      2. tauri android build（预期失败）        → 产出 libonetotp_lib.so
      3. 复制 .so → jniLibs/arm64-v8a
      4. 同步 dist/* → app/src/main/assets
      5. gradlew assembleArm64Release -x rustBuildArm64Release
      6. zipalign + apksigner 签名 → dist-android/

.PARAMETER Version
    产物文件名中的版本号，默认取 src-tauri/tauri.conf.json。

.PARAMETER Label
    产物文件名中的标签，默认 beta。纯数字后缀请自行传入（如 beta22）。

.PARAMETER SkipWeb
    跳过前端构建（复用已有的 develop/dist）。

.PARAMETER SkipRust
    跳过 Rust 编译（复用已有的 .so，日常只改前端时用这个最省时间）。

.PARAMETER RustOnly
    只编译 Rust 并放好 .so，不打包 APK（用于先确认编译是否通过）。

.EXAMPLE
    pwsh -File scripts/build-android-apk.ps1 -Label beta22

.EXAMPLE
    pwsh -File scripts/build-android-apk.ps1 -SkipRust -Label beta23
#>
[CmdletBinding()]
param(
    [string]$Version = "",
    [string]$Label = "beta",
    [switch]$SkipWeb,
    [switch]$SkipRust,
    [switch]$RustOnly
)

$ErrorActionPreference = "Stop"

# ── 路径 ──
$DevelopDir = Split-Path -Parent $PSScriptRoot
$TauriDir   = Join-Path $DevelopDir "src-tauri"
$GenDir     = Join-Path $TauriDir "gen\android"
$AppDir     = Join-Path $GenDir "app"
$JniDir     = Join-Path $AppDir "src\main\jniLibs\arm64-v8a"
$AssetsDir  = Join-Path $AppDir "src\main\assets"
$DistDir    = Join-Path $DevelopDir "dist"
$OutDir     = Join-Path (Split-Path -Parent $DevelopDir) "dist-android"
$Abi        = "arm64-v8a"
$SoName     = "libonetotp_lib.so"

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}
function Write-Ok([string]$Text) { Write-Host "  OK   $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text) { Write-Host "  WARN $Text" -ForegroundColor Yellow }
function Fail([string]$Text) { Write-Host "  FAIL $Text" -ForegroundColor Red; exit 1 }

# ── 前置检查 ──
Write-Step "检查环境"
if (-not (Test-Path $GenDir)) {
    Fail "找不到 Android 工程：$GenDir（先执行 npm run tauri android init）"
}
if (-not (Test-Path (Join-Path $GenDir "gradlew.bat"))) {
    Fail "找不到 gradlew.bat：$GenDir"
}

# Android SDK：优先 local.properties，其次环境变量
$SdkDir = $null
$LocalProps = Join-Path $GenDir "local.properties"
if (Test-Path $LocalProps) {
    $line = Get-Content $LocalProps | Where-Object { $_ -match '^\s*sdk\.dir\s*=' } | Select-Object -First 1
    if ($line) { $SdkDir = ($line -split '=', 2)[1].Trim() -replace '\\\\', '\' }
}
if (-not $SdkDir) { $SdkDir = $env:ANDROID_HOME }
if (-not $SdkDir) { $SdkDir = $env:ANDROID_SDK_ROOT }
if (-not $SdkDir) { $SdkDir = Join-Path $env:LOCALAPPDATA "Android\Sdk" }
if (-not (Test-Path $SdkDir)) { Fail "找不到 Android SDK（检查 local.properties 的 sdk.dir）" }
Write-Ok "SDK: $SdkDir"

$BuildTools = Get-ChildItem (Join-Path $SdkDir "build-tools") -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [version]($_.Name -replace '[^\d\.].*$', '') } -Descending | Select-Object -First 1
if (-not $BuildTools) { Fail "找不到 build-tools（需要 apksigner / zipalign）" }
$ApkSigner = Join-Path $BuildTools.FullName "apksigner.bat"
$ZipAlign  = Join-Path $BuildTools.FullName "zipalign.exe"
Write-Ok "build-tools: $($BuildTools.Name)"

# 签名凭据：key.properties（已被 .gitignore 忽略）
$KeyPropsPath = Join-Path $GenDir "key.properties"
if (-not (Test-Path $KeyPropsPath)) {
    Fail "缺少签名配置 $KeyPropsPath（storeFile/keyAlias/storePassword/keyPassword）"
}
$keyProps = @{}
Get-Content $KeyPropsPath | ForEach-Object {
    if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)$') { $keyProps[$matches[1]] = $matches[2].Trim() }
}
foreach ($k in @("storeFile", "keyAlias", "storePassword", "keyPassword")) {
    if (-not $keyProps.ContainsKey($k)) { Fail "key.properties 缺少字段：$k" }
}
$KeystorePath = Join-Path $GenDir $keyProps["storeFile"]
if (-not (Test-Path $KeystorePath)) { Fail "找不到 keystore：$KeystorePath" }
Write-Ok "keystore: $(Split-Path -Leaf $KeystorePath) (alias=$($keyProps['keyAlias']))"

# 版本号：默认取 tauri.conf.json
if (-not $Version) {
    $conf = Get-Content (Join-Path $TauriDir "tauri.conf.json") -Raw | ConvertFrom-Json
    $Version = $conf.version
}
Write-Ok "版本: $Version  标签: $Label"

# ── 1. 前端 ──
if ($SkipWeb) {
    Write-Step "跳过前端构建（复用 dist）"
    if (-not (Test-Path (Join-Path $DistDir "index.html"))) { Fail "dist 不存在，无法跳过：先执行 npm run build" }
} else {
    Write-Step "构建前端"
    Push-Location $DevelopDir
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { Fail "前端构建失败（exit $LASTEXITCODE）" }
    } finally { Pop-Location }
    Write-Ok "dist 已生成"
}

# ── 2. Rust ──
$SoSource = Join-Path $TauriDir "target\aarch64-linux-android\release\$SoName"
if ($SkipRust) {
    Write-Step "跳过 Rust 编译（复用已有 .so）"
    if (-not (Test-Path $SoSource)) { Fail "没有可复用的 .so：$SoSource" }
} else {
    Write-Step "编译 Rust（预期在符号链接阶段失败）"
    $startedAt = Get-Date
    Push-Location $DevelopDir
    try {
        & npm run tauri -- android build --apk --target aarch64 2>&1 | ForEach-Object { Write-Host "    $_" }
        $tauriExit = $LASTEXITCODE
    } finally { Pop-Location }

    if ($tauriExit -eq 0) {
        # 极少数环境允许符号链接：tauri 自己成功，这里仍需校验 .so 是否够新
        Write-Warn2 "tauri android build 竟然成功了；仍按手工流程继续以统一产物命名"
    } else {
        Write-Warn2 "tauri android build 退出码 $tauriExit（Windows 符号链接限制，属预期）"
    }

    if (-not (Test-Path $SoSource)) {
        Fail "未产出 $SoName，说明失败发生在编译阶段而非符号链接阶段，请检查上方日志"
    }
    if ((Get-Item $SoSource).LastWriteTime -lt $startedAt.AddMinutes(-1)) {
        Fail "找到的 .so 早于本次构建开始时间，可能没有真正重新编译"
    }
    $size = "{0:N0}" -f (Get-Item $SoSource).Length
    Write-Ok "$SoName 已生成（$size 字节）"
}

# ── 3. 放置 .so ──
Write-Step "放置 Rust 产物"
New-Item -ItemType Directory -Force -Path $JniDir | Out-Null
Copy-Item -Force $SoSource (Join-Path $JniDir $SoName)
$jniSo = Join-Path $JniDir $SoName
if ((Get-Item $jniSo).Length -ne (Get-Item $SoSource).Length) { Fail "复制后的 .so 大小不一致" }
Write-Ok "$Abi/$SoName"

# ── 4. 同步前端产物 ──
Write-Step "同步前端产物到 assets"
New-Item -ItemType Directory -Force -Path $AssetsDir | Out-Null
# /MIR：删掉 assets 里 dist 已不存在的旧文件，避免打包进旧前端
$rc = (robocopy $DistDir $AssetsDir /MIR /NJH /NJS /NDL /NP /NFL) | Out-Null
$robocopyExit = $LASTEXITCODE
if ($robocopyExit -ge 8) { Fail "robocopy 同步失败（exit $robocopyExit）" }
if (-not (Test-Path (Join-Path $AssetsDir "index.html"))) { Fail "assets 同步后缺少 index.html" }
Write-Ok "assets 已与 dist 对齐"

if ($RustOnly) {
    Write-Step "RustOnly：到此为止"
    Write-Ok ".so 与 assets 已就位，未打包 APK"
    exit 0
}

# ── 5. gradle 打包 ──
Write-Step "递增 versionCode"
# Android 用 versionCode 判断是否为「新版本」：若与已安装版本相同，
# 文件管理器安装会静默失败或保留旧版本，表现为「改了代码但界面没变」。
#
# 注意：`tauri android build` 每次都会把 tauri.properties 重置回配置里的
# 固定值（2000），所以不能以它为基准递增——那样每次都会得到同一个数字。
# 这里用 gen/android/.versioncode 持久化计数，保证跨次构建单调递增。
$TauriProps = Join-Path $AppDir "tauri.properties"
$CounterFile = Join-Path $GenDir ".versioncode"

$baseCode = 2000
if (Test-Path $TauriProps) {
    $propsText = Get-Content $TauriProps -Raw
    if ($propsText -match 'tauri\.android\.versionCode=(\d+)') { $baseCode = [int]$matches[1] }
} else {
    Fail "找不到 $TauriProps"
}

$lastCode = 0
if (Test-Path $CounterFile) {
    $raw = (Get-Content $CounterFile -Raw).Trim()
    if ($raw -match '^\d+$') { $lastCode = [int]$raw }
}

$newCode = [Math]::Max($baseCode, $lastCode) + 1
Set-Content -Path $CounterFile -Value $newCode -NoNewline -Encoding ASCII
$propsText = $propsText -replace 'tauri\.android\.versionCode=\d+', "tauri.android.versionCode=$newCode"
Set-Content -Path $TauriProps -Value $propsText -NoNewline -Encoding UTF8
Write-Ok "versionCode: $newCode"

Write-Step "gradle 打包（跳过 rust 任务）"
Push-Location $GenDir
try {
    & .\gradlew.bat assembleArm64Release -x rustBuildArm64Release
    if ($LASTEXITCODE -ne 0) { Fail "gradle 打包失败（exit $LASTEXITCODE）" }
} finally { Pop-Location }

$UnsignedApk = Join-Path $AppDir "build\outputs\apk\arm64\release\app-arm64-release-unsigned.apk"
if (-not (Test-Path $UnsignedApk)) { Fail "找不到 gradle 产物：$UnsignedApk" }
Write-Ok "unsigned APK 已生成"

# ── 6. 对齐 + 签名 ──
Write-Step "zipalign + apksigner 签名"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$FinalName = "OneTotp_$($Version)-$($Label)_android_arm64.apk"
$AlignedApk = Join-Path $env:TEMP "onetotp-aligned-$PID.apk"
$SignedApk  = Join-Path $env:TEMP "onetotp-signed-$PID.apk"

if (Test-Path $ZipAlign) {
    & $ZipAlign -p -f 4 $UnsignedApk $AlignedApk
    if ($LASTEXITCODE -ne 0) { Fail "zipalign 失败（exit $LASTEXITCODE）" }
} else {
    Write-Warn2 "未找到 zipalign，直接对 gradle 产物签名"
    Copy-Item -Force $UnsignedApk $AlignedApk
}

& $ApkSigner sign `
    --ks $KeystorePath `
    --ks-key-alias $keyProps["keyAlias"] `
    --ks-pass "pass:$($keyProps['storePassword'])" `
    --key-pass "pass:$($keyProps['keyPassword'])" `
    --out $SignedApk $AlignedApk
if ($LASTEXITCODE -ne 0) { Fail "apksigner 签名失败（exit $LASTEXITCODE）" }

& $ApkSigner verify --print-certs $SignedApk | Select-Object -First 2 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) { Fail "签名校验失败" }

# ── 7. 输出 ──
Write-Step "输出"
$finalPath = Join-Path $OutDir $FinalName
Move-Item -Force $SignedApk $finalPath
Remove-Item -Force $AlignedApk -ErrorAction SilentlyContinue
$info = Get-Item $finalPath
Write-Ok ("{0}  ({1:N1} MB)" -f $finalPath, ($info.Length / 1MB))
Write-Host ""
Write-Host "安装：adb install -r `"$finalPath`"" -ForegroundColor Gray
