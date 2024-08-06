@echo off

rem Change directory to your specific folder
cd /d "C:\Documents\trading-keys-next"

rem Run npm run dev
npm run redis
npm run dev

rem Change directory to your specific folder
rem cd /d "C:\Documents\trading-keys-webdriverIO"

rem Run npm run dev
rem npm run dev