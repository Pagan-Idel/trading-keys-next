export const GOLDILOCKS_ZONE_AGE_DAY_SECONDS=24*60*60;

export const getGoldilocksZoneAgeSeconds=(
  zoneCandleTime:number,
  entryEligibilityTime:number,
)=>Math.max(0,Math.floor(entryEligibilityTime-zoneCandleTime));

export const getGoldilocksZoneAgeDays=(zoneAgeSeconds:number)=>(
  Math.max(0,zoneAgeSeconds)/GOLDILOCKS_ZONE_AGE_DAY_SECONDS
);

export const formatGoldilocksZoneAge=(zoneAgeSeconds:number|null|undefined)=>(
  Number.isFinite(zoneAgeSeconds)
    ?`${getGoldilocksZoneAgeDays(zoneAgeSeconds!).toFixed(1)}d`
    :'Legacy'
);
