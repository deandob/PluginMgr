@echo off
set errorlevel=
node %1
set noderr=%errorlevel%
echo Exit code: %noderr%
timeout 5
if "%2"=="True" pause
exit /b %noderr%