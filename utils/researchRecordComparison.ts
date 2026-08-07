type ResearchConfig=Record<string,unknown>&{
  datasetKey?:string;
  datasetEndTime?:number;
  researchManifest?:{
    capturedAt?:string;
    versions?:Record<string,string>;
    [key:string]:unknown;
  };
};

export type ResearchRecordForComparison={config:ResearchConfig};

const comparableConfig=(config:ResearchConfig)=>{
  const copy=JSON.parse(JSON.stringify(config)) as ResearchConfig;
  delete copy.label;
  delete copy.datasetKey;
  delete copy.datasetEndTime;
  if(copy.researchManifest){
    delete copy.researchManifest.capturedAt;
    if(copy.researchManifest.versions){
      delete copy.researchManifest.versions.codeRevision;
      delete copy.researchManifest.versions.sourceState;
    }
  }
  return copy;
};

const differentPaths=(left:unknown,right:unknown,prefix=''):string[]=>{
  if(Object.is(left,right))return [];
  if(Array.isArray(left)||Array.isArray(right))return JSON.stringify(left)===JSON.stringify(right)?[]:[prefix||'configuration'];
  if(left&&right&&typeof left==='object'&&typeof right==='object'){
    const leftObject=left as Record<string,unknown>,rightObject=right as Record<string,unknown>;
    const keys=new Set([...Object.keys(leftObject),...Object.keys(rightObject)]);
    return [...keys].sort().flatMap(key=>differentPaths(leftObject[key],rightObject[key],prefix?`${prefix}.${key}`:key));
  }
  return [prefix||'configuration'];
};

const sourceIdentity=(record:ResearchRecordForComparison)=>({
  revision:record.config.researchManifest?.versions?.codeRevision,
  state:record.config.researchManifest?.versions?.sourceState,
});

export const compareResearchRecords=(reference:ResearchRecordForComparison,current:ResearchRecordForComparison)=>{
  const changedSettings=differentPaths(comparableConfig(reference.config),comparableConfig(current.config));
  const referenceSource=sourceIdentity(reference),currentSource=sourceIdentity(current);
  const codeComparison=!referenceSource.revision||!currentSource.revision
    ?'unknown'
    :referenceSource.revision===currentSource.revision&&referenceSource.state===currentSource.state
      ?'same'
      :'different';
  const referenceCutoff=Number(reference.config.datasetEndTime);
  const currentCutoff=Number(current.config.datasetEndTime);
  return {
    changedSettings,
    settingsMatch:changedSettings.length===0,
    datasetChanged:reference.config.datasetKey!==current.config.datasetKey||referenceCutoff!==currentCutoff,
    cutoffDeltaSeconds:Number.isFinite(referenceCutoff)&&Number.isFinite(currentCutoff)?currentCutoff-referenceCutoff:null,
    codeComparison:codeComparison as 'same'|'different'|'unknown',
    referenceSource,
    currentSource,
  };
};
