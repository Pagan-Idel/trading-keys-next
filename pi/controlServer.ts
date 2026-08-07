import http from "http";
import { URL } from "url";
import { getAutomationDashboard,getAutomationZoneSnapshot } from "../utils/automationStore.ts";
import {
  getAutomationRuntime,
  recoverDesiredAutomation,
  shutdownAutomationChildren,
  startDemoAutomation,
  stopAutomation,
  validateAutomationRecoveryPreflight,
} from "../utils/automationProcessManager.ts";
import { getAppliedAutomationStrategy,recordAutomationEvent } from "../utils/automationStore.ts";
import { activateStagedApprovedStrategy } from "../utils/approvedStrategyActivation.ts";
import { readStagedApprovedStrategy } from "../utils/approvedStrategySync.ts";
import { createApprovedStrategyPoller,type ApprovedStrategyPollEvent } from "../utils/approvedStrategyPoller.ts";
import { handleOandaLogin } from "../utils/oanda/api/login.ts";

const host = process.env.PULSE_HOST ?? "127.0.0.1";
const port = Math.max(1024, Number(process.env.PULSE_PORT ?? 4080));
const token = String(process.env.PULSE_CONTROL_TOKEN ?? "");
if (host !== "127.0.0.1" && !token) {
  throw new Error("PULSE_CONTROL_TOKEN is required when Automation Pulse listens beyond localhost.");
}
const syncEnabled=process.env.APPROVED_STRATEGY_SYNC_ENABLED==="true";
const syncUrl=String(process.env.APPROVED_STRATEGY_SYNC_URL??"");
const syncToken=String(process.env.APPROVED_STRATEGY_SYNC_TOKEN??"");
const positiveNumber=(value:string|undefined,fallback:number,minimum:number)=>{
  const parsed=Number(value??fallback);
  return Number.isFinite(parsed)&&parsed>=minimum?parsed:fallback;
};
const syncIntervalMs=positiveNumber(process.env.APPROVED_STRATEGY_SYNC_INTERVAL_MS,300_000,30_000);
const syncTimeoutMs=positiveNumber(process.env.APPROVED_STRATEGY_SYNC_TIMEOUT_MS,15_000,1_000);
if(syncEnabled&&(!syncUrl||!syncToken))throw new Error(
  "APPROVED_STRATEGY_SYNC_URL and APPROVED_STRATEGY_SYNC_TOKEN are required when approved strategy sync is enabled.");
const syncMessages:Record<ApprovedStrategyPollEvent,string>={
  check_started:"Approved strategy check started.",
  no_update:"No approved strategy update is available.",
  update_detected:"A new approved strategy was detected.",
  downloaded:"The new approved strategy artifact was downloaded.",
  validated:"The downloaded approved strategy artifact passed validation.",
  staged:"The new approved strategy was staged atomically.",
  rejected:"Approved strategy synchronization failed; healthy automation continues with its startup snapshot.",
  activation_pending:"New approved version staged; activation is pending a safe stopped/start lifecycle boundary.",
};
const strategyPoller=syncEnabled?createApprovedStrategyPoller({
  endpoint:syncUrl,token:syncToken,intervalMs:syncIntervalMs,timeoutMs:syncTimeoutMs,
  getCurrent:()=>{const current=getAppliedAutomationStrategy();return {id:current.id,approvedAt:current.appliedAt}},
  onEvent:(event,data)=>recordAutomationEvent({source:"strategy-sync",step:`strategy_sync_${event}`,
    level:event==="rejected"?"warn":"info",message:syncMessages[event],data}),
}):null;

const authorized = (request: http.IncomingMessage) =>
  !token || request.headers.authorization === `Bearer ${token}`;
const send = (response: http.ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Automation Pulse Pi</title><style>
body{margin:0;background:#090d12;color:#eaf4ef;font:15px system-ui}main{max-width:900px;margin:32px auto;padding:20px}
.hero,.card{border:1px solid #294036;border-radius:18px;background:#111820;padding:20px;margin-bottom:14px}
h1{margin:0 0 8px}.muted{color:#8ea099}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.metric{background:#0b1116;border:1px solid #27332e;border-radius:12px;padding:14px}.metric b{display:block;font-size:24px;margin-top:6px}
button{padding:10px 14px;border-radius:10px;border:1px solid #347451;background:#123521;color:#86ffb1;font-weight:800;margin-right:8px}
button.stop{border-color:#78404a;background:#35171e;color:#ff9aa5}pre{white-space:pre-wrap;color:#a9bbb2;max-height:350px;overflow:auto}</style></head>
<body><main><section class="hero"><h1>Automation Pulse &middot; Raspberry Pi</h1>
<div class="muted">Demo-safe local control. Live mode cannot be started here.</div>
<p><button id="demoButton" onclick="toggleDemo()">Checking demo...</button><button disabled title="Live trading remains safety-locked">Live &middot; not ready</button></p></section>
<section class="card"><div class="grid"><div class="metric">Runtime<b id="runtime">&mdash;</b></div>
<div class="metric">Workers<b id="workers">&mdash;</b></div><div class="metric">Open trades<b id="openTrades">&mdash;</b></div>
<div class="metric">Net realized P/L<b id="netPL">&mdash;</b></div><div class="metric">Wins / losses<b id="record">&mdash;</b></div>
<div class="metric">Applied config<b id="config">&mdash;</b></div></div></section>
<section class="card"><b>Trade history</b><pre id="trades">Loading...</pre></section>
<section class="card"><b>Recent events</b><pre id="events">Loading...</pre></section></main><script>
let token=localStorage.pulseToken||prompt('Automation Pulse token (blank for localhost)')||'';localStorage.pulseToken=token;
const headers=()=>token?{Authorization:'Bearer '+token}:{};
let running=false;
async function load(){let r=await fetch('/api/status',{headers:headers()});if(!r.ok){document.getElementById('events').textContent='Unauthorized or unavailable';return}
let d=await r.json();running=d.runtime.running;document.getElementById('runtime').textContent=running?'DEMO RUNNING':'DEMO STOPPED';
let button=document.getElementById('demoButton');button.textContent=running?'Stop demo':'Start demo';button.className=running?'stop':'';
document.getElementById('workers').textContent=d.dashboard.workers.length;
document.getElementById('openTrades').textContent=d.dashboard.activeTrades.length;
document.getElementById('netPL').textContent=Number(d.dashboard.summary.realizedPL||0).toFixed(2);
document.getElementById('record').textContent=d.dashboard.summary.wins+' / '+d.dashboard.summary.losses;
document.getElementById('config').textContent=d.dashboard.appliedStrategy.sourceRunUid;
document.getElementById('trades').textContent=d.dashboard.trades.length?d.dashboard.trades.map(t=>t.closedAt+' '+t.pair+' '+t.outcome+' '+Number(t.realizedPL||0).toFixed(2)).join('\\n'):'No completed trades yet.';
document.getElementById('events').textContent=d.dashboard.events.map(e=>e.createdAt+' '+(e.pair||'')+' '+e.message).join('\\n')}
async function act(action){await fetch('/api/'+action,{method:'POST',headers:headers()});await load()}async function toggleDemo(){await act(running?'stop':'start')}load();setInterval(load,5000)</script></body></html>`;

const server=http.createServer(async(request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === "/" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(page);
    return;
  }
  const remote=request.socket.remoteAddress??'';
  const loopback=remote==='127.0.0.1'||remote==='::1'||remote==='::ffff:127.0.0.1';
  const localReadOnlyBridge=loopback&&request.method==='GET'&&['/api/zones','/api/status','/api/account'].includes(url.pathname);
  if (!localReadOnlyBridge&&!authorized(request)) {
    send(response, 401, { error: "Unauthorized" });
    return;
  }
  try {
    if (url.pathname === "/api/status" && request.method === "GET") {
      send(response, 200, { runtime: getAutomationRuntime(), dashboard: getAutomationDashboard(80),
        stagedStrategy:readStagedApprovedStrategy()?.sourceRunUid??null });
      return;
    }
    if(url.pathname==="/api/account"&&request.method==="GET"){
      const {account}=await handleOandaLogin(undefined,'demo');
      send(response,200,{account:{id:account.id,currency:account.currency,balance:account.balance,
        NAV:account.NAV,unrealizedPL:account.unrealizedPL,marginAvailable:account.marginAvailable}});
      return;
    }
    if(url.pathname==="/api/zones"&&request.method==="GET"){
      const pair=url.searchParams.get('pair')??'';
      const snapshot=getAutomationZoneSnapshot(pair);
      if(!snapshot){send(response,404,{error:`No automation zone snapshot is available for ${pair}.`});return}
      send(response,200,snapshot);return;
    }
    if(url.pathname==="/api/config-sync"&&request.method==="POST"){
      if(!strategyPoller){send(response,409,{error:"Approved strategy synchronization is disabled."});return}
      void strategyPoller.check().then(result=>send(response,200,result));
      return;
    }
    if (url.pathname === "/api/start" && request.method === "POST") {
      const currentRuntime=getAutomationRuntime();
      activateStagedApprovedStrategy();
      if(!currentRuntime.running)validateAutomationRecoveryPreflight();
      send(response, 200, await startDemoAutomation());
      return;
    }
    if (url.pathname === "/api/stop" && request.method === "POST") {
      send(response, 200, await stopAutomation());
      return;
    }
    send(response, 404, { error: "Not found" });
  } catch (error) {
    send(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});
server.listen(port, host, () => {
  console.log(`Automation Pulse listening on http://${host}:${port}`);
  void recoverDesiredAutomation().catch(error=>recordAutomationEvent({
      source:"process-manager",step:"boot_recovery_failed",level:"error",
      message:`Automation remained stopped after fail-closed boot recovery: ${error instanceof Error?error.message:String(error)}`,
    })).finally(()=>strategyPoller?.start());
});

const shutdown=async()=>{
  await strategyPoller?.close();
  await shutdownAutomationChildren();
  server.close(()=>process.exit(0));
};
process.once("SIGTERM",()=>void shutdown());
process.once("SIGINT",()=>void shutdown());
