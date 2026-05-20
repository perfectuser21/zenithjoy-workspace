while($true) {
  $listening = netstat -an | Select-String "0.0.0.0:7788.*LISTENING"
  if (-not $listening) {
    $node = "C:\Program Files\nodejs\node.exe"
    $script = "C:\automation\douyin-transcribe.js"
    Start-Process -FilePath $node -ArgumentList $script -WorkingDirectory "C:\automation" -WindowStyle Hidden
    Add-Content "C:\automation\watchdog.log" "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') restarted service"
  }
  Start-Sleep -Seconds 30
}
