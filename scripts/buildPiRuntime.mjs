import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { build } from 'esbuild';
import { validatePiRuntimeContents } from './piRuntimeValidation.mjs';

const root=process.cwd(),output=path.join(root,'artifacts','pi-runtime');
fs.rmSync(output,{recursive:true,force:true});
fs.mkdirSync(output,{recursive:true});
const entries={
  controlServer:'pi/controlServer.ts',
  startRunner:'runner/startRunner.ts',
  goldilocksWorker:'workers/goldilocksWorker.ts',
  candleCollectorWorker:'workers/candleCollectorWorker.ts',
  importStrategy:'pi/importStrategy.ts',
  exportStrategy:'pi/exportStrategy.ts',
};
const result=await build({entryPoints:entries,outdir:output,bundle:true,platform:'node',format:'esm',
  target:'node20',packages:'external',sourcemap:true,metafile:true,logLevel:'info',outExtension:{'.js':'.mjs'}});
const packageNames=new Set();
const builtins=new Set([...builtinModules,...builtinModules.map(name=>`node:${name}`)]);
for(const outputInfo of Object.values(result.metafile.outputs)){
  for(const item of outputInfo.imports){
    if(!item.external||builtins.has(item.path)||item.path.startsWith('.')||path.isAbsolute(item.path))continue;
    packageNames.add(item.path.startsWith('@')?item.path.split('/').slice(0,2).join('/'):item.path.split('/')[0]);
  }
}
const sourcePackage=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
// puppeteer-extra loads its browser implementation dynamically, so esbuild cannot
// discover this active news-safety dependency from the static import graph.
if(packageNames.has('puppeteer-extra'))packageNames.add('puppeteer');
const dependencies=Object.fromEntries([...packageNames].sort().map(name=>{
  const version=sourcePackage.dependencies?.[name]??sourcePackage.devDependencies?.[name];
  if(!version)throw new Error(`Bundled Pi runtime imports undeclared package ${name}.`);
  return [name,version];
}));
fs.writeFileSync(path.join(output,'package.json'),JSON.stringify({
  name:'trading-keys-pi-runtime',private:true,type:'module',engines:{node:'>=20'},
  scripts:{start:'node controlServer.mjs'},dependencies,
},null,2));
fs.copyFileSync('pi/automation-pulse-control.service',path.join(output,'automation-pulse-control.service'));
fs.copyFileSync('pi/automation-pulse.env.example',path.join(output,'automation-pulse.env.example'));
const validation=validatePiRuntimeContents(output);
fs.writeFileSync(path.join(output,'BUILD-MANIFEST.json'),JSON.stringify({
  createdAt:new Date().toISOString(),entries,dependencies,
  requiredRuntimeFiles:validation.required,
  excluded:['Next.js UI','research workers','backtest workers','tests','TypeScript compiler','tsx'],
},null,2));
console.log(JSON.stringify({output,dependencies,files:fs.readdirSync(output)},null,2));
