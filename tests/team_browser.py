"""Project-team UI acceptance using served canonical assets and synthetic API responses.
Not live OIDC, PostgreSQL, Next.js, production security, or cross-browser validation.
Requires Python Playwright and an installed Chromium. Does not dispatch CI or deploy.
"""
from __future__ import annotations
import argparse
import json
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone, timedelta
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ORG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
PROJECT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
ACTOR='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
USER='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
paths = {
 '/workbench/client.mjs': ROOT/'packages/browser-session/src/client.mjs',
 '/workbench/team-client.mjs': ROOT/'packages/browser-session/src/team-client.mjs',
 '/workbench/team.mjs': ROOT/'apps/web/workbench/team.mjs',
 '/workbench/team.css': ROOT/'apps/web/workbench/team.css',
}
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  if self.path == '/':
   content=b'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Navyix team UI test fixtures</title><style>body{margin:0}</style><navyix-project-team></navyix-project-team><script type="module" src="/workbench/team.mjs"></script></html>'
   mime='text/html'
  elif self.path in paths:
   content=paths[self.path].read_bytes();mime='text/css' if self.path.endswith('.css') else 'text/javascript'
  else:
   self.send_error(404);return
  self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(content)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(content)
 def log_message(self,*args):pass

def run(browser_path: str, artifacts: Path, offline: bool = False):
 artifacts.mkdir(parents=True,exist_ok=True)
 checks=[]; errors=[]; calls=[]; receipts={}; writes=[]
 mode={'lose':False,'denied':False}
 members=[
  dict(userId=ACTOR,email='project.owner@example.test',organizationRole='OWNER',organizationActive=True,role='OWNER',active=True,accessRevision=1,editable=False,allowedRoles=['ADMIN','CONTRIBUTOR','REVIEWER','VIEWER']),
  dict(userId=USER,email='engineering.contributor@example.test',organizationRole='CONTRIBUTOR',organizationActive=True,role=None,active=False,accessRevision=0,editable=True,allowedRoles=['CONTRIBUTOR','VIEWER']),
  dict(userId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',email='quality.reviewer@example.test',organizationRole='REVIEWER',organizationActive=True,role='REVIEWER',active=True,accessRevision=1,editable=True,allowedRoles=['REVIEWER','VIEWER'])
 ]
 def check(name,value=True):
  assert value,name
  checks.append(name)
 def respond(url,init):
  status=200
  body=json.loads(init.get('body') or '{}');headers=init.get('headers') or {}
  if url.endswith('/session'):
   result=dict(authenticated=True,csrfToken='fixture-csrf',expiresAt=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat())
  elif '/projects?' in url:
   result=dict(projects=[dict(id=PROJECT,name='Delivery readiness')],next=None)
  elif url.endswith('/team/commands'):
   key=headers.get('idempotency-key');calls.append((key,body))
   if mode['denied']:
    status=404;result=dict(error=dict(code='NOT_FOUND',message='Project access management is unavailable for this account.'))
   elif key in receipts:
    old_body,result=receipts[key];check('retry retains identical access payload',old_body==body)
   else:
    member=next(m for m in members if m['userId']==body['userId'])
    check('write checks expected membership revision',body['expectedRevision']==member['accessRevision'])
    check('write carries CSRF token',headers.get('x-navyix-csrf')=='fixture-csrf')
    member.update(role=body['role'],active=body['active'],accessRevision=member['accessRevision']+1)
    result=dict(orgId=ORG,projectId=PROJECT,userId=member['userId'],role=member['role'],active=member['active'],accessRevision=member['accessRevision'],requestId=key)
    receipts[key]=(body,result);writes.append(result)
    if mode['lose']:
     mode['lose']=False;return {'networkError':True}
  elif '/team?' in url:
   if mode['denied']:status=404;result=dict(error=dict(code='NOT_FOUND',message='No current project administration access.'))
   else:result=dict(orgId=ORG,projectId=PROJECT,actorId=ACTOR,members=members,next=None)
  elif url.endswith('/logout'):result=dict(signedOut=True)
  else:raise AssertionError('Unexpected API request: '+url)
  return dict(status=status,value=result)
 def api(route):
  r=respond(route.request.url,dict(body=route.request.post_data,headers=route.request.headers))
  if r.get('networkError'):route.abort();return
  route.fulfill(status=r['status'],content_type='application/json',body=json.dumps(r['value']),headers={'cache-control':'no-store'})
 server=None;thread=None
 if not offline:
  server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path=browser_path,headless=True,args=['--no-sandbox'])
   context=browser.new_context(viewport=dict(width=1440,height=1000),reduced_motion='reduce')
   page=context.new_page();page.on('pageerror',lambda err:errors.append(str(err)));page.route('**/api/browser/**',api)
   if offline:
    page.expose_function('team_test_api',respond)
    page.set_content('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Navyix team — synthetic test records</title><style>body{margin:0}</style><navyix-project-team></navyix-project-team></html>')
    page.evaluate("""() => {
      window.fetch=async(path,init={})=>{const r=await window.team_test_api(String(path),init);if(r.networkError)throw new Error('Synthetic response loss');return new Response(JSON.stringify(r.value),{status:r.status,headers:{'content-type':'application/json'}});};
      window.BroadcastChannel=class {static channels=[];constructor(name){this.name=name;this.listeners=[];BroadcastChannel.channels.push(this);}addEventListener(type,fn){if(type==='message')this.listeners.push(fn);}postMessage(data){for(const c of BroadcastChannel.channels)if(c!==this&&c.name===this.name)queueMicrotask(()=>c.listeners.forEach(fn=>fn({data})));}close(){BroadcastChannel.channels=BroadcastChannel.channels.filter(c=>c!==this);}};
      crypto.randomUUID ||= () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
    }""")
    sources=[]
    for path in [paths['/workbench/client.mjs'],paths['/workbench/team-client.mjs'],paths['/workbench/team.mjs']]:
      code=path.read_text();code='\n'.join(line for line in code.splitlines() if not line.startswith('import '));code=code.replace('export class ','class ')
      if path.name=='client.mjs':code+='\nwindow.BrowserWorkspace=BrowserWorkspace;window.WorkspaceError=WorkspaceError;'
      if path.name=='team-client.mjs':code+='\nwindow.ProjectTeamClient=ProjectTeamClient;'
      code=code.replace('<link rel="stylesheet" href="/workbench/team.css">','<style>'+paths['/workbench/team.css'].read_text()+'</style>')
      sources.append('(function(){'+code+'})();')
    for source in sources:page.add_script_tag(content=source)
   else:
    page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='networkidle')
   page.get_by_label('Organization ID',exact=True).fill(ORG)
   page.get_by_role('button',name='Connect',exact=True).click()
   page.get_by_role('button',name='Open team',exact=True).click()
   page.get_by_text('engineering.contributor@example.test',exact=True).wait_for()
   check('organization and project directory loaded')
   check('owner self-management is not offered',page.get_by_text('Your access · protected',exact=True).count()==1)
   form=page.locator(f'form[data-user="{USER}"]')
   check('project role choices cannot exceed organization role',form.locator('select option').all_text_contents()==['CONTRIBUTOR','VIEWER'])
   form.get_by_role('button',name='Grant access').click()
   page.get_by_role('dialog').wait_for();check('confirmation identifies target member and project','Delivery readiness' in page.get_by_role('dialog').inner_text())
   check('confirmation starts on cancel action',page.evaluate('document.querySelector("navyix-project-team").shadowRoot.activeElement.dataset.action')=='cancel')
   page.keyboard.press('Escape');check('escape cancels without a write',len(writes)==0)
   form.get_by_role('button',name='Grant access').click();page.get_by_role('button',name='Confirm change',exact=True).click()
   page.get_by_text('Project access updated and recorded.',exact=True).wait_for();check('grant persists through directory refresh',members[1]['active'])
   page.screenshot(path=str(artifacts/'team-desktop.png'),full_page=True)
   for width in [1440,768,390,360]:
    page.set_viewport_size(dict(width=width,height=1000))
    check(f'no page-level horizontal overflow at {width}px',page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
   page.screenshot(path=str(artifacts/'team-mobile.png'),full_page=True)
   page.set_viewport_size(dict(width=1440,height=1000))
   mode['lose']=True;form.locator('select').select_option('VIEWER');form.get_by_role('button',name='Change role').click();page.get_by_role('button',name='Confirm change',exact=True).click()
   page.get_by_role('button',name='Retry same request').wait_for();check('uncertain result keeps change controls disabled',form.get_by_role('button',name='Change role').is_disabled())
   check('organization switching blocked during pending save',page.get_by_role('button',name='Connect',exact=True).is_disabled())
   before=len(writes);first=calls[-1];page.get_by_role('button',name='Retry same request').click();page.get_by_text('Project access updated and recorded.',exact=True).wait_for()
   check('retry does not duplicate persisted access change',len(writes)==before);check('retry reuses original idempotency key',calls[-1][0]==first[0])
   form.get_by_role('button',name='Revoke',exact=True).click();page.get_by_role('button',name='Confirm change',exact=True).click()
   page.get_by_text('access revoked',exact=True).wait_for();check('revoke leaves organization membership intact',not members[1]['active'] and members[1]['organizationActive'])
   mode['denied']=True;page.get_by_role('button',name='Refresh',exact=True).click();page.get_by_text('No current project administration access.',exact=True).wait_for()
   check('permission revocation clears displayed member data',page.get_by_text('engineering.contributor@example.test',exact=True).count()==0)
   mode['denied']=False;page.get_by_role('button',name='Refresh',exact=True).click();page.get_by_text('engineering.contributor@example.test',exact=True).wait_for()
   page.evaluate("window.testChannel=new BroadcastChannel('navyix-browser-session');window.testChannel.postMessage('signed-out')")
   page.get_by_role('heading',name='Sign in to manage project access').wait_for()
   check('workspace-compatible cross-tab sign-out clears members',page.get_by_text('engineering.contributor@example.test',exact=True).count()==0)
   check('no uncaught browser errors',not errors)
   context.close();browser.close()
 finally:
  if server:
   server.shutdown();server.server_close();thread.join(timeout=5)
 report=dict(mode='offline-component-with-synthetic-API-and-broadcast' if offline else 'local-HTTP-component-with-synthetic-API',checks=checks,count=len(checks),errors=errors,limitations=['No Next.js framework build','Synthetic API and identity; no live PostgreSQL','Chromium only; no full accessibility audit'])
 (artifacts/'results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--offline',action='store_true');parser.add_argument('--browser',default='/usr/bin/chromium');parser.add_argument('--artifacts',type=Path,default=ROOT/'test-results/team');args=parser.parse_args();run(args.browser,args.artifacts,args.offline)
