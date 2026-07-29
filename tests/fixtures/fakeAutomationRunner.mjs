const shutdown=()=>process.exit(0);
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
setInterval(()=>{},1_000);
