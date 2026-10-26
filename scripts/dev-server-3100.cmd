@echo off
rem Development server on port 3100, for testing while the installed Hasu uses 3000.
set HASU_PORT=3100
cd /d "%~dp0.."
npx tsx server.ts
