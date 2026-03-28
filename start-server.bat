@echo off
setlocal

cd /d "%~dp0"

if exist "server-env.bat" (
  call "server-env.bat"
)

if "%GROQ_API_KEY%"=="" (
  echo [ERROR] GROQ_API_KEY is missing.
  echo Edit server-env.bat and set your real API key.
  pause
  exit /b 1
)

echo Starting Smart Health server...
echo GROQ model: %GROQ_MODEL%
node server.js

endlocal 
