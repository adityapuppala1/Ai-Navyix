"""Offline component test with exact source/CSS and synthetic API; not live auth or GitHub."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--offline', action='store_true', required=True)
parser.add_argument('--artifacts', default='/tmp/navyix-evidence-browser')
parser.add_argument('--browser', default='/usr/bin/chromium')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = Path(args.artifacts); out.mkdir(parents=True, exist_ok=True)
css = (root/'apps/web/workbench/evidence.css').read_text()
sources = []
for path in ['packages/browser-session/src/client.mjs', 'packages/browser-session/src/evidence-client.mjs', 'apps/web/workbench/evidence.mjs']:
    text = (root/path).read_text()
    text = '\n'.join(line for line in text.splitlines() if not line.startswith('import ')).replace('export class ', 'class ')
    if path.endswith('evidence.mjs'):
        text = text.replace('<link rel="stylesheet" href="/workbench/evidence.css">', '<style>'+css+'</style>')
    sources.append(text)
fixture = r'''
window.calls=[];window.mode='success';window.delay=false;window.__channels=[];
window.BroadcastChannel=class {constructor(name){this.name=name;window.__channels.push(this)} close(){} postMessage(){}};
const ORG='11111111-1111-4111-8111-111111111111', P='22222222-2222-4222-8222-222222222222';
const build={id:'BLD-001',label:'Customer portal · candidate 04',commitSha:'a'.repeat(40),artifactDigest:'sha256:'+'b'.repeat(64),environment:'staging'};
window.fetch=async(path,options={})=>{
 window.calls.push({path,method:options.method||'GET',headers:options.headers});
 if(path.endsWith('/session'))return Response.json({authenticated:true,csrfToken:'synthetic',expiresAt:new Date(Date.now()+300000).toISOString()});
 if(path.includes('/github-evidence?')){
  if(window.delay)await new Promise(r=>window.releaseEvidence=r);
  const q=new URL(path,'https://navyix.test').searchParams;
  if(window.mode==='denied')return Response.json({error:{code:'NOT_FOUND',message:'Project access is unavailable.'}},{status:404});
  if(window.mode==='ratelimit')return Response.json({error:{code:'GITHUB_BACKOFF',message:'GitHub rate limit reached. Wait before explicitly retrying.'}},{status:429});
  const skipped=window.mode==='skipped',name=window.mode==='markup'?'<img src=x onerror="window.__xss=true">':'Integration tests';
  return Response.json({schemaVersion:1,kind:'github-run-observation',orgId:ORG,projectId:P,projectRevision:3,target:{...build,buildId:build.id},
   source:{id:+q.get('runId'),attempt:+q.get('attempt'),commitSha:window.mode==='mismatch'?'c'.repeat(40):build.commitSha,repository:'Example/Customer-Portal',repositoryId:10,url:`https://github.com/Example/Customer-Portal/actions/runs/${q.get('runId')}/attempts/${q.get('attempt')}`},
   collectedAt:new Date().toISOString(),summary:skipped?'Insufficient evidence':'Reported success',contentSha256:'c'.repeat(64),artifactVerified:false,testCoverageVerified:false,readinessEffect:'none',
   criteria:[{name:'Application build',state:'Reported success',reason:'GitHub reports successful job completion; artifact identity remains unverified.'},{name,state:skipped?'Skipped':'Reported success',reason:skipped?'Skipped is not an observed successful execution.':'Job status is metadata, not proof of test-case coverage.'}],jobs:[],
   limitations:['Job metadata only; no test reports, source code, logs or artifact bytes were downloaded.','The recorded artifact digest and environment are local context, not attested by this workflow metadata.','This is a point-in-time API observation, not a release approval, signed attestation or durable audit record.']});
 }
 if(path.includes('/readiness?')){const q=new URL(path,'https://navyix.test').searchParams;return Response.json({projectId:P,projectRevision:3,stage:q.get('stage'),environment:'staging',buildId:'BLD-001',artifactDigest:build.artifactDigest,status:'Insufficient evidence',criteria:[]});}
 if(path.includes('limit='))return Response.json({projects:[{id:P,name:'Customer Portal'}],next:null});
 return Response.json({id:P,name:'Customer Portal',revision:3,environment:'staging',builds:[build]});
};
'''
checks=[]
def check(name, value):
    assert value, name
    checks.append(name)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=args.browser,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1100},reduced_motion='reduce')
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body><navyix-evidence-workbench></navyix-evidence-workbench></body></html>')
    page.add_script_tag(content=fixture+'\n'+'\n'.join(sources),type='module')
    page.get_by_role('button',name='Connect organization').wait_for()
    page.get_by_label('Organization ID',exact=True).fill('11111111-1111-4111-8111-111111111111')
    page.get_by_role('button',name='Connect organization').click()
    page.get_by_label('Run ID',exact=True).wait_for()
    check('authorized project and recorded build loaded',page.get_by_label('Recorded build',exact=True).input_value()=='BLD-001')
    page.get_by_label('Run ID',exact=True).fill('825')
    page.get_by_label('Attempt',exact=True).fill('2')
    def inspect():
        page.get_by_role('button',name='Inspect GitHub evidence',exact=True).click()
        page.get_by_role('button',name='Inspect GitHub evidence',exact=True).wait_for()
    inspect()
    check('successful metadata is shown as reported success',page.get_by_role('heading',name='Reported success',exact=True).count()==1)
    check('limits remain visible',page.get_by_text('What this evidence does not prove',exact=True).count()==1)
    check('readiness is unchanged',page.get_by_text('Advisory · no readiness change',exact=True).count()==1)
    check('source link is exact run and attempt',page.get_by_role('link',name='View selected run').get_attribute('href').endswith('/825/attempts/2'))
    check('export is explicitly unsigned',page.get_by_text('Exported JSON is unsigned and editable.',exact=False).count()==1)
    page.screenshot(path=str(out/'evidence-desktop.png'),full_page=True)
    for width in [360,390,768,1440]:
        page.set_viewport_size({'width':width,'height':1050})
        check(f'no page overflow at {width}px',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
        if width==390:page.screenshot(path=str(out/'evidence-mobile.png'),full_page=True)
    page.set_viewport_size({'width':1440,'height':1100})
    page.get_by_label('Attempt',exact=True).fill('3')
    check('editing target immediately clears old observation',page.get_by_role('heading',name='Reported success',exact=True).count()==0)
    page.evaluate("window.mode='skipped'");inspect()
    check('skipped required job cannot report success',page.get_by_role('heading',name='Insufficient evidence',exact=True).count()==1)
    check('skipped status stays distinct',page.get_by_text('Skipped',exact=True).count()==1)
    page.evaluate("window.mode='mismatch'");inspect()
    check('mismatched build response is rejected',page.get_by_role('alert').inner_text().startswith('Evidence did not match'))
    check('mismatch does not leave a stale report',page.get_by_role('button',name='Export observation JSON').count()==0)
    page.evaluate("window.mode='markup'");inspect()
    check('provider markup is escaped',page.evaluate("!window.__xss && document.querySelector('navyix-evidence-workbench').shadowRoot.querySelectorAll('.jobs img').length===0"))
    page.evaluate("window.mode='ratelimit'");inspect()
    check('rate limits are explained', 'rate limit' in page.get_by_role('alert').inner_text())
    before=page.evaluate('calls.length');page.wait_for_timeout(200)
    check('no automatic retry or polling',page.evaluate('calls.length')==before)
    page.evaluate("window.mode='denied'");inspect()
    check('access denied clears observation',page.get_by_role('button',name='Export observation JSON').count()==0)
    page.evaluate("window.mode='success';window.delay=true");page.get_by_role('button',name='Inspect GitHub evidence',exact=True).click()
    page.wait_for_function('typeof window.releaseEvidence==="function"')
    page.evaluate("window.__channels.find(c=>c.name==='navyix-browser-session').onmessage({data:'signed-out'})")
    page.evaluate('releaseEvidence()')
    page.get_by_role('heading',name='Sign in to inspect project evidence.').wait_for()
    check('late response after cross-tab sign-out is discarded',page.get_by_role('button',name='Export observation JSON').count()==0)
    check('all synthetic transport requests are GET',page.evaluate("calls.every(c=>c.method==='GET')"))
    check('browser never receives an authorization header',page.evaluate("calls.every(c=>!c.headers?.authorization)"))
    check('no uncaught JavaScript errors',not errors)
    result={'mode':'offline-exact-component-synthetic-api','passed':len(checks),'checks':checks,'javascriptErrors':errors,'limitations':['Not live GitHub, real cookie authentication, PostgreSQL, Next.js, or cross-browser validation.']}
    (out/'browser.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
    browser.close()
