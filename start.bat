@echo off
title Sistema de Ordens de Servico
cd /d "%~dp0"

echo ====================================================
echo        A INICIAR O SISTEMA DE GESTAO DE OS
echo ====================================================
echo.
echo 1. A preparar o servidor local...
echo 2. A abrir o navegador em http://localhost:3000
echo.
echo [Dica] Nao feche esta janela enquanto estiver a usar o sistema!
echo.

:: Abre o navegador padrao apos 2 segundos (tempo para o servidor arrancar)
timeout /t 2 /nobreak >nul
start http://localhost:3000

:: Inicia o servidor Node.js
node server.js
pause