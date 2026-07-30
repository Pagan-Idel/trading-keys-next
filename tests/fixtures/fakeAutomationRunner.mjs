import fs from 'node:fs';
const shutdown=()=>process.exit(0);
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
if(process.env.TRADING_KEYS_RUNNER_READY_PATH)fs.writeFileSync(process.env.TRADING_KEYS_RUNNER_READY_PATH,
  JSON.stringify({pid:process.pid,mode:'demo',readyAt:new Date().toISOString()}));
setInterval(()=>{},1_000);
