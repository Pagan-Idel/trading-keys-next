import fs from 'fs';
import path from 'path';
import { upsertArchivedCandles,readArchivedCandles } from '../../utils/candleArchive.ts';
import { getAppliedAutomationStrategy,updateWorkerStatus } from '../../utils/automationStore.ts';
import { findFreshGoldilocksConfirmations } from '../../utils/goldilocksScanner.ts';
import { scoreGoldilocksSetup } from '../../utils/goldilocksScoring.ts';
import { workerScanJitterMs } from '../../utils/workerRuntime.ts';

if(process.env.TRADING_KEYS_AUTOMATION_E2E!=='true')throw new Error('Fixture worker may run only in automation E2E mode.');
const realFetch=globalThis.fetch;
globalThis.fetch=(async()=>{throw new Error('Real HTTP is forbidden in deterministic automation E2E mode.')}) as typeof fetch;
const pair=process.argv[2]??'';
const data=path.resolve(process.env.TRADING_KEYS_DATA_DIRECTORY!);
const strategy=getAppliedAutomationStrategy();
const base=0;
const candles=[
  {time:new Date(base*1000).toISOString(),candleIndex:0,open:102,high:103,low:101,close:102.5},
  {time:new Date((base+300)*1000).toISOString(),candleIndex:1,open:101,high:101.5,low:99.8,close:100.5},
  {time:new Date((base+600)*1000).toISOString(),candleIndex:2,open:100.8,high:103.2,low:100.4,close:102.2},
];
const written=upsertArchivedCandles({pair,timeframe:'M5',mode:'demo'},candles);
const archived=readArchivedCandles({pair,timeframe:'M5',mode:'demo'},base,base+901);
const zone={id:`fixture-${pair}`,kind:'base' as const,side:'demand' as const,candleIndex:0,candleTime:base-300,
  availableAt:1,low:99,high:100,width:1,legMidpoint:105,legRange:12,departureMultiple:3,
  strength2x:true,touches:0,maxPenetration:0,state:'fresh' as const,reasons:[]};
const history={zones:[zone],activeZones:[zone],activeDemand:zone};
const strategyCandles=archived.map(candle=>({...candle,time:Date.parse(candle.time)/1000}));
const confirmations=findFreshGoldilocksConfirmations(history,strategyCandles,300,600_000,strategyCandles,100);
const score=scoreGoldilocksSetup({zone,tradeDirection:'BUY',trend:'bullish',
  minimumScore:Number(strategy.config.minimumScore??14),gates:[{name:'fixture safety',passed:true,reason:'deterministic'}]});
updateWorkerStatus(pair,'scanning','fixture_confirmation',`Fixture evaluated with ${strategy.sourceRunUid}.`,'demo');
if(confirmations.length!==1||!score.eligible)throw new Error(`Fixture trade was not eligible for ${pair}.`);
const result={pair,pid:process.pid,strategyId:strategy.id,sourceRunUid:strategy.sourceRunUid,
  jitterMs:workerScanJitterMs(pair),archiveRows:archived.length,written,confirmations:confirmations.length,
  eligible:score.eligible,order:{mode:'demo',transport:'fixture',id:`ORDER-${pair.replace('/','-')}`}};
fs.mkdirSync(path.join(data,'e2e-results'),{recursive:true});
fs.writeFileSync(path.join(data,'e2e-results',`${pair.replace('/','_')}.json`),JSON.stringify(result,null,2));
updateWorkerStatus(pair,'stopped','fixture_complete','Deterministic fixture worker completed.','demo');
globalThis.fetch=realFetch;
