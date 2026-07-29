export const isPiRuntime=()=>process.env.TRADING_KEYS_PI_RUNTIME==='true';

export const assertResearchAllowed=()=>{
  if(isPiRuntime())throw new Error('Research is disabled in the Raspberry Pi automation runtime.');
};
