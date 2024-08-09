@echo off

rem Change directory to your specific folder
cd /d "C:\Documents\trading-keys-next"

rem Start Redis server
npm run redis

rem Run the service
npm run dev

rem Open Chrome at localhost:3000
start chrome http://localhost:3000

rem Pause to keep the command prompt open
pause
