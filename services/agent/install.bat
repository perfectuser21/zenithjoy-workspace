@echo off
chcp 65001 > nul
echo ========================================
echo  ZenithJoy Agent v1.0 Installer
echo ========================================
echo.

set /p LICENSE="License Key: "
if "%LICENSE%"=="" (
    echo License key required.
    pause
    exit /b 1
)

echo.
echo Installing...
zenithjoy-agent.exe --license=%LICENSE%

echo.
echo Agent started. Check tray icon at bottom-right.
echo To run again, just double-click zenithjoy-agent.exe
pause
