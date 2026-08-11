@echo off
chcp 65001 >nul
title 松涧听澜 · 发布候选版预览
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if exist .env (
  for /f "tokens=1,* delims==" %%A in ('findstr /r /v "^[#;]" ".env"') do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

if not exist "state" mkdir "state"

if not exist ".venv\Scripts\python.exe" (
  echo [1/5] 首次启动：正在创建 Python 虚拟环境……
  py -3 -m venv ".venv" >nul 2>nul
  if errorlevel 1 (
    python -m venv ".venv" >nul 2>nul
  )
)

if not exist ".venv\Scripts\python.exe" (
  echo 未找到可用 Python。请安装 Python 3.11+ 后重新运行本脚本。
  pause
  exit /b 1
)

set "PORTAL_PY=.venv\Scripts\python.exe"
set "PORTAL_PYW=.venv\Scripts\pythonw.exe"

if /I "%BRAIN_WEB_INSTALL_OPTIONAL_DEPS%"=="1" (
  if not exist "state\pip_ready.txt" (
    echo [2/5] 正在安装可选 Python 依赖……
    "%PORTAL_PY%" -m pip install --upgrade pip
    if errorlevel 1 goto :pip_failed
    "%PORTAL_PY%" -m pip install -r requirements.txt
    if errorlevel 1 goto :pip_failed
    >"state\pip_ready.txt" echo ok
  )
) else (
  echo [2/5] 跳过可选 Python 依赖安装；门户预览不需要联网安装。
)

set "USING_DEMO_VAULT="
if not defined BRAIN_WEB_VAULT (
  set "BRAIN_WEB_VAULT=%CD%\demo_vault"
  set "USING_DEMO_VAULT=1"
)
if not exist "%BRAIN_WEB_VAULT%" (
  echo 未找到 BRAIN_WEB_VAULT，改用候选版演示 Vault：%BRAIN_WEB_VAULT%
  set "USING_DEMO_VAULT=1"
)
if defined USING_DEMO_VAULT (
  echo [3/5] 正在准备演示 Vault……
  "%PORTAL_PY%" "scripts\bootstrap_demo_vault.py" --vault "%BRAIN_WEB_VAULT%"
  if errorlevel 1 (
    echo 演示 Vault 创建失败。
    pause
    exit /b 1
  )
)

if not exist "www\index.html" (
  echo [4/5] 尚未构建前端，正在构建……
  where npm >nul 2>nul
  if errorlevel 1 (
    echo 未找到 Node.js/npm，且 www\index.html 不存在。请安装 Node.js 20+ 或使用已构建的候选包。
    pause
    exit /b 1
  )
  pushd frontend
  if not exist "node_modules" call npm ci
  if errorlevel 1 (
    popd
    echo 前端依赖安装失败。
    pause
    exit /b 1
  )
  call npm run build
  if errorlevel 1 (
    popd
    echo 前端构建失败。
    pause
    exit /b 1
  )
  popd
)

if not defined BRAIN_WEB_PORTAL_PORT set "BRAIN_WEB_PORTAL_PORT=8765"
set /a START_PORT=%BRAIN_WEB_PORTAL_PORT% >nul 2>nul
if errorlevel 1 (
  echo BRAIN_WEB_PORTAL_PORT 必须是整数。
  pause
  exit /b 1
)
set /a END_PORT=START_PORT+10
set "FOUND_PORT="
for /l %%P in (!START_PORT!,1,!END_PORT!) do (
  call :IsListening %%P
  if errorlevel 1 (
    set "FOUND_PORT=%%P"
    goto :PortFound
  )
)

echo 从 !START_PORT! 到 !END_PORT! 的本机端口均被占用，候选版未启动。
pause
exit /b 1

:PortFound
set "BRAIN_WEB_PORTAL_PORT=!FOUND_PORT!"
set "PORTAL_URL=http://127.0.0.1:!BRAIN_WEB_PORTAL_PORT!/"

if defined USING_DEMO_VAULT (
  echo [5/5] 正在刷新演示索引……
  "%PORTAL_PY%" "scripts\build_index.py" >nul 2>nul
)

echo 正在后台启动发布候选版门户……
if exist "%PORTAL_PYW%" (
  start "" "%PORTAL_PYW%" "serve_portal.pyw"
) else (
  start "" "%PORTAL_PY%" "serve_portal.pyw"
)

echo 门户地址: !PORTAL_URL!
echo Vault: %BRAIN_WEB_VAULT%
echo 默认不需要门户访问口令；如需启用，请在 .env 设置 BRAIN_WEB_PORTAL_AUTH=1 和 BRAIN_WEB_PORTAL_TOKEN。

for /l %%I in (1,1,20) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '!PORTAL_URL!'; if ($r.StatusCode -ge 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
  if not errorlevel 1 goto :OpenBrowser
  ping -n 2 127.0.0.1 >nul
)

:OpenBrowser
start "" "!PORTAL_URL!"
ping -n 2 127.0.0.1 >nul
exit /b 0

:IsListening
netstat -ano | findstr /C:"127.0.0.1:%~1" | findstr /C:"LISTENING" >nul
exit /b %errorlevel%

:pip_failed
echo Python 依赖安装失败，请检查网络、pip 与 requirements.txt。
pause
exit /b 1
