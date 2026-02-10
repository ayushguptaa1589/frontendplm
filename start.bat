@echo off
REM Quick Start Script for PLM System

echo.
echo ============================================
echo     PLM System - Quick Start
echo ============================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo [✓] Node.js detected
echo.

REM Check if npm is installed
npm --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm is not installed!
    pause
    exit /b 1
)

echo [✓] npm detected
echo.

REM Install dependencies
echo Installing dependencies...
call npm install

if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo [✓] Dependencies installed
echo.

REM Start the server
echo ============================================
echo     Starting PLM Server...
echo ============================================
echo.
echo Server running at: http://localhost:5000
echo.
echo Default Credentials:
echo   - Admin: admin / password123
echo   - Designer: designer / password123
echo   - Approver: approver / password123
echo.
echo Press Ctrl+C to stop the server
echo.

call npm start

pause
