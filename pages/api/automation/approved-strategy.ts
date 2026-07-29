import type { NextApiRequest,NextApiResponse } from 'next';
import { timingSafeEqual } from 'crypto';
import { getAppliedAutomationStrategy } from '../../../utils/automationStore';
import { createAutomationStrategyArtifact } from '../../../utils/automationStrategyArtifact';

const authorized=(provided:string|undefined,expected:string)=>{
  if(!provided?.startsWith('Bearer ')||!expected)return false;
  const supplied=Buffer.from(provided.slice(7)),wanted=Buffer.from(expected);
  return supplied.length===wanted.length&&timingSafeEqual(supplied,wanted);
};

export default function handler(req:NextApiRequest,res:NextApiResponse){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({error:'Method not allowed'});
  }
  const token=String(process.env.AUTOMATION_CONFIG_READ_TOKEN??'');
  if(!authorized(req.headers.authorization,token))return res.status(401).json({error:'Unauthorized'});
  const artifact=createAutomationStrategyArtifact(getAppliedAutomationStrategy());
  return res.status(200).json({
    schemaVersion:artifact.schemaVersion,configurationId:artifact.versionId,
    createdAt:artifact.createdAt,activatedAt:artifact.approvedAt,
    contentHash:artifact.contentHash,artifact,
  });
}
