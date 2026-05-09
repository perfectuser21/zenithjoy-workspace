@echo off
chcp 65001 >nul

echo [uninstall] removing %APPDATA%\zenithjoy-agent ...
if exist "%APPDATA%\zenithjoy-agent" rmdir /s /q "%APPDATA%\zenithjoy-agent"

echo [uninstall] stopping any running zenithjoy-agent.exe ...
taskkill /im zenithjoy-agent.exe /f >nul 2>&1

echo [uninstall] removing scheduled task ZenithJoyAgent ...
schtasks /delete /tn "ZenithJoyAgent" /f >nul 2>&1

echo [uninstall] removing chrome user-data-dir ...
if exist "%USERPROFILE%\.zj-chrome" rmdir /s /q "%USERPROFILE%\.zj-chrome"

echo [uninstall] removing agent log dir ...
if exist "%USERPROFILE%\.zj" rmdir /s /q "%USERPROFILE%\.zj"

echo [uninstall] scheduling removal of install-pack folder ...
set "PARENT_DIR=%~dp0"
echo @echo off > "%TEMP%\zj-cleanup.bat"
echo timeout /t 2 /nobreak ^>nul >> "%TEMP%\zj-cleanup.bat"
echo rmdir /s /q "%PARENT_DIR%" >> "%TEMP%\zj-cleanup.bat"
echo del "%TEMP%\zj-cleanup.bat" >> "%TEMP%\zj-cleanup.bat"
start "" cmd /c "%TEMP%\zj-cleanup.bat"

echo [uninstall] done. Closing in 3 seconds...
timeout /t 3 /nobreak >nul
exit /b 0
