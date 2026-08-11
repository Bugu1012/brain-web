@echo off
chcp 65001 >nul
title 停止本地知识门户
set "FOUND="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "127.0.0.1:8765" ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
  set FOUND=1
)
if defined FOUND (
  echo 已停止本地知识门户服务。
) else (
  echo 门户服务未在运行（8765 端口无监听）。
)
ping -n 3 127.0.0.1 >nul
