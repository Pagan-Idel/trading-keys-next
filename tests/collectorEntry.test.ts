import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveCandleCollectorEntry } from '../utils/candleCollectorRuntime.ts';
import { REQUIRED_PI_RUNTIME_FILES, validatePiRuntimeContents } from '../scripts/piRuntimeValidation.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'artifacts','pi-runtime');
const compiledRunner=path.join(runtime,'startRunner.mjs');
const compiledCollector=path.join(runtime,'candleCollectorWorker.mjs');
const sourceRunner=path.join(root,'runner','strategyRunner.ts');

before(()=>execFileSync(process.execPath,['scripts/buildPiRuntime.mjs'],{cwd:root,stdio:'pipe'}));

const withoutCollectorOverride=()=>{
  const environment={...process.env};
  delete environment.TRADING_KEYS_COLLECTOR_ENTRY;
  return environment;
};

const waitForFile=async(file:string,timeoutMs=5_000)=>{
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){if(fs.existsSync(file))return;await new Promise(resolve=>setTimeout(resolve,25))}
  throw new Error(`Timed out waiting for ${file}`);
};

const collectProcess=(child:ReturnType<typeof spawn>)=>new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
  let stdout='',stderr='';
  child.stdout?.on('data',chunk=>stdout+=chunk);
  child.stderr?.on('data',chunk=>stderr+=chunk);
  child.once('error',reject);
  child.once('exit',code=>resolve({code,stdout,stderr}));
});

test('compiled runner defaults to its sibling candleCollectorWorker.mjs',()=>{
  assert.equal(resolveCandleCollectorEntry({runnerModuleUrl:pathToFileURL(compiledRunner).href}),compiledCollector);
  assert.ok(fs.statSync(compiledCollector).isFile());
});

test('local TypeScript runner defaults to the source collector',()=>{
  assert.equal(resolveCandleCollectorEntry({runnerModuleUrl:pathToFileURL(sourceRunner).href}),path.join(root,'workers','candleCollectorWorker.ts'));
});

test('explicit collector override takes precedence and resolves relative to the runner module',()=>{
  const override=path.join(runtime,'advanced-collector.mjs');
  assert.equal(resolveCandleCollectorEntry({runnerModuleUrl:pathToFileURL(compiledRunner).href,override:'advanced-collector.mjs',exists:file=>file===override}),override);
});

test('missing collector override fails with the resolved path',()=>{
  const missing=path.join(runtime,'missing-collector.mjs');
  assert.throws(()=>resolveCandleCollectorEntry({runnerModuleUrl:pathToFileURL(compiledRunner).href,override:missing}),
    error=>error instanceof Error&&error.message===`Candle collector entry does not exist: ${missing}`);
});

test('collector resolution does not depend on process.cwd',()=>{
  const previous=process.cwd(),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'collector-cwd-'));
  try{process.chdir(temporary);assert.equal(resolveCandleCollectorEntry({runnerModuleUrl:pathToFileURL(compiledRunner).href}),compiledCollector)}
  finally{process.chdir(previous);fs.rmSync(temporary,{recursive:true,force:true})}
});

test('Pi runtime validation rejects a missing compiled collector entry',()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'collector-manifest-'));
  try{
    for(const file of REQUIRED_PI_RUNTIME_FILES)fs.writeFileSync(path.join(temporary,file),'fixture');
    fs.rmSync(path.join(temporary,'candleCollectorWorker.mjs'));
    assert.throws(()=>validatePiRuntimeContents(temporary),/candleCollectorWorker\.mjs/);
  }finally{fs.rmSync(temporary,{recursive:true,force:true})}
});

test('built Pi runtime records the collector and excludes TypeScript workers and runtime tooling',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(runtime,'BUILD-MANIFEST.json'),'utf8'));
  assert.ok(manifest.requiredRuntimeFiles.includes('candleCollectorWorker.mjs'));
  const files=fs.readdirSync(runtime,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>entry.name);
  assert.ok(files.includes('candleCollectorWorker.mjs'));
  assert.ok(!files.some(file=>/\.(ts|tsx)$/.test(file)));
  assert.ok(!fs.existsSync(path.join(runtime,'node_modules','tsx')));
  assert.ok(!fs.existsSync(path.join(runtime,'node_modules','esbuild')));
});

test('compiled runner loads without an override or network from an unrelated cwd',()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'collector-runner-'));
  try{
    const preload=path.join(temporary,'block-network.mjs');
    fs.writeFileSync(preload,"globalThis.fetch=async()=>{throw new Error('network forbidden')}\n");
    const result=execFileSync(process.execPath,[compiledRunner,'--mode=demo','--check'],{
      cwd:temporary,env:{...withoutCollectorOverride(),NODE_OPTIONS:`--import=${pathToFileURL(preload).href}`},encoding:'utf8',stdio:['ignore','pipe','pipe'],
    });
    assert.match(result,/Automation modules loaded successfully/);
  }finally{fs.rmSync(temporary,{recursive:true,force:true})}
});

test('controlled collector shutdown exits cleanly without a stack dump',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'collector-shutdown-'));
  const marker=path.join(temporary,'fetch.started');
  try{
    const preload=path.join(temporary,'mock-fetch.mjs');
    fs.writeFileSync(preload,`import fs from 'node:fs';\nlet signaled=false;\nglobalThis.fetch=async(_input,init={})=>{fs.writeFileSync(${JSON.stringify(marker)},'started');if(!signaled){signaled=true;setImmediate(()=>process.emit('SIGTERM'))}return await new Promise((_resolve,reject)=>{const abort=()=>reject(init.signal?.reason??new DOMException('Aborted','AbortError'));if(init.signal?.aborted)abort();else init.signal?.addEventListener('abort',abort,{once:true})})};\n`);
    const data=path.join(temporary,'data');fs.mkdirSync(data);
    const child=spawn(process.execPath,[compiledCollector,'EUR_USD','--mode=demo'],{cwd:temporary,env:{
      ...withoutCollectorOverride(),NODE_OPTIONS:`--import=${pathToFileURL(preload).href}`,TRADING_KEYS_DATA_DIRECTORY:data,
      OANDA_DEMO_ACCOUNT_ID:'fixture-account',OANDA_DEMO_ACCOUNT_TOKEN:'fixture-token',
    },stdio:['ignore','pipe','pipe']});
    const result=collectProcess(child);
    await waitForFile(marker);
    assert.deepEqual(await result,{code:0,stdout:'',stderr:''});
  }finally{fs.rmSync(temporary,{recursive:true,force:true})}
});

test('genuine collector startup failure remains visible and exits nonzero',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'collector-failure-'));
  try{
    const child=spawn(process.execPath,[compiledCollector],{cwd:temporary,env:{...withoutCollectorOverride(),TRADING_KEYS_DATA_DIRECTORY:path.join(temporary,'data')},stdio:['ignore','pipe','pipe']});
    const result=await collectProcess(child);
    assert.equal(result.code,1);
    assert.match(result.stderr,/No pair was provided to the candle collector/);
  }finally{fs.rmSync(temporary,{recursive:true,force:true})}
});
