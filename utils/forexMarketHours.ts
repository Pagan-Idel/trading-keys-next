export const FOREX_MARKET_TIME_ZONE='America/New_York';
export const FOREX_WEEKLY_OPEN_HOUR=17;
export const FOREX_WEEKLY_CLOSE_HOUR=17;
export const FOREX_WEEKEND_LIQUIDATION_HOUR=16;
export const FOREX_REOPEN_BUFFER_END_HOUR=18;

const weekdayIndex:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};

const newYorkParts=(date:Date)=>{
  const values=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:FOREX_MARKET_TIME_ZONE,
    weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,hourCycle:'h23',
  }).formatToParts(date).map(part=>[part.type,part.value]));
  return {
    weekday:weekdayIndex[values.weekday]??-1,
    year:Number(values.year),month:Number(values.month),day:Number(values.day),
    hour:Number(values.hour),minute:Number(values.minute),second:Number(values.second),
  };
};

const wallClockEpoch=(year:number,month:number,day:number,hour:number)=>{
  const targetAsUtc=Date.UTC(year,month-1,day,hour,0,0);
  let guess=targetAsUtc;
  const formatter=new Intl.DateTimeFormat('en-US',{
    timeZone:FOREX_MARKET_TIME_ZONE,hour12:false,hourCycle:'h23',
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',
  });
  for(let iteration=0;iteration<3;iteration+=1){
    const values=Object.fromEntries(formatter.formatToParts(new Date(guess)).map(part=>[part.type,part.value]));
    const representedAsUtc=Date.UTC(
      Number(values.year),Number(values.month)-1,Number(values.day),
      Number(values.hour),Number(values.minute),Number(values.second),
    );
    guess+=targetAsUtc-representedAsUtc;
  }
  return Math.floor(guess/1000);
};

const localTime=(parts:ReturnType<typeof newYorkParts>)=>parts.hour+parts.minute/60+parts.second/3600;

const dateKey=(year:number,month:number,day:number)=>`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
const utcDate=(year:number,month:number,day:number)=>new Date(Date.UTC(year,month-1,day));
const nthWeekday=(year:number,month:number,weekday:number,nth:number)=>{
  const date=utcDate(year,month,1);
  while(date.getUTCDay()!==weekday)date.setUTCDate(date.getUTCDate()+1);
  date.setUTCDate(date.getUTCDate()+(nth-1)*7);
  return date;
};
const lastWeekday=(year:number,month:number,weekday:number)=>{
  const date=utcDate(year,month+1,0);
  while(date.getUTCDay()!==weekday)date.setUTCDate(date.getUTCDate()-1);
  return date;
};
const keyForDate=(date:Date)=>dateKey(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate());
const addObservedFixedHoliday=(set:Set<string>,year:number,month:number,day:number)=>{
  const date=utcDate(year,month,day);
  set.add(keyForDate(date));
  if(date.getUTCDay()===6){
    const observed=new Date(date);observed.setUTCDate(observed.getUTCDate()-1);set.add(keyForDate(observed));
  }else if(date.getUTCDay()===0){
    const observed=new Date(date);observed.setUTCDate(observed.getUTCDate()+1);set.add(keyForDate(observed));
  }
};

/** Configured U.S. market holidays. Half-days remain full no-trade days by strategy contract. */
export const getUSDHolidayDates=(year:number):{fullHolidays:Set<string>;partialHolidays:Set<string>}=>{
  const fullHolidays=new Set<string>();
  const partialHolidays=new Set<string>();
  addObservedFixedHoliday(fullHolidays,year,1,1);
  fullHolidays.add(keyForDate(nthWeekday(year,1,1,3)));
  fullHolidays.add(keyForDate(nthWeekday(year,2,1,3)));
  fullHolidays.add(keyForDate(lastWeekday(year,5,1)));
  addObservedFixedHoliday(fullHolidays,year,6,19);
  addObservedFixedHoliday(fullHolidays,year,7,4);
  fullHolidays.add(keyForDate(nthWeekday(year,9,1,1)));
  fullHolidays.add(keyForDate(nthWeekday(year,10,1,2)));
  addObservedFixedHoliday(fullHolidays,year,11,11);
  const thanksgiving=nthWeekday(year,11,4,4);
  fullHolidays.add(keyForDate(thanksgiving));
  addObservedFixedHoliday(fullHolidays,year,12,25);
  const blackFriday=new Date(thanksgiving);blackFriday.setUTCDate(blackFriday.getUTCDate()+1);
  partialHolidays.add(keyForDate(blackFriday));
  partialHolidays.add(dateKey(year,12,24));
  partialHolidays.add(dateKey(year,7,3));
  return {fullHolidays,partialHolidays};
};

export interface ForexHolidayStatus {
  blocked:boolean;
  marketDate:string;
  kind:'full'|'partial'|null;
  reason:string;
}

/** Evaluates the New York market date, so the result is stable across Windows, Pi, EST, and EDT. */
export const getForexHolidayStatusAt=(date=new Date()):ForexHolidayStatus=>{
  const parts=newYorkParts(date);
  const marketDate=dateKey(parts.year,parts.month,parts.day);
  const {fullHolidays,partialHolidays}=getUSDHolidayDates(parts.year);
  const kind=fullHolidays.has(marketDate)?'full':partialHolidays.has(marketDate)?'partial':null;
  return {
    blocked:kind!==null,
    marketDate,
    kind,
    reason:kind
      ?`${marketDate} is a configured U.S. ${kind==='full'?'market holiday':'holiday/half-day'} in America/New_York.`
      :`${marketDate} is not a configured U.S. no-trade holiday.`,
  };
};

export const isForexHolidayAt=(date=new Date())=>getForexHolidayStatusAt(date).blocked;

export const isForexMarketOpenAt=(date=new Date())=>{
  const parts=newYorkParts(date);
  const time=localTime(parts);
  if(parts.weekday===0)return time>=FOREX_WEEKLY_OPEN_HOUR;
  if(parts.weekday>=1&&parts.weekday<=4)return true;
  if(parts.weekday===5)return time<FOREX_WEEKLY_CLOSE_HOUR;
  return false;
};

export const isForexWeekendEntryBlocked=(date=new Date())=>{
  const parts=newYorkParts(date);
  const time=localTime(parts);
  if(parts.weekday===5)return time>=FOREX_WEEKEND_LIQUIDATION_HOUR;
  if(parts.weekday===6)return true;
  if(parts.weekday===0)return time<FOREX_REOPEN_BUFFER_END_HOUR;
  return false;
};

export const isForexWeekendLiquidationWindow=(date=new Date())=>{
  const parts=newYorkParts(date);
  const time=localTime(parts);
  return parts.weekday===5&&time>=FOREX_WEEKEND_LIQUIDATION_HOUR&&time<FOREX_WEEKLY_CLOSE_HOUR;
};

export const nextForexWeekendLiquidationTime=(epochSeconds:number)=>{
  const date=new Date(epochSeconds*1000);
  const parts=newYorkParts(date);
  let daysToFriday=(5-parts.weekday+7)%7;
  let targetDate=new Date(Date.UTC(parts.year,parts.month-1,parts.day+daysToFriday,12));
  let cutoff=wallClockEpoch(targetDate.getUTCFullYear(),targetDate.getUTCMonth()+1,targetDate.getUTCDate(),FOREX_WEEKEND_LIQUIDATION_HOUR);
  if(cutoff<=epochSeconds){
    targetDate=new Date(Date.UTC(targetDate.getUTCFullYear(),targetDate.getUTCMonth(),targetDate.getUTCDate()+7,12));
    cutoff=wallClockEpoch(targetDate.getUTCFullYear(),targetDate.getUTCMonth()+1,targetDate.getUTCDate(),FOREX_WEEKEND_LIQUIDATION_HOUR);
  }
  return cutoff;
};
