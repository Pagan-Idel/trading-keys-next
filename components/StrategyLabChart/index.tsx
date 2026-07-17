import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createSeriesMarkers,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import styled from 'styled-components';
import { detectGoldilocksZones, findFullCandleEngulfing, validateFinalEntryAfterEngulf, type GoldilocksZone, type StrategyCandle, type SwingLeg, type TradeRunwayCheck } from '../../utils/goldilocksStrategy';

type Zone = {
  id: string;
  label: string;
  kind: 'demand' | 'supply';
  low: number;
  high: number;
  startTime: UTCTimestamp;
  endTime: UTCTimestamp;
  baseTime: UTCTimestamp;
  historicalTradeZone: boolean;
};

const Wrap=styled.div`position:relative;width:100%;height:540px;border:1px solid #2b303a;border-radius:18px;overflow:hidden;background:#080a0e;`;
const Canvas=styled.div`position:absolute;inset:0;`;
const Overlay=styled.div`position:absolute;inset:0;pointer-events:none;z-index:3;`;
const Box=styled.div<{kind:'demand'|'supply';historicalTradeZone:boolean}>`position:absolute;border:2px solid ${({kind,historicalTradeZone})=>historicalTradeZone?'#f4a340':kind==='demand'?'#26bdf3':'#ff4f91'};background:${({kind,historicalTradeZone})=>historicalTradeZone?'rgba(191,112,24,.22)':kind==='demand'?'rgba(24,145,204,.18)':'rgba(211,31,105,.18)'};box-shadow:0 0 18px ${({kind,historicalTradeZone})=>historicalTradeZone?'rgba(244,163,64,.24)':kind==='demand'?'rgba(38,189,243,.17)':'rgba(255,79,145,.14)'};`;
const Label=styled.span`position:absolute;left:5px;top:4px;color:#ecf9ff;font:700 10px/1.2 system-ui;background:rgba(8,8,14,.78);padding:3px 5px;border-radius:4px;`;
const RunwayStatus=styled.div<{allowed:boolean}>`position:absolute;right:14px;top:14px;padding:9px 12px;border-radius:9px;border:1px solid ${({allowed})=>allowed?'#2edb91':'#ff5f70'};background:${({allowed})=>allowed?'rgba(12,67,48,.9)':'rgba(83,22,32,.92)'};color:#fff;font:800 11px/1.35 system-ui;text-align:right;box-shadow:0 8px 30px rgba(0,0,0,.35);`;
const TrendStatus=styled.div<{direction:'bullish'|'bearish'}>`position:absolute;left:14px;top:14px;padding:8px 11px;border-radius:9px;border:1px solid ${({direction})=>direction==='bullish'?'#2edb91':'#ff6876'};background:${({direction})=>direction==='bullish'?'rgba(12,67,48,.9)':'rgba(83,22,32,.92)'};color:#fff;font:800 11px/1.2 system-ui;box-shadow:0 8px 30px rgba(0,0,0,.35);`;
const RatioBox=styled.div<{reward:boolean}>`position:absolute;border:1px solid ${({reward})=>reward?'rgba(46,219,145,.8)':'rgba(255,95,112,.8)'};background:${({reward})=>reward?'rgba(46,219,145,.13)':'rgba(255,95,112,.15)'};`;

const start=Date.UTC(2026,0,5,14,0)/1000;
const time=(index:number)=>(start+index*15*60) as UTCTimestamp;

const coreBullishValues=[
  [104.8,105.4,103.5,104.0],[104.0,104.3,102.7,103.1],[103.1,103.4,101.6,102.0],
  [102.0,102.5,100.4,100.9],[100.9,101.3,99.2,99.7],[101.0,101.4,97.8,98.8],
  [98.8,101.8,98.5,101.4],[101.4,103.2,101.1,102.9],[102.9,104.4,102.5,104.0],
  [104.0,104.2,102.4,102.8],[102.8,106.1,102.6,105.8],[105.8,108.3,105.4,108.0],
  [108.0,110.2,107.7,109.8],[109.8,112.0,109.2,111.5],[111.5,111.7,109.8,110.2],
  [110.2,110.5,107.2,107.8],[107.8,108.1,104.1,104.6],[104.6,105.0,102.8,103.5],
  [103.5,105.2,102.7,104.6],[104.6,106.4,104.5,106.0],[106.0,107.3,104.0,104.5],[104.4,107.5,103.9,107.1],
];
const historyAnchors=[108,101,110,103,112,100,109,102,106,104.8];
const historyValues:number[][]=[];
for(let segment=0;segment<historyAnchors.length-1;segment+=1){for(let step=0;step<10;step+=1){const progress=step/10;const center=historyAnchors[segment]+(historyAnchors[segment+1]-historyAnchors[segment])*progress;const next=historyAnchors[segment]+(historyAnchors[segment+1]-historyAnchors[segment])*((step+1)/10);const open=center+(step%2===0?.16:-.12);const close=next+(step%3===0?-.1:.1);historyValues.push([open,Math.max(open,close)+.28,Math.min(open,close)-.28,close])}}
const testOffset=historyValues.length;
const bullishCandles:CandlestickData<Time>[]=([...historyValues,...coreBullishValues]).map((c,index)=>({time:time(index),open:c[0],high:c[1],low:c[2],close:c[3]}));

const bearishCandles:CandlestickData<Time>[]=bullishCandles.map((c,index)=>({
  time:c.time,
  open:220-(c.open as number),
  high:220-(c.low as number),
  low:220-(c.high as number),
  close:220-(c.close as number),
}));

type SwingMarker={swing:'HH'|'HL'|'LH'|'LL';price:number;candleIndex:number;time:number};
type HistoricalTradeSetup={zone:GoldilocksZone;confirmationTimeframe:string;confirmationTime:number;confirmationCandle:StrategyCandle;runway:TradeRunwayCheck;outcome:'win'|'loss'|'open';outcomeTime?:number};
type ChartScenario={candles:StrategyCandle[];leg:SwingLeg;swings?:SwingMarker[];zones?:GoldilocksZone[];tradeSetup?:HistoricalTradeSetup|null};

export default function StrategyLabChart({direction,scenario,runwayExample='blocked',pricePrecision=2}:{direction:'bullish'|'bearish';scenario?:ChartScenario;runwayExample?:'clear'|'blocked';pricePrecision?:number}){
  const containerRef=useRef<HTMLDivElement|null>(null);
  const chartRef=useRef<IChartApi|null>(null);
  const seriesRef=useRef<ISeriesApi<'Candlestick'>|null>(null);
  const [positions,setPositions]=useState<Array<Zone&{left:number;top:number;width:number;height:number;baseX:number}>>([]);
  const [ratioPosition,setRatioPosition]=useState<{left:number;width:number;entryY:number;stopY:number;targetY:number}|null>(null);
  const candles=useMemo<CandlestickData<Time>[]>(()=>scenario
    ? scenario.candles.map(candle=>({time:candle.time as UTCTimestamp,open:candle.open,high:candle.high,low:candle.low,close:candle.close}))
    : direction==='bullish'?bullishCandles:bearishCandles,[direction,scenario]);
  const detection=useMemo(()=>{
    const strategyCandles:StrategyCandle[]=candles.map(candle=>({time:Number(candle.time),open:Number(candle.open),high:Number(candle.high),low:Number(candle.low),close:Number(candle.close)}));
    return detectGoldilocksZones(strategyCandles,scenario?.leg??{direction,startIndex:testOffset+5,endIndex:testOffset+13});
  },[candles,direction,scenario]);
  const entryZone=scenario?.tradeSetup?.zone??detection.zones.find(zone=>zone.kind==='continuation')??detection.zones.find(zone=>zone.kind==='base');
  const strategyCandles=useMemo<StrategyCandle[]>(()=>candles.map(candle=>({time:Number(candle.time),open:Number(candle.open),high:Number(candle.high),low:Number(candle.low),close:Number(candle.close)})),[candles]);
  const liveConfirmation=useMemo(()=>scenario?findFullCandleEngulfing(strategyCandles,direction,scenario.leg.endIndex+1):undefined,[direction,scenario,strategyCandles]);
  const entryCandleIndex=scenario?.tradeSetup?undefined:scenario?liveConfirmation?.candleIndex:runwayExample==='blocked'?testOffset+21:testOffset+18;
  const entryTime=(scenario?.tradeSetup?.confirmationTime??(entryCandleIndex===undefined?undefined:Number(candles[entryCandleIndex]?.time))) as UTCTimestamp|undefined;
  const engulfClose=scenario?.tradeSetup?.confirmationCandle.close??(entryCandleIndex===undefined?undefined:strategyCandles[entryCandleIndex]?.close);
  const testHistoricalZones=useMemo(()=>{
    if(scenario)return detection.zones;
    const strategyCandles=candles.map(candle=>({time:Number(candle.time),open:Number(candle.open),high:Number(candle.high),low:Number(candle.low),close:Number(candle.close)}));
    const opposingLeg:SwingLeg=direction==='bullish'?{direction:'bearish',startIndex:testOffset+13,endIndex:testOffset+17}:{direction:'bullish',startIndex:testOffset+13,endIndex:testOffset+17};
    return [...detection.zones,...detectGoldilocksZones(strategyCandles,opposingLeg).zones];
  },[candles,detection.zones,direction,scenario]);
  const knownZones=useMemo(()=>scenario?.zones??testHistoricalZones,[scenario?.zones,testHistoricalZones]);
  const actualEntryPrice=scenario?strategyCandles[strategyCandles.length-1]?.close:engulfClose;
  const calculatedRunway=useMemo(()=>entryZone&&engulfClose!==undefined&&actualEntryPrice!==undefined?validateFinalEntryAfterEngulf(entryZone,knownZones,engulfClose,actualEntryPrice):undefined,[actualEntryPrice,engulfClose,entryZone,knownZones]);
  const runway=scenario?.tradeSetup?.runway??calculatedRunway;
  const displayedDetectionZones=useMemo(()=>{
    const tradeZone=scenario?.tradeSetup?.zone;
    return tradeZone?[...knownZones.filter(zone=>zone.id!==tradeZone.id),tradeZone]:knownZones;
  },[knownZones,scenario?.tradeSetup?.zone]);
  const zones=useMemo<Zone[]>(()=>{
    return displayedDetectionZones.map(zone=>{
      const historicalTradeZone=scenario?.tradeSetup?.zone.id===zone.id;
      const outcome=scenario?.tradeSetup?.outcome;
      return {
      id:zone.id,
      label:`${historicalTradeZone?`HISTORY TRADE ZONE${outcome?` (${outcome.toUpperCase()})`:''} · `:''}${zone.kind==='base'?'Base':'Continuation'} ${zone.side} · ${zone.departureMultiple.toFixed(1)}x · ${zone.touches} touch${zone.touches===1?'':'es'}${zone.availableAt?` · active ${new Date(zone.availableAt*1000).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}`:''}${zone.timeframeConfluence?` · MTF ${zone.timeframeConfluence.timeframeCount}/3 (${zone.timeframeConfluence.timeframes.join(' + ')})`:''}`,
      kind:zone.side,
      low:zone.low,
      high:zone.high,
      startTime:zone.candleTime as UTCTimestamp,
      endTime:(historicalTradeZone&&scenario?.tradeSetup?.outcomeTime?scenario.tradeSetup.outcomeTime:Number(candles[candles.length-1].time)) as UTCTimestamp,
      baseTime:zone.candleTime as UTCTimestamp,
      historicalTradeZone,
    }});
  },[candles,displayedDetectionZones,scenario?.tradeSetup]);

  useEffect(()=>{
    if(!containerRef.current)return;
    const chart=createChart(containerRef.current,{autoSize:true,layout:{background:{type:ColorType.Solid,color:'#080a0e'},textColor:'#778293'},crosshair:{mode:CrosshairMode.Normal},grid:{vertLines:{color:'#151922'},horzLines:{color:'#151922'}},rightPriceScale:{borderColor:'#272d38'},timeScale:{borderColor:'#272d38',timeVisible:true}});
    const series=chart.addSeries(CandlestickSeries,{upColor:'#2edb91',downColor:'#ff5f70',wickUpColor:'#2edb91',wickDownColor:'#ff5f70',borderVisible:false,priceFormat:{type:'price',precision:pricePrecision,minMove:10**-pricePrecision}});
    const candleReadout=document.createElement('div');
    candleReadout.style.cssText='position:absolute;left:190px;top:14px;z-index:4;padding:7px 9px;border:1px solid #303744;border-radius:7px;background:rgba(8,10,14,.9);color:#dce6f2;font:700 11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;box-shadow:0 8px 24px rgba(0,0,0,.3);pointer-events:none;display:none';
    containerRef.current.appendChild(candleReadout);
    const showCandlePrices=(param:MouseEventParams<Time>)=>{
      const candle=param.seriesData.get(series) as CandlestickData<Time>|undefined;
      candleReadout.style.display=candle?'block':'none';
      if(candle)candleReadout.textContent=`O ${Number(candle.open).toFixed(pricePrecision)}   H ${Number(candle.high).toFixed(pricePrecision)}   L ${Number(candle.low).toFixed(pricePrecision)}   C ${Number(candle.close).toFixed(pricePrecision)}`;
    };
    chart.subscribeCrosshairMove(showCandlePrices);
    const midpoint=detection.midpoint;
    const middle=chart.addSeries(LineSeries,{color:'#f2c94c',lineWidth:1,lineStyle:2,priceLineVisible:false,lastValueVisible:false});
    series.setData(candles);
    const swings=scenario?.swings??[
      ...historyAnchors.slice(0,-1).map((price,index)=>({swing:(index%2===0?'HH':'LL') as 'HH'|'LL',price:direction==='bullish'?price:220-price,candleIndex:index*10,time:Number(time(index*10))})),
      direction==='bullish'
        ? {swing:'LL' as const,price:97.8,candleIndex:testOffset+5,time:Number(time(testOffset+5))}
        : {swing:'HH' as const,price:122.2,candleIndex:testOffset+5,time:Number(time(testOffset+5))},
      direction==='bullish'
        ? {swing:'HH' as const,price:112,candleIndex:testOffset+13,time:Number(time(testOffset+13))}
        : {swing:'LL' as const,price:108,candleIndex:testOffset+13,time:Number(time(testOffset+13))},
    ];
    const legLabels=swings.map(swing=>({
      ...swing,
      legSwing:(swing.swing==='HH'||swing.swing==='LH'?'HH':'LL') as 'HH'|'LL',
    }));
    createSeriesMarkers(series,legLabels.map((swing,index)=>({
      time:swing.time as UTCTimestamp,
      position:swing.legSwing==='HH'?'aboveBar' as const:'belowBar' as const,
      color:swing.legSwing==='HH'?'#55e991':'#ff6876',
      shape:swing.legSwing==='HH'?'arrowUp' as const:'arrowDown' as const,
    })));
    middle.setData(candles.map(c=>({time:c.time,value:midpoint})));
    if(scenario?.tradeSetup){
      const setup=scenario.tradeSetup;
      const confirmationTime=setup.confirmationTime as UTCTimestamp;
      const confirmationSeries=chart.addSeries(CandlestickSeries,{
        upColor:'#ffd84d',
        downColor:'#ffd84d',
        wickUpColor:'#fff2a6',
        wickDownColor:'#fff2a6',
        borderVisible:true,
        borderUpColor:'#ffffff',
        borderDownColor:'#ffffff',
        priceLineVisible:false,
        lastValueVisible:false,
        priceFormat:{type:'price',precision:pricePrecision,minMove:10**-pricePrecision},
      });
      confirmationSeries.setData([{
        time:confirmationTime,
        open:setup.confirmationCandle.open,
        high:setup.confirmationCandle.high,
        low:setup.confirmationCandle.low,
        close:setup.confirmationCandle.close,
      }]);
      createSeriesMarkers(confirmationSeries,[{
        time:confirmationTime,
        position:setup.zone.side==='supply'?'aboveBar':'belowBar',
        color:'#ffd84d',
        shape:setup.zone.side==='supply'?'arrowDown':'arrowUp',
        text:`${setup.confirmationTimeframe} ${setup.zone.side==='supply'?'SELL':'BUY'} ENGULF`,
      }]);
    }
    if(runway&&entryTime!==undefined){
      const lineStart=entryTime;
      const lastCandleTime=Number(candles[candles.length-1].time);
      const previousCandleTime=Number(candles[Math.max(0,candles.length-2)].time);
      const candleInterval=Math.max(1,lastCandleTime-previousCandleTime);
      const lineEnd=(scenario?.tradeSetup?.outcomeTime??Math.max(lastCandleTime,Number(lineStart)+candleInterval)) as UTCTimestamp;
      const addRunwayLine=(value:number,color:string,title:string,lineStyle=0)=>{const line=chart.addSeries(LineSeries,{color,lineWidth:2,lineStyle,priceLineVisible:true,lastValueVisible:true,title});line.setData([{time:lineStart,value},{time:lineEnd,value}])};
      addRunwayLine(runway.entry,'#ffd84d','ENGULF CLOSE · ENTRY');
      addRunwayLine(runway.stopLoss,'#ff5f70','STOP · 1R');
      addRunwayLine(runway.takeProfit,'#2edb91','TARGET · 2R');
    }
    chart.timeScale().fitContent();
    if(scenario?.tradeSetup&&entryTime!==undefined){
      let closestIndex=0;
      let closestDistance=Number.POSITIVE_INFINITY;
      candles.forEach((candle,index)=>{const distance=Math.abs(Number(candle.time)-Number(entryTime));if(distance<closestDistance){closestDistance=distance;closestIndex=index}});
      chart.timeScale().setVisibleLogicalRange({from:Math.max(0,closestIndex-70),to:Math.min(candles.length-1,closestIndex+70)});
    }
    chartRef.current=chart;seriesRef.current=series;
    const place=()=>{setPositions(zones.flatMap(zone=>{const left=chart.timeScale().timeToCoordinate(zone.startTime);const right=chart.timeScale().timeToCoordinate(zone.endTime);const top=series.priceToCoordinate(zone.high);const bottom=series.priceToCoordinate(zone.low);const baseX=chart.timeScale().timeToCoordinate(zone.baseTime);return left===null||right===null||top===null||bottom===null||baseX===null?[]:[{...zone,left,top,width:Math.max(2,right-left),height:Math.max(2,bottom-top),baseX}]}));if(runway&&entryTime!==undefined){const startTime=entryTime;const lastTime=Number(candles[candles.length-1].time);const previousTime=Number(candles[Math.max(0,candles.length-2)].time);const interval=Math.max(1,lastTime-previousTime);const ratioEndTime=(scenario?.tradeSetup?.outcomeTime??Math.max(lastTime,Number(startTime)+interval)) as UTCTimestamp;const left=chart.timeScale().timeToCoordinate(startTime);const right=chart.timeScale().timeToCoordinate(ratioEndTime);const entryY=series.priceToCoordinate(runway.entry);const stopY=series.priceToCoordinate(runway.stopLoss);const targetY=series.priceToCoordinate(runway.takeProfit);setRatioPosition(left===null||right===null||entryY===null||stopY===null||targetY===null?null:{left,width:Math.max(4,right-left),entryY,stopY,targetY})}else setRatioPosition(null)};
    const timer=window.setTimeout(place,50);
    chart.timeScale().subscribeVisibleLogicalRangeChange(place);
    const observer=new ResizeObserver(place);observer.observe(containerRef.current);
    return()=>{window.clearTimeout(timer);observer.disconnect();chart.unsubscribeCrosshairMove(showCandlePrices);candleReadout.remove();chart.remove();chartRef.current=null;seriesRef.current=null};
  },[candles,detection.midpoint,direction,entryTime,pricePrecision,runway,scenario,zones]);

  return <Wrap><Canvas ref={containerRef}/><Overlay><TrendStatus direction={direction}>CURRENT TREND: {direction.toUpperCase()}</TrendStatus>{ratioPosition&&<><RatioBox reward style={{left:ratioPosition.left,top:Math.min(ratioPosition.entryY,ratioPosition.targetY),width:ratioPosition.width,height:Math.abs(ratioPosition.entryY-ratioPosition.targetY)}}/><RatioBox reward={false} style={{left:ratioPosition.left,top:Math.min(ratioPosition.entryY,ratioPosition.stopY),width:ratioPosition.width,height:Math.abs(ratioPosition.entryY-ratioPosition.stopY)}}/></>}{positions.map(zone=><Box key={zone.id} kind={zone.kind} historicalTradeZone={zone.historicalTradeZone} style={{left:zone.left,top:zone.top,width:zone.width,height:zone.height}}><Label>{zone.label}</Label></Box>)}{runway&&<RunwayStatus allowed={runway.allowed}>{runway.allowed?'FINAL 2:1 VALID':'MISSED · DO NOT CHASE'}<br/>{runway.reason}</RunwayStatus>}</Overlay></Wrap>;
}
