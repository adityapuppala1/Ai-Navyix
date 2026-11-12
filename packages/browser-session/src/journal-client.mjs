/** Browser-safe journal adapter: same-origin session only; no token or observation persistence. */
import { BrowserWorkspace, WorkspaceError } from './client.mjs';
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const fail=(code,message)=>{throw new WorkspaceError(0,code,message);};
export class EvidenceJournalClient {
  constructor({workspace=new BrowserWorkspace(),uuid=()=>crypto.randomUUID()}={}){
    this.workspace=workspace;this.uuid=uuid;this.epoch=0;this.pending=null;this.writing=false;this.clearViews();
    const lost=workspace.onSessionLost;workspace.onSessionLost=()=>{this.clear();lost();};
  }
  clearViews(){this.rows=[];this.next=null;this.selected=null;}
  clear(){this.epoch++;this.pending=null;this.clearViews();}
  idle(){if(this.pending||this.writing)fail('PENDING_WRITE','Resolve the unconfirmed capture before changing context.');}
  context(){const w=this.workspace;if(!w.orgId||!w.project)fail('PROJECT_REQUIRED','Select an organization and project.');return{orgId:w.orgId,projectId:w.project.id,generation:w.generation};}
  same(c,epoch){this.workspace.assertCurrent(c.generation);if(c.orgId!==this.workspace.orgId||c.projectId!==this.workspace.project?.id||epoch!==this.epoch)fail('STALE_CONTEXT','Workspace context changed.');}
  path(c){return `api/orgs/${c.orgId}/projects/${c.projectId}/github-observations`;}
  async connect(org){this.idle();this.clear();await this.workspace.connect(org);if(this.workspace.project)await this.history();}
  async project(id){this.idle();this.clear();await this.workspace.load(id);await this.history();}
  async history(more=false){
    this.idle();const c=this.context(),epoch=++this.epoch,after=more?this.next:null;
    if(more&&!after)return;
    const existing=more?[...this.rows]:[];this.selected=null;if(!more)this.clearViews();
    try{
      const data=await this.workspace.request(`${this.path(c)}?limit=20${after?`&after=${after}`:''}`);this.same(c,epoch);
      if(data.orgId!==c.orgId||data.projectId!==c.projectId||!Array.isArray(data.observations)||data.observations.length>20)fail('INVALID_RESPONSE','Evidence history does not match this project.');
      const seen=new Set(existing.map(r=>r.id));
      for(const r of data.observations){
        if(!ID.test(r.id||'')||seen.has(r.id)||!Number.isFinite(Date.parse(r.recordedAt))||!Number.isSafeInteger(r.projectRevision)||r.projectRevision<1||!HASH.test(r.recordSha256||'')||r.readinessEffect!=='none')fail('INVALID_RESPONSE','Invalid saved evidence summary.');
        seen.add(r.id);
      }
      if(data.next!==null&&(!ID.test(data.next||'')||data.next!==data.observations.at(-1)?.id||data.next===after))fail('INVALID_RESPONSE','Invalid evidence page cursor.');
      if(existing.length+data.observations.length>100)fail('INVALID_RESPONSE','Evidence history exceeds the pilot limit.');
      this.rows=[...existing,...data.observations];this.next=data.next;
    }catch(e){if(epoch===this.epoch){this.clearViews();}throw e;}
  }
  async open(id){
    this.idle();if(!ID.test(id||''))fail('INVALID_ID','Select a saved observation.');const c=this.context(),epoch=++this.epoch;this.selected=null;
    let record;
    try{record=await this.workspace.request(`${this.path(c)}/${id}`);this.same(c,epoch);}
    catch(e){if(epoch===this.epoch&&(e.status===403||e.status===404))this.clearViews();throw e;}
    if(record.id!==id||record.orgId!==c.orgId||record.projectId!==c.projectId||record.observation?.projectId!==c.projectId||record.observation?.orgId!==c.orgId||
       record.observation?.readinessEffect!=='none'||record.observation?.artifactVerified!==false||record.observation?.testCoverageVerified!==false||!HASH.test(record.recordSha256||'')||
       !Number.isSafeInteger(record.projectRevision)||!Number.isSafeInteger(record.currentProjectRevision)||record.observation.projectRevision!==record.projectRevision||
       record.matchesCurrentRevision!==(record.projectRevision===record.currentProjectRevision))fail('INVALID_RESPONSE','Saved evidence does not match this project.');
    this.selected=record;return record;
  }
  async capture({buildId,runId,attempt}){
    this.idle();const c=this.context(),p=this.workspace.project;
    if(!p.builds.some(b=>b.id===buildId)||!Number.isSafeInteger(p.revision))fail('INVALID_BUILD','Select a recorded build.');
    for(const value of [runId,attempt])if(typeof value!=='string'||! /^[1-9]\d{0,15}$/.test(value)||!Number.isSafeInteger(Number(value)))fail('INVALID_TARGET','Use numeric run and attempt values.');
    if(Number(attempt)>1000)fail('INVALID_TARGET','Attempt must be at most 1000.');
    this.selected=null;
    this.pending={...c,epoch:this.epoch,key:this.uuid(),body:{expectedRevision:p.revision,buildId,runId,attempt}};
    return this.retry();
  }
  async retry(){
    if(this.writing)fail('CAPTURE_BUSY','One capture is already in progress.');const p=this.pending;if(!p)fail('NO_PENDING_WRITE','There is no capture to retry.');
    this.same(p,p.epoch);this.writing=true;let ack;
    try{
      ack=await this.workspace.request(this.path(p),{method:'POST',key:p.key,body:p.body});this.same(p,p.epoch);
      if(!ID.test(ack.observationId||'')||ack.orgId!==p.orgId||ack.projectId!==p.projectId||ack.projectRevision!==p.body.expectedRevision||ack.requestId!==p.key||!HASH.test(ack.recordSha256||''))fail('UNCONFIRMED_ACK','Capture acknowledgement is invalid. Retry the same request.');
      this.pending=null;
    }catch(e){if(this.pending===p&&e.status>=400&&e.status<500&&e.status!==429)this.pending=null;throw e;}
    finally{this.writing=false;}
    try{await this.history();await this.open(ack.observationId);}catch(e){if(e.code==='STALE_CONTEXT'||e.status===401)throw e;fail('SAVED_REFRESH_FAILED','The observation was saved, but history could not reload. Refresh history; do not capture again.');}
    return ack;
  }
}
