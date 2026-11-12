/* TEST ONLY: an in-browser, synthetic API transport; never imported by application assets. */
function installOfflineTransport() {
  const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const orgs=new Map([[A,new Map()],[B,new Map()]]), receipts=new Map(), revoked=new Set(), readonly=new Set(),calls=[];
  let serial=0, authenticated=true, drop=false;
  // Opaque-origin component tests lack randomUUID. This deterministic fixture is NOT production crypto.
  if (!crypto.randomUUID) Object.defineProperty(crypto,'randomUUID',{value:()=>`11111111-1111-4111-8111-${String(++serial).padStart(12,'0')}`});
  window.previewStorageReads=0;
  Object.defineProperty(window,'localStorage',{get(){window.previewStorageReads++;throw new Error('Connected UI must not touch preview storage.');}});
  const response=(value,status=200)=>Response.json(value,{status});
  const fail=(status,code,message)=>response({error:{code,message}},status);
  window.fetch=async(path,init={})=>{
    if(path.endsWith('/session'))return authenticated?response({authenticated:true,csrfToken:'offline-csrf-fixture',expiresAt:new Date(Date.now()+1800000).toISOString()}):fail(401,'SESSION_EXPIRED','Sign in again.');
    if(!authenticated)return fail(401,'SESSION_EXPIRED','Sign in again.');
    if(path.endsWith('/logout')){authenticated=false;return response({signedOut:true});}
    const u=new URL(path,'https://offline.invalid'),parts=u.pathname.split('/').filter(Boolean);
    const org=parts[4],projectId=parts[6],operation=parts[7],ps=orgs.get(org),p=ps?.get(projectId);
    calls.push({path:u.pathname,method:init.method,key:init.headers['idempotency-key']||null});
    if(!ps||revoked.has(org))return fail(404,'NOT_FOUND','Access unavailable.');
    if(init.method==='GET'){
      if(!projectId)return response({projects:[...ps.values()].map(({id,name,revision})=>({id,name,revision})),next:null});
      if(!p)return fail(404,'NOT_FOUND','Unknown project.');
      if(operation==='readiness')return response(assessProject(p,Object.fromEntries(u.searchParams)));
      if(operation==='report-template')return response(reportTemplate(p,u.searchParams.get('buildId')));
      if(operation==='assessments')return response(p.assessments.find(a=>a.id===parts[8]));
      return response(p);
    }
    if(readonly.has(org))return fail(403,'FORBIDDEN','This test membership is read-only.');
    const key=org+':'+init.headers['idempotency-key'],body=JSON.parse(init.body);
    if(receipts.has(key))return response(receipts.get(key));
    let next;
    try{
      if(!projectId)next=createProject(body);
      else {if(!p)return fail(404,'NOT_FOUND','Unknown project.');if(body.expectedRevision!==p.revision)return fail(409,'REVISION_CONFLICT','Reload the project.');next=applyCommand(p,{type:body.type,input:body.input});}
    }catch(e){return fail(400,'INVALID_INPUT',e.message);}
    ps.set(next.id,next);const ack={projectId:next.id,revision:next.revision,requestId:init.headers['idempotency-key']};receipts.set(key,ack);
    if(drop){drop=false;throw new TypeError('Synthetic acknowledgement lost after commit.');}
    return response(ack);
  };
  window.__offline={downloads:[],control({action,orgId,value}){
    if(action==='drop-next')drop=true;
    if(action==='revoke')revoked.add(orgId);
    if(action==='restore')revoked.delete(orgId);
    if(action==='read-only')value?readonly.add(orgId):readonly.delete(orgId);
    if(action==='expire')authenticated=false;
    if(action==='authenticate')authenticated=true;
    return structuredClone({organizations:Object.fromEntries([...orgs].map(([k,v])=>[k,[...v.values()]])),calls});
  }};
}
installOfflineTransport();
