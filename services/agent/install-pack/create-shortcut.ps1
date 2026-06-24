<#
.SYNOPSIS
  生成「启动 ZenithJoy Agent」无窗快捷方式（桌面 + 安装目录），指向 start.vbs。

.DESCRIPTION
  形态收口（Sprint 06240003）：用户安装后只应看到一个**无窗**入口。
  本脚本在桌面和安装目录各放一个 .lnk 快捷方式：
    - TargetPath  = wscript.exe（系统组件）
    - Arguments   = "<安装目录>\start.vbs"（vbs 用 windowStyle=0 隐藏拉起 start.bat → 全程无黑窗）
    - IconLocation= <安装目录>\icon.ico（悦升云端 logo）
    - WindowStyle = 7（最小化；wscript 本身无窗，双保险）
  绝不生成指向 start.bat 的快捷方式（双击 bat 会弹黑色控制台）。
  幂等：重复运行覆盖同名快捷方式，不重复堆叠。

.NOTES
  由 start.bat 首次启动时自动调用（powershell -ExecutionPolicy Bypass -File create-shortcut.ps1），
  客户无需手动跑。
#>
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$VbsTarget = Join-Path $ScriptDir 'start.vbs'
$IconPath  = Join-Path $ScriptDir 'icon.ico'

if (-not (Test-Path $VbsTarget)) {
    throw "找不到 $VbsTarget — 请在解压后的安装目录运行本脚本"
}

# wscript.exe 是系统组件，路径取自系统目录，避免硬编码盘符
$Wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

$ShortcutName = '启动 ZenithJoy Agent.lnk'
$Desktop = [Environment]::GetFolderPath('Desktop')
$targets = @(
    (Join-Path $Desktop $ShortcutName),       # 桌面（用户最常点）
    (Join-Path $ScriptDir $ShortcutName)       # 安装目录（兜底入口）
)

$shell = New-Object -ComObject WScript.Shell
foreach ($lnkPath in $targets) {
    try {
        $sc = $shell.CreateShortcut($lnkPath)
        $sc.TargetPath  = $Wscript
        $sc.Arguments   = "`"$VbsTarget`""
        $sc.WorkingDirectory = $ScriptDir
        $sc.WindowStyle = 7   # 最小化（wscript 本身无窗，双保险）
        if (Test-Path $IconPath) { $sc.IconLocation = "$IconPath,0" }
        $sc.Description = 'ZenithJoy Agent（无窗启动，悦升云端）'
        $sc.Save()
        Write-Host "[shortcut] 已生成无窗快捷方式: $lnkPath -> wscript start.vbs"
    } catch {
        Write-Host "[shortcut] WARN 生成失败（非致命）: $lnkPath — $($_.Exception.Message)"
    }
}
