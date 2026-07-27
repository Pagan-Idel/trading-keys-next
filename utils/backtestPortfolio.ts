import { calculateScoreRisk, type RiskProfile } from './dynamicRisk.ts';
import {
  assessPortfolioMarginAdmission,
  estimateMarginFromStopRisk,
} from "./portfolioMargin.ts";

export interface PortfolioTrade {
  id:string|number;pair:string;confirmationTime:number;outcomeTime:number;score:number;
  entry:number;stopLoss:number;outcome:'WIN'|'LOSS';realizedR:number|null;
  direction?:'BUY'|'SELL';tradeId?:string;
}

export interface PortfolioConfig {startingBalance:number;leverage:number;riskProfile:RiskProfile;minimumScore:number;}

const OANDA_US_MAJOR_PAIRS=new Set(['EUR/USD','GBP/USD','AUD/USD','NZD/USD','USD/CAD','USD/CHF','USD/JPY']);
export const effectiveOandaLeverage=(pair:string,selectedMaximum:number)=>Math.min(Math.max(1,selectedMaximum),OANDA_US_MAJOR_PAIRS.has(pair)?50:20);

export const simulateBacktestPortfolio=(source:PortfolioTrade[],config:PortfolioConfig)=>{
  const initial=Math.max(1,Number(config.startingBalance)||1);
  let equity=initial,peak=initial,maxDrawdown=0,usedMargin=0,openRisk=0,peakMargin=0,totalRisked=0,marginBlocked=0;
  const positions=new Map<string,{riskAmount:number;margin:number;trade:PortfolioTrade}>();
  const byPair=new Map<string,{pair:string;trades:number;wins:number;losses:number;net:number;totalR:number}>();
  const trades:Array<{trade:PortfolioTrade;riskAmount:number;realizedR:number;pnl:number}>=[];
  const blockedTrades:Array<{
    trade:PortfolioTrade;
    riskAmount:number;
    requiredMargin:number;
    effectiveLeverage:number;
    stopFraction:number;
    reason:string;
    projectedAvailableMargin:number;
    projectedAvailableMarginNavFraction:number;
    projectedCloseoutPercent:number;
    projectedPortfolioRiskFraction:number;
  }>=[];
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
      const effectiveLeverage=effectiveOandaLeverage(event.trade.pair,config.leverage);
      const marginEstimate=estimateMarginFromStopRisk({
        pair:event.trade.pair,
        entry:Number(event.trade.entry),
        stopLoss:Number(event.trade.stopLoss),
        riskAmount:desiredRisk,
        accountMarginRate:1/effectiveLeverage,
      });
      const requiredMargin=marginEstimate.requiredMargin;
      const availableMargin=Math.max(0,equity-usedMargin);
      const admission=assessPortfolioMarginAdmission({
        nav:equity,
        marginAvailable:availableMargin,
        marginUsed:usedMargin,
        marginCloseoutNav:equity,
        marginCloseoutPercent:equity>0?(usedMargin*0.5)/equity:Number.POSITIVE_INFINITY,
        reservedMargin:0,
        openRiskAmount:openRisk,
        reservedRiskAmount:0,
        proposedMargin:requiredMargin,
        proposedRiskAmount:desiredRisk,
      });
      if(!admission.allowed){
        marginBlocked+=1;
        blockedTrades.push({
          trade:event.trade,
          riskAmount:desiredRisk,
          requiredMargin,
          effectiveLeverage,
          stopFraction:marginEstimate.stopFraction,
          reason:admission.reason,
          projectedAvailableMargin:admission.projectedAvailableMargin,
          projectedAvailableMarginNavFraction:admission.projectedAvailableMarginNavFraction,
          projectedCloseoutPercent:admission.projectedCloseoutPercent,
          projectedPortfolioRiskFraction:admission.projectedPortfolioRiskFraction,
        });
        continue
      }
      positions.set(key,{riskAmount:desiredRisk,margin:requiredMargin,trade:event.trade});
      usedMargin+=requiredMargin;openRisk+=desiredRisk;peakMargin=Math.max(peakMargin,usedMargin);totalRisked+=desiredRisk;
      continue;
    }
    const position=positions.get(key);if(!position)continue;
    positions.delete(key);usedMargin=Math.max(0,usedMargin-position.margin);openRisk=Math.max(0,openRisk-position.riskAmount);
    const realizedR=position.trade.realizedR==null?(position.trade.outcome==='WIN'?0:-1):Number(position.trade.realizedR);
    const pnl=position.riskAmount*realizedR;equity=Math.max(0,equity+pnl);peak=Math.max(peak,equity);
    trades.push({trade:position.trade,riskAmount:position.riskAmount,realizedR,pnl});
    if(peak>0)maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak*100);
    const row=byPair.get(position.trade.pair)??{pair:position.trade.pair,trades:0,wins:0,losses:0,net:0,totalR:0};
    row.trades+=1;row.wins+=realizedR>0?1:0;row.losses+=realizedR<0?1:0;row.net+=pnl;row.totalR+=realizedR;byPair.set(position.trade.pair,row);
  }
  trades.sort((left,right)=>left.trade.confirmationTime-right.trade.confirmationTime);
  return {initial,ending:equity,net:equity-initial,returnPercent:(equity-initial)/initial*100,maxDrawdown,totalRisked,marginBlocked,peakMargin,acceptedTrades:trades.length,trades,blockedTrades,byPair:[...byPair.values()].sort((a,b)=>b.net-a.net)};
};
