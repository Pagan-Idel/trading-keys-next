import Head from 'next/head';
import Link from 'next/link';
import {useRouter} from 'next/router';
import {useEffect,useState} from 'react';
import styled from 'styled-components';

const Page=styled.div`width:min(1380px,calc(100% - 30px));margin:0 auto 80px;color:#edf5ff;font-family:Inter,system-ui,sans-serif;`;
const Hero=styled.section`padding:28px;border:1px solid #34515b;border-radius:22px;background:radial-gradient(circle at 90% 0,#174b55,transparent 35%),linear-gradient(145deg,#111922,#090d12);`;
const Kicker=styled.div`color:#75efff;font-size:.68rem;font-weight:900;letter-spacing:.15em;text-transform:uppercase;`;
const Title=styled.h1`margin:8px 0;font-size:clamp(2rem,5vw,4rem);line-height:1;background:linear-gradient(90deg,#fff,#8df4ff);-webkit-background-clip:text;color:transparent;`;
const Muted=styled.p`color:#8999aa;line-height:1.55;font-size:.78rem;overflow-wrap:anywhere;`;
const Grid=styled.div`display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px;@media(max-width:900px){grid-template-columns:repeat(2,1fr)}@media(max-width:520px){grid-template-columns:1fr}`;
const Card=styled.div`padding:16px;border:1px solid #2b3743;border-radius:16px;background:#10161d;`;
const Label=styled.div`font-size:.62rem;color:#798899;text-transform:uppercase;letter-spacing:.11em;font-weight:850;`;
const Metric=styled.div`margin-top:7px;font-size:1.35rem;font-weight:950;overflow-wrap:anywhere;`;
const Section=styled.section`margin-top:16px;padding:20px;border:1px solid #293541;border-radius:20px;background:#0e141b;h2{margin:0 0 5px;font-size:1.08rem;}h3{margin:18px 0 8px;font-size:.88rem;color:#cde9ef;}`;
const Table=styled.div`overflow:auto;border:1px solid #29343f;border-radius:13px;margin-top:12px;table{width:100%;border-collapse:collapse;min-width:760px}th,td{padding:10px 11px;border-bottom:1px solid #252f39;text-align:left;vertical-align:top;font-size:.7rem;line-height:1.45}th{color:#7f8fa1;text-transform:uppercase;letter-spacing:.08em;font-size:.6rem;background:#111820}tr:last-child td{border-bottom:0}.good{color:#67efb2}.bad{color:#ff8d9b}.warn{color:#ffdc8b}`;
const RuleGrid=styled.div`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px;@media(max-width:700px){grid-template-columns:1fr}`;
const Rule=styled.div`padding:13px;border:1px solid #283540;border-radius:13px;background:#0a1016;strong{display:block;color:#d9eef2;font-size:.75rem;margin-bottom:5px}span{color:#8797a8;font-size:.69rem;line-height:1.5}code{display:block;margin-top:7px;color:#78dbeb;font-size:.64rem;white-space:pre-wrap;overflow-wrap:anywhere}`;
const Audit=styled.details`border:1px solid #2a3641;border-radius:13px;background:#0a1016;margin-top:8px;summary{cursor:pointer;padding:12px;color:#dcebf2;font-size:.74rem;font-weight:800}.body{padding:0 12px 12px}`;
const Json=styled.pre`padding:12px;border-radius:11px;background:#060a0f;color:#8fdceb;font-size:.64rem;white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto;`;
const ErrorBox=styled.div`padding:18px;border:1px solid #713643;background:#2b1118;color:#ffadba;border-radius:14px;`;

const fmtR=(value:any)=>value==null?'—':`${Number(value)>0?'+':''}${Number(value).toFixed(3)}R`;
const factor=(value:any)=>value==null?'—':Number.isFinite(Number(value))?Number(value).toFixed(2):'∞';
const sampleLabel=(count:number)=>count>=100?'ELIGIBLE':count>=50?'PROVISIONAL':'INSUFFICIENT';
const pairs=(value:any)=>Array.isArray(value)?value.join(', '):'—';

export default function ResearchTrialDetail(){
  const router=useRouter();const trialId=typeof router.query.trialId==='string'?router.query.trialId:'';
  const [data,setData]=useState<any>(null);const [error,setError]=useState('');
  useEffect(()=>{if(!trialId)return;void(async()=>{try{const response=await fetch(`/api/backtests/research?trialId=${encodeURIComponent(trialId)}`,{cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.error);setData(body)}catch(e){setError(e instanceof Error?e.message:String(e))}})()},[trialId]);
  if(error)return <Page><ErrorBox>{error}</ErrorBox></Page>;
  if(!data)return <Page><Muted>Loading complete configuration snapshot…</Muted></Page>;
  const trial=data.trial;const config=trial.config??{};const manifest=config.researchManifest??{};const metrics=trial.metrics??{};const official=metrics.official??{};
  const count=Number(official.sampleTrades??0);const quality=sampleLabel(count);const score=manifest.score??{};
  return <Page>
    <Head><title>{config.label??'Research trial'} · Trading Keys</title></Head>
    <Hero><Kicker>Frozen Goldilocks trial audit</Kicker><Title>{config.label??'Research configuration'}</Title>
      <Muted>Research engine <strong>{manifest.versions?.researchEngine??'legacy'}</strong> · strategy <strong>{config.strategyVersion??manifest.versions?.strategy??'unknown'}</strong> · dataset <strong>{trial.datasetKey}</strong>. This page is the stored snapshot for this trial, not today&apos;s mutable defaults.</Muted>
      <div style={{display:'flex',gap:14,flexWrap:'wrap'}}><Link href="/research" style={{color:'#8beeff'}}>← Research status</Link>{trial.backtestRunId&&<Link href={`/backtesting?runId=${encodeURIComponent(trial.backtestRunId)}`} style={{color:'#dcb4ff'}}>Open recorded backtest</Link>}</div>
    </Hero>
    <Grid>
      <Card><Label>Sample quality</Label><Metric style={{color:quality==='ELIGIBLE'?'#67efb2':quality==='PROVISIONAL'?'#ffdc8b':'#ff9daa'}}>{quality}</Metric><Muted>{count} realized-R trades</Muted></Card>
      <Card><Label>Official expectancy</Label><Metric>{fmtR(official.expectancyR)}</Metric><Muted>PF {factor(official.profitFactor)} · net {fmtR(official.netR)}</Muted></Card>
      <Card><Label>Maximum drawdown</Label><Metric>{fmtR(official.maxDrawdownR)}</Metric><Muted>Longest losing streak {official.longestLosingStreak??'—'}</Muted></Card>
      <Card><Label>Sealed data</Label><Metric style={{fontSize:'1rem'}}>{config.archiveOnly?'SQLITE ONLY':'LEGACY / NETWORK'}</Metric><Muted>Cutoff {config.datasetEndTime?new Date(config.datasetEndTime*1000).toLocaleString():'—'}</Muted></Card>
    </Grid>
    <Section><h2>Trial inputs</h2><Muted>Every top-level input passed to the deterministic runner.</Muted>
      <Table><table><tbody>
        <tr><th>Pairs</th><td>{pairs(config.pairs)}</td><th>Lookback</th><td>{config.lookbackDays} days</td></tr>
        <tr><th>Profile</th><td>{config.timeframeProfile}</td><th>Minimum score</th><td>{config.minimumScore}/20</td></tr>
        <tr><th>Risk profile</th><td>{config.riskProfile}</td><th>Balance / leverage</th><td>${config.startingBalance} / {config.leverage}:1</td></tr>
        <tr><th>Dataset key</th><td colSpan={3}>{config.datasetKey??trial.datasetKey}</td></tr>
      </tbody></table></Table>
    </Section>
    <Section><h2>Timeframe contract</h2><Muted>One role per timeframe; the execution timeframe resolves post-entry ordering only.</Muted><RuleGrid>{Object.entries(manifest.timeframeContract??{}).map(([name,value])=><Rule key={name}><strong>{name}</strong><span>{Array.isArray(value)?value.join(' / '):String(value)}</span></Rule>)}</RuleGrid></Section>
    <Section><h2>Hard gates</h2><Muted>All must pass before any points are calculated.</Muted><RuleGrid>{(manifest.hardGates??[]).map((gate:any)=><Rule key={gate.id}><strong>{gate.name}</strong><span>{gate.rule}</span>{gate.value!==undefined&&<code>{JSON.stringify(gate.value,null,2)}</code>}</Rule>)}</RuleGrid></Section>
    <Section><h2>20-point score</h2><Muted>Threshold {score.minimum}/20. Weights are stored with the trial.</Muted>
      <Table><table><thead><tr><th>Component</th><th>Maximum</th><th>Rule / subscores</th></tr></thead><tbody>{(score.components??[]).map((component:any)=><tr key={component.name}><td>{component.name}</td><td>{component.maximum}</td><td>{component.rule}{component.subscores&&<Json>{JSON.stringify(component.subscores,null,2)}</Json>}</td></tr>)}</tbody></table></Table>
      <h3>Raw score weights</h3><RuleGrid>{Object.entries(score.weights??{}).map(([name,value])=><Rule key={name}><strong>{name}</strong><span>{String(value)} point(s)</span></Rule>)}</RuleGrid>
    </Section>
    <Section><h2>Zone, confirmation, and execution rules</h2><h3>Zone construction and lifecycle</h3><RuleGrid>{(manifest.zoneRules??[]).map((rule:any)=><Rule key={rule.name}><strong>{rule.name}</strong><span>{rule.rule}</span>{rule.value&&<code>{JSON.stringify(rule.value,null,2)}</code>}</Rule>)}</RuleGrid><h3>Trigger and manager contract</h3><RuleGrid>{(manifest.confirmationAndExecution??[]).map((rule:any)=><Rule key={rule.name}><strong>{rule.name}</strong><span>{rule.rule}</span>{rule.value&&<code>{JSON.stringify(rule.value,null,2)}</code>}</Rule>)}</RuleGrid></Section>
    <Section><h2>Research diagnostics</h2><Muted>Logged for analysis but not silently promoted into eligibility or score.</Muted><RuleGrid>{(manifest.researchDiagnostics??[]).map((item:any)=><Rule key={item.name}><strong>{item.name} · {item.scored?'SCORED':'DIAGNOSTIC'}</strong><span>{item.rule}</span>{item.thresholds&&<code>{JSON.stringify(item.thresholds,null,2)}</code>}</Rule>)}</RuleGrid></Section>
    <Section><h2>Management-policy matrix</h2><Table><table><thead><tr><th>Policy</th><th>Break-even</th><th>Primary target / exit</th><th>Runner target / stop</th><th>Trades</th><th>Expectancy</th><th>PF</th></tr></thead><tbody>{(manifest.managementPolicies??[]).map((policy:any)=>{const result=(metrics.policies??[]).find((item:any)=>item.policyId===policy.id);return <tr key={policy.id}><td>{policy.label}<br/><small>{policy.id}</small></td><td>{policy.breakEvenAtR??'none'}R</td><td>{policy.primaryTargetR}R / {Math.round(policy.primaryExitFraction*100)}%</td><td>{policy.runnerTargetR??'—'}R / {policy.runnerStopR??'—'}R</td><td>{result?.sampleTrades??'—'}</td><td>{fmtR(result?.expectancyR)}</td><td>{factor(result?.profitFactor)}</td></tr>})}</tbody></table></Table></Section>
    <Section><h2>Per-pair evidence</h2><Table><table><thead><tr><th>Pair</th><th>Trades</th><th>Quality</th><th>Expectancy</th><th>Profit factor</th><th>Net R</th><th>Max DD</th></tr></thead><tbody>{(metrics.byPair??[]).map((pair:any)=><tr key={pair.pair}><td>{pair.pair}</td><td>{pair.sampleTrades}</td><td className={pair.sampleTrades>=50?'good':'warn'}>{sampleLabel(pair.sampleTrades)}</td><td>{fmtR(pair.expectancyR)}</td><td>{factor(pair.profitFactor)}</td><td>{fmtR(pair.netR)}</td><td>{fmtR(pair.maxDrawdownR)}</td></tr>)}</tbody></table></Table></Section>
    <Section><h2>Every recorded trade score and gate audit</h2><Muted>Each setup shows the actual points, gates, approach/confirmation-bias diagnostic, zone corridor, and market path stored at entry time.</Muted>
      {(data.tradeAudits??[]).length?(data.tradeAudits??[]).map((trade:any)=><Audit key={trade.tradeId}><summary>{trade.tradeId} · {trade.pair} {trade.direction} · score {trade.score}/20 · {trade.outcome} {fmtR(trade.realizedR)}</summary><div className="body">
        <Table><table><thead><tr><th>Score component</th><th>Points</th><th>Detail</th></tr></thead><tbody>{(trade.scoreDetail?.components??[]).map((component:any)=><tr key={component.name}><td>{component.name}</td><td>{component.points}</td><td>{component.detail}</td></tr>)}</tbody></table></Table>
        <h3>Gates</h3><Table><table><thead><tr><th>Gate</th><th>Passed</th><th>Reason</th></tr></thead><tbody>{(trade.scoreDetail?.gates??[]).map((gate:any)=><tr key={gate.name}><td>{gate.name}</td><td className={gate.passed?'good':'bad'}>{gate.passed?'PASS':'FAIL'}</td><td>{gate.reason}</td></tr>)}</tbody></table></Table>
        <h3>Approach / confirmation bias diagnostic</h3><Json>{JSON.stringify(trade.approachPressure??null,null,2)}</Json><h3>Zone corridor</h3><Json>{JSON.stringify(trade.zoneCorridors??null,null,2)}</Json><h3>Post-entry market path</h3><Json>{JSON.stringify(trade.marketPath??null,null,2)}</Json>
      </div></Audit>):<Muted>No completed trades are stored for this trial.</Muted>}
    </Section>
    <Section><h2>Raw frozen configuration</h2><Json>{JSON.stringify(config,null,2)}</Json><h3>Known simulator omissions</h3><Muted>{(manifest.knownSimulatorOmissions??[]).join(' · ')}</Muted></Section>
  </Page>;
}
