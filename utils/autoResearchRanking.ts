export type ResearchRankingMetrics={netR?:number|null;maxDrawdownR?:number|null};
export type ResearchRankingRow={metrics:{official?:ResearchRankingMetrics}};

const netR=(row:ResearchRankingRow)=>Number(row.metrics.official?.netR??Number.NEGATIVE_INFINITY);
const drawdown=(row:ResearchRankingRow)=>Number(row.metrics.official?.maxDrawdownR??Number.POSITIVE_INFINITY);

export const rankAutoResearchResults=<T extends ResearchRankingRow>(rows:T[])=>{
  const remaining=[...rows];
  const ranked:T[]=[];
  while(remaining.length){
    remaining.sort((left,right)=>netR(right)-netR(left)||drawdown(left)-drawdown(right));
    const netLeader=remaining[0];
    const closeLowerDrawdown=remaining.filter(candidate=>
      candidate!==netLeader
      &&netR(candidate)>=netR(netLeader)-3
      &&drawdown(candidate)<drawdown(netLeader)*0.95
    ).sort((left,right)=>drawdown(left)-drawdown(right)||netR(right)-netR(left))[0];
    const winner=closeLowerDrawdown??netLeader;
    ranked.push(winner);
    remaining.splice(remaining.indexOf(winner),1);
  }
  return ranked;
};
