import { createServer, type Server } from 'node:http';
import { forexPairs } from '../../constants.ts';
import { fetchPriceOnce, initializePriceStreams, stopAllStreams } from './priceStreamManager.ts';

type Mode = 'live' | 'demo';
const HOST = '127.0.0.1';
const PORT = Number(process.env.OANDA_MARKET_DATA_HUB_PORT ?? 47831);
export const MARKET_DATA_HUB_URL = `http://${HOST}:${PORT}`;
let server: Server | null = null;

export const startMarketDataHub = async (mode: Mode, symbols = forexPairs) => {
  if (server) return MARKET_DATA_HUB_URL;
  await initializePriceStreams(symbols, mode);
  server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    const url = new URL(request.url ?? '/', MARKET_DATA_HUB_URL);
    if (request.method === 'GET' && url.pathname === '/health') {
      response.end(JSON.stringify({ ok: true, instruments: symbols.length, mode }));
      return;
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
  return MARKET_DATA_HUB_URL;
};

export const stopMarketDataHub = async () => {
  const current = server;
  server = null;
  if (current) await new Promise<void>(resolve => current.close(() => resolve()));
  await stopAllStreams();
};
