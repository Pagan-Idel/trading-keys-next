import { createServer, type Server } from 'node:http';
import { fetchPriceOnce, initializePriceStreams, stopAllStreams } from './priceStreamManager.ts';

type Mode = 'live' | 'demo';
const HOST = '127.0.0.1';
const PORT = Number(process.env.OANDA_MARKET_DATA_HUB_PORT ?? 47831);
export const MARKET_DATA_HUB_URL = `http://${HOST}:${PORT}`;
let server: Server | null = null;
const leases=new Map<string,{instrument:string;expiresAt:number}>();
let subscribed:string[]=[];let reconcileTimer:NodeJS.Timeout|null=null;let idleTimer:NodeJS.Timeout|null=null;
const activeInstruments=()=>[...new Set([...leases.values()].filter(value=>value.expiresAt>Date.now()).map(value=>value.instrument))].sort();
const reconcile=async(mode:Mode)=>{
  const next=activeInstruments();if(next.join(',')===subscribed.join(','))return;
  await stopAllStreams();subscribed=next;if(next.length)await initializePriceStreams(next,mode);
};
export const updateHubInterest=(instrument:string,owner:string,active:boolean,now=Date.now())=>{
  const key=`${owner}:${instrument}`;if(active)leases.set(key,{instrument,expiresAt:now+30_000});else leases.delete(key);return activeInstruments();
};
export const getHubInterestSnapshot=()=>({leases:leases.size,instruments:activeInstruments(),subscribed:[...subscribed]});

export const startMarketDataHub = async (mode: Mode) => {
  if (server) return MARKET_DATA_HUB_URL;
  server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    const url = new URL(request.url ?? '/', MARKET_DATA_HUB_URL);
    if (request.method === 'GET' && url.pathname === '/health') {
      response.end(JSON.stringify({ ok: true, instruments: subscribed.length, leases:leases.size, mode }));
      return;
    }
    if((request.method==='POST'||request.method==='DELETE')&&url.pathname==='/interest'){
      const instrument=url.searchParams.get('instrument'),owner=url.searchParams.get('owner');
      if(!instrument||!owner){response.statusCode=400;response.end(JSON.stringify({error:'instrument and owner are required'}));return}
      updateHubInterest(instrument,owner,request.method==='POST');
      if(request.method==='POST'){if(idleTimer)clearTimeout(idleTimer);idleTimer=null;await reconcile(mode)}
      else {if(idleTimer)clearTimeout(idleTimer);idleTimer=setTimeout(()=>void reconcile(mode),Number(process.env.OANDA_STREAM_IDLE_COOLDOWN_MS)||5_000)}
      response.end(JSON.stringify(getHubInterestSnapshot()));return;
    }
    if (request.method !== 'GET' || url.pathname !== '/quote') {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    const instrument = url.searchParams.get('instrument');
    if (!instrument) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: 'instrument is required' }));
      return;
    }
    const quote = await fetchPriceOnce(instrument, mode);
    response.statusCode = quote ? 200 : 503;
    response.end(JSON.stringify(quote ?? { error: 'Fresh OANDA quote unavailable' }));
  });
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(PORT, HOST, resolve);
  });
  reconcileTimer=setInterval(()=>{const before=leases.size;for(const [key,value] of leases)if(value.expiresAt<=Date.now())leases.delete(key);
    if(before!==leases.size)void reconcile(mode)},10_000);
  return MARKET_DATA_HUB_URL;
};

export const stopMarketDataHub = async () => {
  const current = server;
  server = null;
  if(reconcileTimer)clearInterval(reconcileTimer);reconcileTimer=null;if(idleTimer)clearTimeout(idleTimer);idleTimer=null;leases.clear();subscribed=[];
  if (current) await new Promise<void>(resolve => current.close(() => resolve()));
  await stopAllStreams();
};
