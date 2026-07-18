import { calculateScoreRisk, type RiskProfile } from './dynamicRisk.ts';

export interface PortfolioTrade {
  id:string|number;pair:string;confirmationTime:number;outcomeTime:number;score:number;
  entry:number;stopLoss:number;outcome:'WIN'|'LOSS';realizedR:number|null;
}

export interface PortfolioConfig {startingBalance:number;leverage:number;riskProfile:RiskProfile;minimumScore:number;}

const OANDA_US_MAJOR_PAIRS=new Set(['EUR/USD','GBP/USD','AUD/USD','NZD/USD','USD/CAD','USD/CHF','USD/JPY']);
export const effectiveOandaLeverage=(pair:string,selectedMaximum:number)=>Math.min(Math.max(1,selectedMaximum),OANDA_US_MAJOR_PAIRS.has(pair)?50:20);

export const simulateBacktestPortfolio=(source:PortfolioTrade[],config:PortfolioConfig)=>{
  const initial=Math.max(1,Number(config.startingBalance)||1);
  let equity=initial,peak=initial,maxDrawdown=0,usedMargin=0,peakMargin=0,totalRisked=0,marginBlocked=0;
  const positions=new Map<string,{riskAmount:number;margin:number;trade:PortfolioTrade}>();
  const byPair=new Map<string,{pair:string;trades:number;wins:number;losses:number;net:number;totalR:number}>();
  const events=source.flatMap(trade=>[
    {time:Number(trade.confirmationTime),kind:'entry' as const,trade},
    {time:Number(trade.outcomeTime),kind:'exit' as const,trade},
  ]).sort((left,right)=>left.time-right.time||(left.kind==='exit'?-1:1));
  for(const event of events){
    const key=String(event.trade.id);
    if(event.kind==='entry'){
      const risk=calculateScoreRisk(Number(event.trade.score),config.minimumScore,config.riskProfile);
      const desiredRisk=equity*(risk.riskPercentage/100);
      const entry=Math.abs(Number(event.trade.entry));
      const stopFraction=entry>0?Math.abs(Number(event.trade.entry)-Number(event.trade.stopLoss))/entry:0;
      const effectiveLeverage=effectiveOandaLeverage(event.trade.pair,config.leverage);
      const requiredMargin=stopFraction>0?desiredRisk/stopFraction/effectiveLeverage:Number.POSITIVE_INFINITY;
      const availableMargin=Math.max(0,equity-usedMargin);
      if(!Number.isFinite(requiredMargin)||requiredMargin>availableMargin+1e-9){marginBlocked+=1;continue}
      positions.set(key,{riskAmount:desiredRisk,margin:requiredMargin,trade:event.trade});
      usedMargin+=requiredMargin;peakMargin=Math.max(peakMargin,usedMargin);totalRisked+=desiredRisk;
      continue;
    }
    const position=positions.get(key);if(!position)continue;
    positions.delete(key);usedMargin=Math.max(0,usedMargin-position.margin);
    const realizedR=position.trade.realizedR==null?(position.trade.outcome==='WIN'?0:-1):Number(position.trade.realizedR);
    const pnl=position.riskAmount*realizedR;equity=Math.max(0,equity+pnl);peak=Math.max(peak,equity);
    if(peak>0)maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak*100);
    const row=byPair.get(position.trade.pair)??{pair:position.trade.pair,trades:0,wins:0,losses:0,net:0,totalR:0};
    row.trades+=1;row.wins+=realizedR>0?1:0;row.losses+=realizedR<0?1:0;row.net+=pnl;row.totalR+=realizedR;byPair.set(position.trade.pair,row);
  }
  return {initial,ending:equity,net:equity-initial,returnPercent:(equity-initial)/initial*100,maxDrawdown,totalRisked,marginBlocked,peakMargin,acceptedTrades:[...byPair.values()].reduce((sum,row)=>sum+row.trades,0),byPair:[...byPair.values()].sort((a,b)=>b.net-a.net)};
};
