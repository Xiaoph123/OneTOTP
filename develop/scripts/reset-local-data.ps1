<#
.SYNOPSIS
    备份或重置 OneTotp 的本机数据目录。

.DESCRIPTION
    ⚠️ 重置会删除本机保险库（加密后的账户数据）。保险库里的 OTP 密钥**无法从
    备份文件之外恢复**，所以本脚本默认只备份、不删除；删除必须显式加 -Reset。

    重置前请在应用内「导入导出」页导出一份加密备份（需输入解锁口令），
    否则重置后账户需要重新录入。

.PARAMETER Reset
    备份后删除原数据目录，让应用回到「首次启动」状态。

.PARAMETER KeepBackups
    重置时保留 backups 子目录（历史快照）。默认连快照一起清掉。

.EXAMPLE
    pwsh -File scripts/reset-local-data.ps1
    # 只备份，告诉我备份到哪了

.EXAMPLE
    pwsh -File scripts/reset-local-data.ps1 -Reset
    # 备份后清空，应用下次启动会重新初始化
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Reset,
    [switch]$KeepBackups
)

$ErrorActionPreference = "Stop"

$DataDir = Join-Path $env:APPDATA "com.wanghao.onetotp"
if (-not (Test-Path $DataDir)) {
    Write-Host "数据目录不存在，无需处理：$DataDir" -ForegroundColor Yellow
    exit 0
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $env:APPDATA "com.wanghao.onetotp.backup-$stamp"

Write-Host "=== 数据目录 ===" -ForegroundColor Cyan
Get-ChildItem $DataDir -Force | ForEach-Object {
    "  {0,10}  {1:yyyy-MM-dd HH:mm}  {2}" -f $_.Length, $_.LastWriteTime, $_.Name
}

Write-Host "`n=== 备份到 $BackupDir ===" -ForegroundColor Cyan
robocopy $DataDir $BackupDir /E /NJH /NJS /NDL /NP /NFL | Out-Null
if ($LASTEXITCODE -ge 8) { throw "备份失败（robocopy exit $LASTEXITCODE）" }
Write-Host "  完成" -ForegroundColor Green

# 校验关键文件确实被复制
foreach ($f in @("onetotp.vault.json", "onetotp.lock.json")) {
    $src = Join-Path $DataDir $f
    if (Test-Path $src) {
        $h1 = (Get-FileHash $src -Algorithm SHA256).Hash
        $h2 = (Get-FileHash (Join-Path $BackupDir $f) -Algorithm SHA256).Hash
        if ($h1 -ne $h2) { throw "备份校验失败：$f" }
        Write-Host "  校验 $f OK" -ForegroundColor Green
    }
}

if (-not $Reset) {
    Write-Host "`n仅备份完成。若要重置，请再执行一次并加 -Reset。" -ForegroundColor Yellow
    Write-Host "备份位置：$BackupDir"
    exit 0
}

if (-not $PSCmdlet.ShouldProcess($DataDir, "删除本机数据目录（已备份到 $BackupDir）")) { exit 0 }

Write-Host "`n=== 重置 ===" -ForegroundColor Cyan
Get-ChildItem $DataDir -Force | Where-Object {
    if ($KeepBackups -and $_.Name -eq "backups") { return $false }
    return $true
} | Remove-Item -Recurse -Force
Write-Host "  已清空：$DataDir" -ForegroundColor Green
Write-Host "  备份仍保留在：$BackupDir" -ForegroundColor Green
Write-Host "`n下一步：启动 OneTotp（会重新初始化），到「导入导出」页用之前导出的加密备份恢复账户。" -ForegroundColor Yellow
