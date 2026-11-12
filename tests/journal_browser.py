"""Offline exact-component test. Synthetic identity/API; not Next/OIDC/PostgreSQL acceptance."""
from pathlib import Path
import argparse, json
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--artifacts', default='/mnt/data/navyix-journal-results')
args = parser.parse_args()
out = Path(args.artifacts); out.mkdir(parents=True, exist_ok=True)
parts=[]
for rel in ['packages/browser-session/src/client.mjs','packages/browser-session/src/journal-client.mjs','apps/web/workbench/journal.mjs']:
    s=(ROOT/rel).read_text()
    s='\n'.join(line for line in s.splitlines() if not line.startswith('import ')).replace('export class ', 'class ')
    if rel.endswith('journal.mjs'):
        s=s.replace('<link rel="stylesheet" href="/workbench/journal.css">','<style>'+(ROOT/'apps/web/workbench/journal.css').read_text()+'</style>')
    parts.append(s)
fixture=r'''
if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=>{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}});
const org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',project='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
window.__lab={posts:[],record:null,failAfterCommit:true,deny:false,revision:2};
const projectData=()=>({id:project,name:'Customer Portal · synthetic test',revision:__lab.revision,environment:'staging',builds:[{id:'BLD-001',label:'Portal 0.4.2',commitSha:'a'.repeat(40),artifactDigest:'sha256:'+'b'.repeat(64),environment:'staging'}]});
window.fetch=async(path,init={})=>{
 if(path.endsWith('/session'))return Response.json({authenticated:true,csrfToken:'synthetic-session',expiresAt:new Date(Date.now()+600000).toISOString()});
 if(path.endsWith('/logout'))return Response.json({signedOut:true});
 if(__lab.deny&&path.includes('github-observations'))return Response.json({error:{message:'Access revoked'}},{status:404});
 if(path.endsWith('github-observations')&&init.method==='POST'){
   const body=JSON.parse(init.body);__lab.posts.push({body,key:init.headers['idempotency-key']});
   if(!__lab.record){const b=projectData().builds[0];__lab.record={id,orgId:org,projectId:project,projectRevision:2,recordedAt:new Date().toISOString(),recordSha256:'a'.repeat(64),observation:{schemaVersion:1,kind:'github-run-observation',orgId:org,projectId:project,projectRevision:2,target:{buildId:b.id,commitSha:b.commitSha,artifactDigest:b.artifactDigest,environment:b.environment},source:{repository:'example/customer-portal',repositoryId:123,id:Number(body.runId),attempt:Number(body.attempt)},summary:'Reported success',jobs:[{name:'unit-tests',conclusion:'success'}],artifactVerified:false,testCoverageVerified:false,readinessEffect:'none'}};}
   if(__lab.failAfterCommit){__lab.failAfterCommit=false;throw Error('Synthetic lost acknowledgement');}
   return Response.json({observationId:id,orgId:org,projectId:project,projectRevision:2,requestId:init.headers['idempotency-key'],recordSha256:'a'.repeat(64)});
 }
 if(path.includes('github-observations?'))return Response.json({orgId:org,projectId:project,next:null,observations:__lab.record?[{...__lab.record,target:__lab.record.observation.target,source:__lab.record.observation.source,summary:__lab.record.observation.summary,readinessEffect:'none'}]:[]});
 if(path.endsWith('/github-observations/'+id))return Response.json({...__lab.record,currentProjectRevision:__lab.revision,matchesCurrentRevision:__lab.revision===2});
 if(path.includes('readiness?'))return Response.json({projectId:project,projectRevision:__lab.revision,stage:new URL(path,'https://test.invalid').searchParams.get('stage'),environment:'staging',buildId:'BLD-001',artifactDigest:'sha256:'+'b'.repeat(64),criteria:[],status:'Insufficient evidence'});
 if(path.includes('/projects?'))return Response.json({projects:[{id:project,name:'Customer Portal · synthetic test'}],next:null});
 return Response.json(projectData());
};
'''
checks=[]
def passed(name): checks.append(name)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1050},reduced_motion='reduce')
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<html><head><title>Navyix synthetic journal component test</title></head><body style="margin:0"><navyix-evidence-history></navyix-evidence-history></body></html>')
    page.add_script_tag(content=fixture+'\n'+'\n'.join(parts))
    host=page.locator('navyix-evidence-history')
    host.get_by_label('Organization ID',exact=True).fill('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    host.get_by_role('button',name='Connect organization',exact=True).click()
    expect(host.get_by_text('No saved observations',exact=True)).to_be_visible();passed('authorized project opens with empty history')
    expect(host.get_by_text('Observation ≠ approval.')).to_be_visible();passed('metadata/proof distinction remains visible')
    host.get_by_label('GitHub run ID',exact=True).fill('724912')
    host.get_by_role('button',name='Review capture').click()
    expect(host.get_by_role('dialog')).to_be_visible();passed('capture requires named confirmation')
    expect(host.get_by_role('button',name='Cancel',exact=True)).to_be_focused();passed('confirmation initially focuses Cancel')
    host.get_by_role('button',name='Cancel',exact=True).click()
    assert page.evaluate('__lab.posts.length')==0;passed('cancel makes no capture request')
    host.get_by_role('button',name='Review capture').click()
    host.get_by_role('button',name='Collect and save').click()
    expect(host.get_by_role('button',name='Retry original capture')).to_be_visible();passed('lost acknowledgement exposes safe retry')
    expect(host.get_by_role('button',name='Connect organization')).to_be_disabled();passed('uncertain save blocks context switching')
    host.get_by_role('button',name='Retry original capture').click()
    expect(host.get_by_role('heading',name='Saved evidence detail')).to_be_visible();passed('retry restores saved record and history')
    assert page.evaluate('__lab.posts.length===2 && __lab.posts[0].key===__lab.posts[1].key && JSON.stringify(__lab.posts[0].body)===JSON.stringify(__lab.posts[1].body)');passed('retry sends identical idempotency identifier and payload')
    assert host.locator('.record').count()==1;passed('no duplicate history item after retry')
    assert host.locator('dd').nth(2).inner_text()=='None';passed('saved record has no readiness effect')
    page.screenshot(path=str(out/'history-desktop.png'),full_page=True)
    for width in [360,390,768,1440]:
        page.set_viewport_size({'width':width,'height':1000})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        passed(f'no horizontal overflow at {width}px')
        if width==390:page.screenshot(path=str(out/'history-mobile.png'),full_page=True)
    page.evaluate('__lab.revision=3')
    host.locator('.record').click()
    expect(host.get_by_text('Historical observation — project has changed since collection')).to_be_visible();passed('saved revision is labeled historical after project changes')
    page.evaluate("__lab.record.observation.source.repository='<img src=x onerror=window.injected=true>'")
    host.get_by_role('button',name='Refresh',exact=True).click()
    expect(host.locator('.record')).to_contain_text('<img src=x');assert host.locator('img').count()==0;passed('untrusted text is rendered literally, not executed')
    page.evaluate('__lab.deny=true')
    host.get_by_role('button',name='Refresh',exact=True).click()
    expect(host.get_by_role('alert')).to_contain_text('Access revoked');assert host.locator('.record').count()==0;passed('denied refresh removes loaded history')
    page.evaluate("const c=new BroadcastChannel('navyix-browser-session');c.postMessage('signed-out');c.close()")
    expect(host.get_by_role('button',name='Sign in securely')).to_be_visible();passed('cross-tab sign-out clears workspace data')
    # Verify login is a real form POST and is not intercepted by journal form handling.
    assert host.locator('form[action="/api/browser/login"]').get_attribute('method')=='post';passed('signed-out view retains the existing sign-in POST form')
    assert not errors,errors;passed('zero uncaught browser errors')
    browser.close()
(out/'browser-results.json').write_text(json.dumps({'mode':'offline synthetic exact-component','passed':len(checks),'checks':checks,'errors':errors},indent=2))
print(json.dumps({'passed':len(checks),'errors':errors}))
