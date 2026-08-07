import assert from 'node:assert/strict';
import test from 'node:test';
import { appendBoundedStreamQuote, consumePricingChunk } from '../utils/oanda/api/priceStreamManager.ts';

test('OANDA stream parser preserves JSON split across network chunks', () => {
  const state = { decoder: new TextDecoder(), carry: '' };
  const messages: any[] = [];
  const encode = (text: string) => new TextEncoder().encode(text);

  consumePricingChunk(state, encode('{"type":"PRICE","instrument":"EUR_USD","bi'), message => messages.push(message));
  assert.equal(messages.length, 0);
  consumePricingChunk(state, encode('ds":[{"price":"1.1"}],"asks":[{"price":"1.2"}]}\n{"type":"HEART'), message => messages.push(message));
  assert.equal(messages.length, 1);
  consumePricingChunk(state, encode('BEAT","time":"2026-07-17T00:00:00Z"}\n'), message => messages.push(message));

  assert.equal(messages.length, 2);
  assert.equal(messages[0].instrument, 'EUR_USD');
  assert.equal(messages[1].type, 'HEARTBEAT');
  assert.equal(state.carry, '');
});

test('OANDA stream parser handles multiple JSON lines in one chunk', () => {
  const state = { decoder: new TextDecoder(), carry: '' };
  const messages: any[] = [];
  consumePricingChunk(
    state,
    new TextEncoder().encode('{"type":"HEARTBEAT","time":"a"}\n{"type":"HEARTBEAT","time":"b"}\n'),
    message => messages.push(message),
  );
  assert.deepEqual(messages.map(message => message.time), ['a', 'b']);
});

test('stream quote history retains every sampled quote across a busy scan boundary',()=>{
  const history=[] as Parameters<typeof appendBoundedStreamQuote>[0];
  for(let index=1;index<=4;index+=1)appendBoundedStreamQuote(history,{
    bid:String(index),ask:String(index+0.1),oandaTime:`2026-08-06T01:00:0${index}Z`,
    receivedAt:index,tradeable:true,source:'stream',
  },3);
  assert.deepEqual(history.map(quote=>quote.receivedAt),[2,3,4]);
  assert.equal(history.some(quote=>Number(quote.ask)===3.1),true);
});
