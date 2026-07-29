import http from "http";
import { URL } from "url";
import { getAutomationDashboard } from "../utils/automationStore.ts";
import {
  getAutomationRuntime,
  startDemoAutomation,
  stopAutomation,
} from "../utils/automationProcessManager.ts";
import { getAppliedAutomationStrategy,recordAutomationEvent } from "../utils/automationStore.ts";
import { activateStagedApprovedStrategy } from "../utils/approvedStrategyActivation.ts";
import { fetchAndStageApprovedStrategy,readStagedApprovedStrategy } from "../utils/approvedStrategySync.ts";

const host = process.env.PULSE_HOST ?? "127.0.0.1";
const port = Math.max(1024, Number(process.env.PULSE_PORT ?? 4080));
const token = String(process.env.PULSE_CONTROL_TOKEN ?? "");
if (host !== "127.0.0.1" && !token) {
  throw new Error("PULSE_CONTROL_TOKEN is required when Automation Pulse listens beyond localhost.");
}
const configEndpoint=String(process.env.AUTOMATION_CONFIG_ENDPOINT??"");
const configToken=String(process.env.AUTOMATION_CONFIG_READ_TOKEN??"");
const syncApprovedConfiguration=async()=>{
  if(!configEndpoint||!configToken)return {status:"disabled" as const};
  const current=getAppliedAutomationStrategy();
  try{
    const result=await fetchAndStageApprovedStrategy({endpoint:configEndpoint,token:configToken,
      currentId:current.id,currentApprovedAt:current.appliedAt});
    if(result.status==="staged")recordAutomationEvent({source:"strategy-sync",step:"strategy_sync_staged",
      message:`Approved strategy ${result.configurationId} downloaded, validated, and staged.`});
    return result;
  }catch(error){
    recordAutomationEvent({source:"strategy-sync",step:"strategy_sync_unavailable",level:"warn",
      message:`Approved strategy synchronization unavailable; continuing with ${current.sourceRunUid}.`,
      data:{error:error instanceof Error?error.message:String(error)}});
    return {status:"unavailable" as const};
  }
};

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
<p><button onclick="act('start')">Start demo</button><button class="stop" onclick="act('stop')">Stop</button></p></section>
<section class="card"><div class="grid"><div class="metric">Runtime<b id="runtime">&mdash;</b></div>
<div class="metric">Workers<b id="workers">&mdash;</b></div><div class="metric">Open trades<b id="openTrades">&mdash;</b></div>
<div class="metric">Applied config<b id="config">&mdash;</b></div></div></section>
<section class="card"><b>Recent events</b><pre id="events">Loading...</pre></section></main><script>
let token=localStorage.pulseToken||prompt('Automation Pulse token (blank for localhost)')||'';localStorage.pulseToken=token;
const headers=()=>token?{Authorization:'Bearer '+token}:{};
async function load(){let r=await fetch('/api/status',{headers:headers()});if(!r.ok){document.getElementById('events').textContent='Unauthorized or unavailable';return}
let d=await r.json();document.getElementById('runtime').textContent=d.runtime.running?'DEMO ON':'STOPPED';
document.getElementById('workers').textContent=d.dashboard.workers.length;
document.getElementById('openTrades').textContent=d.dashboard.activeTrades.length;
document.getElementById('config').textContent=d.dashboard.appliedStrategy.sourceRunUid;
document.getElementById('events').textContent=d.dashboard.events.map(e=>e.createdAt+' '+(e.pair||'')+' '+e.message).join('\\n')}
async function act(action){await fetch('/api/'+action,{method:'POST',headers:headers()});await load()}load();setInterval(load,5000)</script></body></html>`;

http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === "/" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(page);
    return;
  }
  if (!authorized(request)) {
    send(response, 401, { error: "Unauthorized" });
    return;
  }
  try {
    if (url.pathname === "/api/status" && request.method === "GET") {
      send(response, 200, { runtime: getAutomationRuntime(), dashboard: getAutomationDashboard(80),
        stagedStrategy:readStagedApprovedStrategy()?.sourceRunUid??null });
      return;
    }
    if(url.pathname==="/api/config-sync"&&request.method==="POST"){
      void syncApprovedConfiguration().then(result=>send(response,200,result));
      return;
    }
    if (url.pathname === "/api/start" && request.method === "POST") {
      activateStagedApprovedStrategy();
      send(response, 200, startDemoAutomation());
      return;
    }
    if (url.pathname === "/api/stop" && request.method === "POST") {
      send(response, 200, stopAutomation());
      return;
    }
    send(response, 404, { error: "Not found" });
  } catch (error) {
    send(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}).listen(port, host, () => console.log(`Automation Pulse listening on http://${host}:${port}`));

void syncApprovedConfiguration();
const strategySyncTimer=setInterval(()=>void syncApprovedConfiguration(),5*60*1000);
strategySyncTimer.unref();
