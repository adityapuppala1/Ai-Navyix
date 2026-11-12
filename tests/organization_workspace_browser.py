"""Offline connected-shell integration: real client/picker/connected code, synthetic API.
The unchanged local-workbench superclass is a presentation stub. This does NOT test
Next.js, a real IdP, PostgreSQL, cookies or the complete Design/Build/Test screens.
"""
from pathlib import Path
import argparse,json,shutil
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
def source(name):
    s=(ROOT/name).read_text()
    s='\n'.join(x for x in s.splitlines() if not x.startswith('import '))
    return s.replace('export class ','class ').replace("import.meta.url", "'https://offline.test/workbench/connected.mjs'")

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--artifacts',default='test-results/organization-workspace');args=parser.parse_args()
    out=Path(args.artifacts);out.mkdir(parents=True,exist_ok=True);checks=[];errors=[]
    def check(name,condition):
        assert condition,name
        checks.append(name)
    with sync_playwright() as p:
        executable=shutil.which('chromium') or shutil.which('chromium-browser')
        browser=p.chromium.launch(headless=True,**({'executable_path':executable} if executable else {}))
        page=browser.new_page(viewport={'width':1280,'height':900},reduced_motion='reduce');page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_default_timeout(5000)
        page.set_content('<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body></body></html>')
        page.add_script_tag(content='''
          window.id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
          window.calls=[];window.mode='normal';window.releaseOld=null;
          window.fetch=async(path,init)=>{
            calls.push({path,method:init?.method||'GET'});
            if(path.endsWith('/session'))return Response.json({authenticated:true,csrfToken:'synthetic-csrf',expiresAt:new Date(Date.now()+600000).toISOString()});
            if(path.endsWith('/logout'))return Response.json({signedOut:true});
            if(path.includes('/me/organizations'))return Response.json({organizations:[{id:id(1),name:'North Engineering',role:'OWNER'},{id:id(2),name:'South QA',role:'REVIEWER'}],next:null});
            if(mode==='defer' && path.includes('/projects?'))return new Promise(r=>releaseOld=()=>r(Response.json({projects:[{id:id(11),name:'Stale project'}],next:null})));
            if(mode==='denied')return Response.json({error:{code:'NOT_FOUND',message:'Access removed'}},{status:404});
            const org=path.includes('/orgs/'+id(1)+'/')?1:2,project=id(10+org);
            if(path.includes('/projects?'))return Response.json({projects:[{id:project,name:org===1?'North portal':'South suite'}],next:null});
            if(path.includes('/readiness?'))return Response.json({projectId:project,projectRevision:1,status:'Insufficient evidence',stage:new URL(path,'https://offline.test').searchParams.get('stage'),environment:'staging',buildId:null,artifactDigest:null,criteria:[]});
            return Response.json({id:project,revision:1,environment:'staging',builds:[],requirements:[],testCases:[]});
          };
          class WorkbenchPresentationStub extends HTMLElement {
            constructor(){super();this.attachShadow({mode:'open'});this.root=document.createElement('div');this.shadowRoot.append(this.root);this.theme='dark';this.stage='release';this.error='';}
            connectedCallback(){if(this.started)return;this.started=true;this.click=e=>{void this.onClick(e)};this.root.addEventListener('click',this.click);void this.load();}
            disconnectedCallback(){this.started=false;this.root.removeEventListener('click',this.click);}
            render(){this.root.innerHTML='<div class="local-card"></div><div class="top-actions"></div><p id="active-project">'+this.projectId+'</p><div id="alerts"></div>';}
            renderAlert(){}
            async onClick(e){if(e.target.dataset.action==='reload')await this.load();}
          }
          customElements.define('navyix-workbench',WorkbenchPresentationStub);
        ''')
        page.add_script_tag(content='(()=>{'+source('packages/browser-session/src/client.mjs')+';window.BrowserWorkspace=BrowserWorkspace;})();')
        page.add_script_tag(content='(()=>{'+source('packages/browser-session/src/organization-client.mjs')+';window.OrganizationDirectory=OrganizationDirectory;})();')
        page.add_script_tag(content='(()=>{'+source('apps/web/workbench/organization-picker.mjs')+'})();')
        page.add_script_tag(content='(()=>{'+source('apps/web/workbench/connected.mjs')+'})();')
        page.evaluate("()=>{window.work=document.createElement('navyix-connected-workbench');work.setAttribute('organization-picker','');document.body.append(work);}")
        page.get_by_role('button',name='North Engineering OWNER').wait_for()
        check('connected shell displays directory after its session is loaded',page.locator('navyix-organization-picker').count()==1)
        check('named selection replaces the manual UUID input only when enabled',page.locator('input[name="orgId"]').count()==0)
        page.get_by_role('button',name='North Engineering OWNER').click()
        page.wait_for_function("work.phase==='ready'")
        check('actual workspace client opens the selected organization',page.evaluate('work.api.orgId===id(1) && work.api.project.id===id(11)'))
        check('all four server readiness stages load after selection',page.evaluate('Object.keys(work.api.readiness).length===4'))
        check('workspace displays the selected organization name',page.locator('.local-card').inner_text()=='Organization · North Engineering')
        check('selection does not submit a membership mutation',page.evaluate("calls.every(c=>c.method==='GET')"))
        page.get_by_role('button',name='Switch organization',exact=True).click()
        page.get_by_role('button',name='South QA REVIEWER').wait_for();page.get_by_role('button',name='South QA REVIEWER').click()
        page.wait_for_function("work.phase==='ready' && work.api.orgId===id(2)")
        check('switching replaces the loaded project and readiness context',page.evaluate('work.api.project.id===id(12) && Object.values(work.api.readiness).every(x=>x.projectId===id(12))'))
        check('old organization name is no longer displayed',page.locator('.local-card').inner_text()=='Organization · South QA')
        page.get_by_role('button',name='Switch organization',exact=True).click();page.get_by_role('button',name='North Engineering OWNER').wait_for()
        page.evaluate("mode='denied'");page.get_by_role('button',name='North Engineering OWNER').click();page.wait_for_function("work.phase==='error'")
        check('revocation after listing prevents opening the project',page.evaluate('work.api.project===null && work.api.projects.length===0'))
        check('denied selection gives a usable way back to organization choices',page.get_by_role('button',name='Switch organization',exact=True).is_visible())
        page.evaluate("mode='normal'");page.get_by_role('button',name='Switch organization',exact=True).click();page.get_by_role('button',name='North Engineering OWNER').wait_for()
        before=page.evaluate('calls.length')
        page.evaluate("()=>{work.api.pending={};document.querySelector('navyix-connected-workbench').shadowRoot.querySelector('navyix-organization-picker').dispatchEvent(new CustomEvent('navyix-organization-selected',{detail:{orgId:id(1)},bubbles:true,composed:true,cancelable:true}));}")
        check('unconfirmed saves block organization changes',page.evaluate('calls.length')==before)
        page.evaluate('work.api.pending=null')
        page.evaluate("mode='defer'");page.get_by_role('button',name='North Engineering OWNER').click();page.wait_for_function('releaseOld!==null')
        page.evaluate("work.channel.onmessage({data:'signed-out'})");page.get_by_role('button',name='Sign in with your organization →').wait_for();page.evaluate('releaseOld()');page.wait_for_timeout(30)
        check('late project response cannot restore a signed-out workspace',page.evaluate("work.phase==='signedout' && !work.api.authenticated && work.api.project===null"))
        page.evaluate("()=>{mode='normal';work.remove();work=document.createElement('navyix-connected-workbench');document.body.append(work);}")
        page.locator('input[name="orgId"]').wait_for()
        check('feature-off path retains the prior manual organization flow',page.locator('navyix-organization-picker').count()==0)
        page.evaluate("()=>{work.remove();window.alone=document.createElement('navyix-organization-picker');document.body.append(alone);alone.configure({authenticated:true,generation:1,pending:null,request:async()=>({organizations:[{id:id(1),name:'No listener',role:'VIEWER'}],next:null})});}")
        page.get_by_role('button',name='No listener VIEWER').click()
        check('unhandled selection does not leave the picker disabled',page.get_by_role('button',name='No listener VIEWER').is_enabled())
        check('unhandled selection reports a recoverable error',page.get_by_role('alert').is_visible())
        check('no uncaught browser exceptions',not errors)
        browser.close()
    report={'scope':'offline-connected-shell; real connected component, picker, client; synthetic API and presentation superclass','passed':len(checks),'checks':checks,'errors':errors,'notValidated':['full Next/Nest build','real identity/cookies','PostgreSQL','complete Design/Build/Test screens']}
    (out/'results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
