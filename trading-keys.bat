@echo off

rem Change directory to your specific folder
cd /d "C:\Documents\trading-keys-next"

rem Start Redis server in the background
start "" /b npm run redis

rem Run the service in the background
start "" /b npm run dev

rem Open Chrome at localhost:3000
start "" chrome http://localhost:3000

rem Close the command prompt window immediately
