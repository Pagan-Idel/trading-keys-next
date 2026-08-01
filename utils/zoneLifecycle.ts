export const ZONE_LIFECYCLE_STATES=['DISCOVERED','DEPARTURE_PENDING','ACTIVE_FAR','APPROACHING','ARMED','TOUCHED','EXECUTED','INVALIDATED','EXPIRED'] as const;
export type ZoneLifecycleState=typeof ZONE_LIFECYCLE_STATES[number];
export type ZoneLifecycleRecord={zoneId:string;pair:string;state:ZoneLifecycleState;updatedAt:number;reason?:string;touchKey?:string};
export type ZoneLifecycleEvent=
  |{type:'departure_pending'}|{type:'departure_confirmed'}|{type:'approach'}|{type:'arm'}|{type:'touch';touchKey:string}
  |{type:'execute'}|{type:'invalidate';reason:string}|{type:'expire';reason:string}|{type:'far'};
const terminal=new Set<ZoneLifecycleState>(['EXECUTED','INVALIDATED','EXPIRED']);
export const transitionZoneLifecycle=(record:ZoneLifecycleRecord,event:ZoneLifecycleEvent,now=Date.now()):ZoneLifecycleRecord=>{
  if(terminal.has(record.state))return record;
  let state=record.state,reason=record.reason,touchKey=record.touchKey;
  if(event.type==='invalidate'){state='INVALIDATED';reason=event.reason}
  else if(event.type==='expire'){state='EXPIRED';reason=event.reason}
  else if(event.type==='departure_pending'&&state==='DISCOVERED')state='DEPARTURE_PENDING';
  else if(event.type==='departure_confirmed'&&(state==='DISCOVERED'||state==='DEPARTURE_PENDING'))state='ACTIVE_FAR';
  else if(event.type==='approach'&&(state==='ACTIVE_FAR'||state==='ARMED'))state='APPROACHING';
  else if(event.type==='arm'&&(state==='ACTIVE_FAR'||state==='APPROACHING'))state='ARMED';
  else if(event.type==='far'&&(state==='APPROACHING'||state==='ARMED'))state='ACTIVE_FAR';
  else if(event.type==='touch'&&(state==='APPROACHING'||state==='ARMED')){state='TOUCHED';touchKey=event.touchKey}
  else if(event.type==='execute'&&state==='TOUCHED')state='EXECUTED';
  if(state===record.state&&reason===record.reason&&touchKey===record.touchKey)return record;
  return {...record,state,reason,touchKey,updatedAt:now};
};

export type StreamNeed={actionableZones:number;armed:boolean;activeManagement:boolean;setAndForgetProtected:boolean;shutdown:boolean};
export const shouldRetainPricingStream=(need:StreamNeed)=>!need.shutdown&&(need.activeManagement||need.armed||need.actionableZones>0)&&!need.setAndForgetProtected;
export const canExecuteTouch=(record:ZoneLifecycleRecord,streamFresh:boolean,brokerStateKnown:boolean,touchKey:string)=>
  (record.state==='ARMED'||record.state==='APPROACHING')&&streamFresh&&brokerStateKnown&&record.touchKey!==touchKey;
