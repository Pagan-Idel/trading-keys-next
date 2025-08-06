// utils/throttleConnection.ts
let lastConnectTime = 0;

export async function throttleConnection(minIntervalMs: number = 1000) {
  const now = Date.now();
  const waitTime = Math.max(0, lastConnectTime + minIntervalMs - now);
  if (waitTime > 0) {
    await new Promise(res => setTimeout(res, waitTime));
  }
  lastConnectTime = Date.now();
}
