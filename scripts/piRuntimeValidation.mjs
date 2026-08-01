import fs from 'node:fs';
import path from 'node:path';

export const REQUIRED_PI_RUNTIME_FILES = [
  'controlServer.mjs',
  'startRunner.mjs',
  'goldilocksWorker.mjs',
  'candleCollectorWorker.mjs',
  'importStrategy.mjs',
  'exportStrategy.mjs',
  'package.json',
  'automation-pulse-control.service',
  'automation-pulse.env.example',
];

const walkFiles = directory => fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const target=path.join(directory,entry.name);
  return entry.isDirectory()?walkFiles(target):[target];
});

export const validatePiRuntimeContents = directory => {
  const root=path.resolve(directory);
  const missing=REQUIRED_PI_RUNTIME_FILES.filter(file=>{
    try{return !fs.statSync(path.join(root,file)).isFile()}catch{return true}
  });
  if(missing.length)throw new Error(`Pi runtime is missing required files: ${missing.join(', ')}`);
  const prohibited=walkFiles(root).map(file=>path.relative(root,file).replaceAll('\\','/')).filter(file=>
    /(^|\/)(tests?|research|backtests?)(\/|$)/i.test(file)||/\.(ts|tsx)$/i.test(file)||
    /(^|\/)node_modules\/(tsx|esbuild)(\/|$)/i.test(file));
  if(prohibited.length)throw new Error(`Pi runtime contains prohibited files: ${prohibited.join(', ')}`);
  return {required:[...REQUIRED_PI_RUNTIME_FILES],files:walkFiles(root).length};
};
