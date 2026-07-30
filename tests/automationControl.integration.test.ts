import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const waitFor=async(check:()=>Promise<boolean>|boolean,timeoutMs=10_000)=>{
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    if(await check())return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Timed out waiting for local automation control server.');
};
const controlEntry=process.env.TRADING_KEYS_CONTROL_ENTRY??'pi/controlServer.ts';
const controlArguments=controlEntry.endsWith('.mjs')?[path.resolve(controlEntry)]:['--import','tsx',controlEntry];

test('control server starts and stops isolated demo automation without broker access',async()=>{
  const port=4408+Math.floor(Math.random()*100);
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'trading-keys-control-'));
  const child=spawn(process.execPath,controlArguments,{
    cwd:process.cwd(),stdio:'ignore',
    env:{...process.env,PULSE_PORT:String(port),PULSE_HOST:'127.0.0.1',
      TRADING_KEYS_DATA_DIRECTORY:data,
      TRADING_KEYS_AUTOMATION_TEST_RUNNER:path.resolve('tests/fixtures/fakeAutomationRunner.mjs'),
      TRADING_KEYS_TEST_PROCESS_COMMAND:path.resolve('tests/fixtures/fakeAutomationRunner.mjs'),
      TRADING_KEYS_TEST_PROCESS_START_TIME:'fixture-process-start',
      TRADING_KEYS_TEST_PROCESS_CGROUP:'fixture-cgroup'},
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

test('systemd-style termination preserves running intent and next boot recovers exactly one runner',async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'trading-keys-recovery-'));
  const runner=path.resolve('tests/fixtures/fakeAutomationRunner.mjs');
  const launch=(port:number)=>spawn(process.execPath,controlArguments,{
    cwd:process.cwd(),stdio:'ignore',
    env:{...process.env,PULSE_PORT:String(port),PULSE_HOST:'127.0.0.1',
      TRADING_KEYS_DATA_DIRECTORY:data,TRADING_KEYS_AUTOMATION_TEST_RUNNER:runner,
      TRADING_KEYS_TEST_PROCESS_COMMAND:runner,TRADING_KEYS_TEST_PROCESS_START_TIME:'fixture-process-start',
      TRADING_KEYS_TEST_PROCESS_CGROUP:'fixture-cgroup'},
  });
  const firstPort=4608+Math.floor(Math.random()*50),first=launch(firstPort);
  let second:ReturnType<typeof spawn>|null=null;
  try{
    await waitFor(async()=>fetch(`http://127.0.0.1:${firstPort}/api/status`).then(r=>r.ok).catch(()=>false));
    const startRequests=await Promise.all([
      fetch(`http://127.0.0.1:${firstPort}/api/start`,{method:'POST'}),
      fetch(`http://127.0.0.1:${firstPort}/api/start`,{method:'POST'}),
    ]);
    assert.equal(startRequests.filter(response=>response.ok).length,2);
    const startedBodies=await Promise.all(startRequests.map(response=>response.json()));
    assert.equal(new Set(startedBodies.map(body=>body.pid)).size,1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data,'automation-desired-state.json'),'utf8')).desiredState,'running');
    first.kill('SIGTERM');
    await waitFor(()=>first.exitCode!==null||first.killed,5_000);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data,'automation-desired-state.json'),'utf8')).desiredState,'running');

    const secondPort=4660+Math.floor(Math.random()*40);
    second=launch(secondPort);
    await waitFor(async()=>fetch(`http://127.0.0.1:${secondPort}/api/status`).then(async response=>{
      if(!response.ok)return false;return (await response.json()).runtime.running===true;
    }).catch(()=>false));
    const recovered=await fetch(`http://127.0.0.1:${secondPort}/api/status`).then(response=>response.json());
    assert.equal(recovered.runtime.desiredState,'running');
    await fetch(`http://127.0.0.1:${secondPort}/api/stop`,{method:'POST'});
    assert.equal(JSON.parse(fs.readFileSync(path.join(data,'automation-desired-state.json'),'utf8')).desiredState,'stopped');
  }finally{
    first.kill('SIGTERM');
    second?.kill('SIGTERM');
  }
});

test('a desired-state persistence failure stops the ready runner and remains fail closed',async()=>{
  const port=4708+Math.floor(Math.random()*50);
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'trading-keys-write-failure-'));
  const runner=path.resolve('tests/fixtures/fakeAutomationRunner.mjs');
  const child=spawn(process.execPath,controlArguments,{
    cwd:process.cwd(),stdio:'ignore',env:{...process.env,PULSE_PORT:String(port),PULSE_HOST:'127.0.0.1',
      TRADING_KEYS_DATA_DIRECTORY:data,TRADING_KEYS_AUTOMATION_TEST_RUNNER:runner,
      TRADING_KEYS_TEST_PROCESS_COMMAND:runner,TRADING_KEYS_TEST_PROCESS_START_TIME:'fixture-process-start',
      TRADING_KEYS_TEST_PROCESS_CGROUP:'fixture-cgroup',TRADING_KEYS_TEST_DESIRED_STATE_WRITE_FAILURE:'true'},
  });
  try{
    await waitFor(async()=>fetch(`http://127.0.0.1:${port}/api/status`).then(r=>r.ok).catch(()=>false));
    const response=await fetch(`http://127.0.0.1:${port}/api/start`,{method:'POST'});
    assert.equal(response.ok,false);
    assert.match(String((await response.json()).error),/persistence failure/);
    await waitFor(async()=>fetch(`http://127.0.0.1:${port}/api/status`).then(async r=>!(await r.json()).runtime.running));
    assert.equal(fs.existsSync(path.join(data,'automation-runtime.json')),false);
    assert.equal(fs.existsSync(path.join(data,'automation-runner.ready')),false);
  }finally{child.kill('SIGTERM')}
});
