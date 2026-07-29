import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const waitFor=async(check:()=>Promise<boolean>,timeoutMs=10_000)=>{
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    if(await check())return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Timed out waiting for local automation control server.');
};

test('control server starts and stops isolated demo automation without broker access',async()=>{
  const port=4408+Math.floor(Math.random()*100);
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'trading-keys-control-'));
  const child=spawn(process.execPath,['--import','tsx','pi/controlServer.ts'],{
    cwd:process.cwd(),stdio:'ignore',
    env:{...process.env,PULSE_PORT:String(port),PULSE_HOST:'127.0.0.1',
      TRADING_KEYS_DATA_DIRECTORY:data,
      TRADING_KEYS_AUTOMATION_TEST_RUNNER:path.resolve('tests/fixtures/fakeAutomationRunner.mjs')},
  });
  try{
    await waitFor(async()=>fetch(`http://127.0.0.1:${port}/api/status`).then(response=>response.ok).catch(()=>false));
    const initial=await fetch(`http://127.0.0.1:${port}/api/status`).then(response=>response.json());
    assert.equal(initial.runtime.running,false);
    const started=await fetch(`http://127.0.0.1:${port}/api/start`,{method:'POST'}).then(response=>response.json());
    assert.equal(started.running,true);
    const stopped=await fetch(`http://127.0.0.1:${port}/api/stop`,{method:'POST'}).then(response=>response.json());
    assert.equal(stopped.running,false);
  }finally{
    child.kill('SIGTERM');
  }
});
