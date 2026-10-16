@echo off
setlocal
set "LAUNCHER_ARCH=amd64"
if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "LAUNCHER_ARCH=arm64"
if /I "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "LAUNCHER_ARCH=arm64"
if /I "%PROCESSOR_ARCHITECTURE%"=="x86" if "%PROCESSOR_ARCHITEW6432%"=="" (
  echo This package requires 64-bit Windows.
  pause
  exit /b 1
)
"%~dp0bin\windows-%LAUNCHER_ARCH%\nicoSampler-server.exe" --app "%~dp0app"
if errorlevel 1 echo Launcher failed. Extract the complete portable ZIP first and check the message above.
echo Launcher finished. An existing launcher server, if reused, remains running.
pause
endlocal
