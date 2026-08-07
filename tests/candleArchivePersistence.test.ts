import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('candle archive does not rewrite an identical merged candle history',async()=>{
  const original=process.cwd();
  const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'trading-keys-candles-'));
  process.chdir(isolated);
  try{
    const { getArchivedCandleBounds,readArchivedCandlePage,upsertArchivedCandles }=await import(`../utils/candleArchive.ts?isolated=${Date.now()}`);
    const key={pair:'EUR/USD',timeframe:'M5',mode:'demo' as const};
    const candles=[{time:'2026-07-28T12:00:00.000Z',candleIndex:0,open:1.1,high:1.2,low:1,close:1.15}];
    assert.equal(upsertArchivedCandles(key,candles),1);
    assert.equal(upsertArchivedCandles(key,candles),0);
    assert.equal(upsertArchivedCandles(key,[{...candles[0],close:1.16}]),1);
    assert.equal(upsertArchivedCandles(key,[
      {time:'2026-07-28T12:05:00.000Z',candleIndex:1,open:1.16,high:1.21,low:1.1,close:1.18},
      {time:'2026-07-28T12:10:00.000Z',candleIndex:2,open:1.18,high:1.22,low:1.12,close:1.2},
    ]),2);
    const boundary=Math.floor(Date.parse('2026-07-28T12:10:00.000Z')/1000);
    assert.deepEqual(readArchivedCandlePage(key,{before:boundary,limit:1}).map((item:{time:string})=>item.time),['2026-07-28T12:05:00.000Z']);
    assert.deepEqual(readArchivedCandlePage(key,{after:boundary-300,limit:1}).map((item:{time:string})=>item.time),['2026-07-28T12:10:00.000Z']);
    assert.deepEqual(getArchivedCandleBounds(key),{
      startTime:Math.floor(Date.parse('2026-07-28T12:00:00.000Z')/1000),
      endTime:boundary,
      candleCount:3,
    });
  }finally{
    process.chdir(original);
  }
});
