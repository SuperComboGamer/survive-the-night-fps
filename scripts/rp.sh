#!/bin/bash
# rebuild, restart the production server (debug commands on), play the mine for N seconds
cd "$(dirname "$0")/.."
npm run build 2>&1 | grep -E "error|Error" ; 
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*server/index.js*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" >/dev/null 2>&1
(NODE_ENV=production GODMODE=${GOD:-0} DEBUG_COMMANDS=1 node server/index.js > /tmp/server.log 2>&1 &)
sleep 2
timeout 280 node scripts/play-mine.js "$@"
