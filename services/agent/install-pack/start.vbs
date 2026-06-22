' start.vbs — ZenithJoy Agent 无窗口启动入口（去黑窗）
'
' 客户双击此文件即启动 Agent：用 WScript.Shell.Run windowStyle=0 隐藏拉起 start.bat，
' 全程无 cmd/conhost 黑窗。这是「无黑窗」的根因机制（Run 第二参数 0 = 隐藏窗口，
' 第三参数 False = 不等待）。
'
' 内置三道护栏（对齐 contract / DoD）：
'   1. 单实例守卫：WMI 查 zenithjoy-agent.exe，已运行则写日志跳过、不重复拉起（防多开）。
'   2. launch.log 大小轮转：写日志前先判大小，超 1MB 删除重建，防无限增长（写前轮转避免竞态）。
'   3. 拉起失败留痕：On Error Resume Next + 失败写一行 ERROR 到 launch.log，供客户报修（PRD 边界#2 / 风险 R2）。
'
' 日志路径用 %APPDATA% 环境推导，不写死绝对路径。

Option Explicit

Const HIDDEN = 0            ' WScript.Shell.Run 窗口样式：0 = 隐藏窗口（无黑窗根因）
Const LOG_MAX = 1048576    ' launch.log 轮转阈值 = 1MB

Dim shell, fso, scriptDir, batPath, appData, logDir, logPath

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' 本 vbs 所在目录 + 同目录下的 start.bat
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = fso.BuildPath(scriptDir, "start.bat")

' 日志目录：%APPDATA%\zenithjoy-agent\launch.log
appData = shell.ExpandEnvironmentStrings("%APPDATA%")
logDir = fso.BuildPath(appData, "zenithjoy-agent")
logPath = fso.BuildPath(logDir, "launch.log")

On Error Resume Next        ' 任何失败都不弹错误框，落日志留痕（去黑窗 + 报修可观测）

' 确保日志目录存在
If Not fso.FolderExists(logDir) Then
  fso.CreateFolder(logDir)
End If

' ── launch.log 大小轮转：写前先判大小，超阈值删除重建（防无限增长 + 写前轮转规避竞态）──
If fso.FileExists(logPath) Then
  Dim existing
  Set existing = fso.GetFile(logPath)
  If existing.Size >= LOG_MAX Then
    fso.DeleteFile logPath, True
  End If
End If

' ── 单实例守卫：已运行则跳过，不重复拉起（防多开）──
If AgentRunning() Then
  WriteLog "[vbs] zenithjoy-agent.exe already running, skip launch"
  WScript.Quit 0
End If

' ── 隐藏拉起 start.bat（windowStyle=0 + 不等待）──
WriteLog "[vbs] launch start.bat (hidden, windowStyle=0)"
shell.Run """" & batPath & """", 0, False

' ── 拉起失败留痕（PRD 边界#2 / 风险 R2：wscript 被组策略/AV 拦或 start.bat 缺失）──
If Err.Number <> 0 Then
  WriteLog "[vbs] ERROR launch failed code=" & Err.Number & " desc=" & Err.Description
  Err.Clear
End If

WScript.Quit 0

' ── 探测 zenithjoy-agent.exe 是否在跑（WMI 真实进程表，非假设）──
Function AgentRunning()
  Dim wmi, procs, proc
  AgentRunning = False
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  If Err.Number <> 0 Then
    Err.Clear
    Exit Function
  End If
  Set procs = wmi.ExecQuery("SELECT Name FROM Win32_Process WHERE Name = 'zenithjoy-agent.exe'")
  For Each proc In procs
    AgentRunning = True
    Exit For
  Next
End Function

' ── 追加写一行到 launch.log（带时间戳）──
Sub WriteLog(msg)
  Dim stream
  Set stream = fso.OpenTextFile(logPath, 8, True)   ' 8 = ForAppending, True = 不存在则创建
  If Err.Number = 0 Then
    stream.WriteLine Now & " " & msg
    stream.Close
  Else
    Err.Clear
  End If
End Sub
