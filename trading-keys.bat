@echo off

rem Change directory to your specific folder
cd /d "C:\Documents\trading-keys-next"

rem Start Redis server using Windows configuration
start "" /b npm run redis-windows

rem Run the service in production mode (start)
start "" /b npm run start

rem Open Chrome at localhost:4000
start "" chrome http://localhost:4000

rem Close the command prompt window immediately
