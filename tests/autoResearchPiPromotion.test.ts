import assert from 'node:assert/strict';
import test from 'node:test';
import {restartPiWithApprovedStrategy} from '../utils/autoResearchPiPromotion.ts';

const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

test('automatic research promotion syncs, restarts, and verifies the Pi strategy',async()=>{
  const calls:string[]=[];
  const replies=[
    response({runtime:{running:true},dashboard:{activeTrades:[],appliedStrategy:{sourceRunUid:'GLR-OLD'}}}),
    response({status:'staged'}),response({running:false}),response({running:true}),
    response({runtime:{running:true},dashboard:{activeTrades:[],appliedStrategy:{sourceRunUid:'GLR-NEW'}}}),
  ];
  const fetcher=(async(url:URL|string,init?:RequestInit)=>{calls.push(`${init?.method} ${String(url)}`);return replies.shift()!}) as typeof fetch;
  const result=await restartPiWithApprovedStrategy({expectedRunUid:'GLR-NEW',baseUrl:'http://pi:4080',token:'test-token',fetcher});
  assert.deepEqual(result,{status:'activated',activeRunUid:'GLR-NEW'});
  assert.deepEqual(calls,[
    'GET http://pi:4080/api/status','POST http://pi:4080/api/config-sync','POST http://pi:4080/api/stop',
    'POST http://pi:4080/api/start','GET http://pi:4080/api/status',
  ]);
});

test('automatic research promotion never restarts workers while a trade is open',async()=>{
  const calls:string[]=[];
  const fetcher=(async(url:URL|string,init?:RequestInit)=>{calls.push(`${init?.method} ${String(url)}`);return response({runtime:{running:true},dashboard:{activeTrades:[{tradeId:'OPEN'}]}})}) as typeof fetch;
  assert.deepEqual(await restartPiWithApprovedStrategy({expectedRunUid:'GLR-NEW',baseUrl:'http://pi:4080',token:'test-token',fetcher}),{status:'deferred-open-trade'});
  assert.deepEqual(calls,['GET http://pi:4080/api/status']);
});

test('automatic research promotion does nothing when the Pi already runs the leader',async()=>{
  const calls:string[]=[];
  const fetcher=(async(url:URL|string,init?:RequestInit)=>{calls.push(`${init?.method} ${String(url)}`);return response({runtime:{running:true},dashboard:{activeTrades:[],appliedStrategy:{sourceRunUid:'GLR-NEW'}}})}) as typeof fetch;
  assert.deepEqual(await restartPiWithApprovedStrategy({expectedRunUid:'GLR-NEW',baseUrl:'http://pi:4080',token:'test-token',fetcher}),{status:'already-active',activeRunUid:'GLR-NEW'});
  assert.deepEqual(calls,['GET http://pi:4080/api/status']);
});
