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
    const { upsertArchivedCandles }=await import(`../utils/candleArchive.ts?isolated=${Date.now()}`);
    const key={pair:'EUR/USD',timeframe:'M5',mode:'demo' as const};
    const candles=[{time:'2026-07-28T12:00:00.000Z',candleIndex:0,open:1.1,high:1.2,low:1,close:1.15}];
    assert.equal(upsertArchivedCandles(key,candles),1);
    assert.equal(upsertArchivedCandles(key,candles),0);
    assert.equal(upsertArchivedCandles(key,[{...candles[0],close:1.16}]),1);
  }finally{
    process.chdir(original);
  }
});
