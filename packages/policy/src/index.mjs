/** Pure, deterministic readiness policy; AI cannot override mandatory blockers. */
export const CRITERION_STATES = Object.freeze({MET:'MET',UNMET:'UNMET',UNKNOWN:'UNKNOWN',STALE:'STALE',NOT_APPLICABLE:'NOT_APPLICABLE',EXCEPTION_ACCEPTED:'EXCEPTION_ACCEPTED'});
/** @param {Array<{id:string,mandatory:boolean,state:string,exception?:{authorized:boolean,expiresAt:string,targetDigest:string,policyVersion:string,environmentId:string}}>} criteria
 * @param {{targetDigest:string,policyVersion:string,environmentId:string,now:string}} context */
export function evaluateReadiness(criteria,context) {
  if(!Array.isArray(criteria)||!context?.targetDigest||!context?.policyVersion||!context?.environmentId||!context?.now)throw new TypeError('Explicit criteria, target digest, policy, environment and evaluation time required');
  const now=Date.parse(context.now);if(!Number.isFinite(now))throw new TypeError('Invalid evaluation timestamp');
  const ids=new Set();const results=criteria.map(c=>{
    if(!c.id||ids.has(c.id))throw new TypeError('Criterion IDs must be unique');ids.add(c.id);
    if(!Object.values(CRITERION_STATES).includes(c.state)||c.state==='EXCEPTION_ACCEPTED')throw new TypeError('Unsupported input criterion state');
    if(c.mandatory&&c.state==='NOT_APPLICABLE')throw new TypeError('Mandatory criterion applicability requires an authorized policy decision');
    const ex=c.exception;const validException=c.mandatory&&c.state==='UNMET'&&ex?.authorized===true&&
      ex.targetDigest===context.targetDigest&&ex.policyVersion===context.policyVersion&&ex.environmentId===context.environmentId&&
      Number.isFinite(Date.parse(ex.expiresAt))&&Date.parse(ex.expiresAt)>now;
    return {id:c.id,mandatory:c.mandatory===true,state:validException?'EXCEPTION_ACCEPTED':c.state,originalState:c.state,acceptedException:Boolean(validException)};
  });
  const must=results.filter(x=>x.mandatory);
  const blocked=must.some(x=>x.state==='UNMET');
  const insufficient=must.some(x=>x.state==='UNKNOWN'||x.state==='STALE');
  const conditional=must.some(x=>x.state==='EXCEPTION_ACCEPTED');
  return Object.freeze({status:blocked?'BLOCKED':insufficient?'INSUFFICIENT_EVIDENCE':conditional?'READY_WITH_CONDITIONS':'READY',
    targetDigest:context.targetDigest,environmentId:context.environmentId,policyVersion:context.policyVersion,evaluatedAt:context.now,results});
}
