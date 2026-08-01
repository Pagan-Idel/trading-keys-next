import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ResolveCollectorEntryOptions = {
  runnerModuleUrl: string;
  override?: string;
  exists?: (filePath: string) => boolean;
};

export const resolveCandleCollectorEntry = ({
  runnerModuleUrl,
  override = process.env.TRADING_KEYS_COLLECTOR_ENTRY,
  exists = fs.existsSync,
}: ResolveCollectorEntryOptions): string => {
  const runnerFile = fileURLToPath(runnerModuleUrl);
  const runnerDirectory = path.dirname(runnerFile);
  const configured = override?.trim();
  const resolved = configured
    ? path.resolve(runnerDirectory, configured)
    : path.extname(runnerFile).toLowerCase() === '.mjs'
      ? path.join(runnerDirectory, 'candleCollectorWorker.mjs')
      : path.resolve(runnerDirectory, '..', 'workers', 'candleCollectorWorker.ts');
  if (!exists(resolved)) {
    throw new Error(`Candle collector entry does not exist: ${resolved}`);
  }
  return resolved;
};

export const isExpectedCollectorShutdown = (
  error: unknown,
  stopped: boolean,
  signal: AbortSignal,
): boolean => stopped && signal.aborted && isExpectedAbort(error);

export const isExpectedAbort = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError' ||
  Boolean((error as {diagnostic?:{abort?:boolean}}|null)?.diagnostic?.abort);
