@echo off

rem Change directory to your specific folder
cd /d "C:\Documents\trading-keys-next"

rem Start Redis server using the Windows configuration in the background
start "" /b redis-server C:/Documents/trading-keys-next/redis.windows.conf

rem Run the service in production mode (start), which will load environment variables from .env.local
start "" /b npm run start

rem Open Chrome at localhost:4000
start "" chrome http://localhost:4000

rem Close the command prompt window immediately
