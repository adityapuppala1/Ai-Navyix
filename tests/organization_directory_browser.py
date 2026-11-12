"""Offline component checks only: synthetic memberships, no Next/OIDC/PostgreSQL."""
from pathlib import Path
import argparse, json, re, shutil
from playwright.sync_api import sync_playwright

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true', required=True)
    parser.add_argument('--artifacts', default='test-results/organization-directory')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    out = Path(args.artifacts); out.mkdir(parents=True, exist_ok=True)
    client = (root/'packages/browser-session/src/organization-client.mjs').read_text().replace('export class ', 'class ')
    component = (root/'apps/web/workbench/organization-picker.mjs').read_text()
    component = '\n'.join(line for line in component.splitlines() if not line.startswith('import '))
    checks = []; errors = []
    def check(label, value):
        assert value, label
        checks.append(label)
    with sync_playwright() as p:
        executable = shutil.which('chromium') or shutil.which('chromium-browser')
        browser = p.chromium.launch(headless=True, **({'executable_path':executable} if executable else {}))
        page = browser.new_page(viewport={'width':1440,'height':1000}, reduced_motion='reduce')
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content('''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="margin:0;background:#071323;color:#e6f0fc;font:16px system-ui,sans-serif">
        <main style="box-sizing:border-box;width:min(100%,760px);margin:0 auto;padding:36px 24px">
        <div style="font-size:23px;font-weight:800;letter-spacing:.13em;color:#6be2d2">NAVYIX</div>
        <p style="color:#879bb4;font-size:12px;letter-spacing:.1em">DESIGN / BUILD / TEST / READINESS</p>
        <h1 style="font-size:clamp(28px,5vw,44px);letter-spacing:-.04em;line-height:1.15;margin:28px 0 10px">Your work.<br>Your organizations.</h1>
        <p style="color:#a8bbd0;line-height:1.6">Continue to a workspace you are authorized to use.</p>
        <navyix-organization-picker></navyix-organization-picker>
        <p style="font-size:12px;color:#8092aa;margin-top:28px">Component test • synthetic memberships • not a live customer workspace</p>
        </main></body></html>''')
        page.add_script_tag(content=client+'\n'+component)
        page.evaluate('''() => {
          window.id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
          window.rows=[{id:id(1),name:'Navyix Engineering',role:'OWNER'},{id:id(2),name:'Orbit Quality Lab',role:'REVIEWER'}];
          window.value={organizations:rows,next:null}; window.calls=[]; window.selected=[];
          window.workspace={authenticated:true,generation:1,pending:null,request:async path=>{calls.push(path);return value;}};
          window.picker=document.querySelector('navyix-organization-picker');
          picker.addEventListener('navyix-organization-selected',e=>{e.preventDefault();selected.push(e.detail.orgId);});picker.configure(workspace);
        }''')
        page.get_by_role('button',name='Navyix Engineering OWNER').wait_for()
        check('renders two authorized synthetic organizations', page.locator('navyix-organization-picker button.choose').count()==2)
        check('does not require manual organization UUID', page.locator('input[name="orgId"]').count()==0)
        check('states selection is not a permission grant', page.get_by_text('Selecting an organization does not change membership or project permissions.').is_visible())
        page.screenshot(path=str(out/'organization-directory-desktop.png'),full_page=True)
        for width in [360,390,768,1440]:
            page.set_viewport_size({'width':width,'height':1000})
            check('no page overflow at '+str(width), page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
            if width==390: page.screenshot(path=str(out/'organization-directory-mobile.png'),full_page=True)
        page.get_by_role('button',name='Orbit Quality Lab REVIEWER').focus()
        page.keyboard.press('Enter')
        check('keyboard selection emits only organization ID',page.evaluate('selected.length===1 && selected[0]===id(2)'))
        check('selection prevents repeated clicks while connecting',page.locator('button.choose:disabled').count()==2)
        page.evaluate('''()=>{value={organizations:Array.from({length:20},(_,i)=>({id:id(i+1),name:'Workspace '+(i+1),role:'VIEWER'})),next:id(20)};picker.configure(workspace);}''')
        page.get_by_role('button',name='Next page →').wait_for()
        page.evaluate('value={organizations:[{id:id(21),name:"Last workspace",role:"VIEWER"}],next:null}')
        page.get_by_role('button',name='Next page →').click()
        page.get_by_role('button',name='Last workspace VIEWER').wait_for()
        check('pagination forwards only returned cursor',page.evaluate('calls.at(-1).endsWith("after="+id(20))'))
        page.evaluate('() => { workspace.request=async()=>{throw Object.assign(new Error("Access unavailable"),{status:404});}; }')
        page.get_by_role('button',name='Refresh organizations').click()
        page.get_by_role('alert').wait_for()
        check('denied refresh clears prior organizations',page.locator('button.choose').count()==0)
        page.evaluate('''()=>{workspace.request=async()=>({organizations:[],next:null});picker.configure(workspace);}''')
        page.get_by_text('No active organization membership').wait_for()
        check('empty membership state does not invent access',page.locator('button.choose').count()==0)
        page.evaluate('''()=>{workspace.request=async()=>({organizations:[{id:id(1),name:'<img src=x onerror="window.injected=true">',role:'VIEWER'}],next:null});picker.configure(workspace);}''')
        page.get_by_role('button',name=re.compile('<img')).wait_for()
        check('untrusted organization name is escaped',page.locator('navyix-organization-picker img').count()==0 and not page.evaluate('Boolean(window.injected)'))
        page.evaluate('''()=>{workspace.request=()=>new Promise(r=>window.resolveOld=r);picker.configure(workspace);}''')
        page.get_by_role('status').wait_for()
        page.evaluate('''()=>{workspace.generation++;workspace.authenticated=false;resolveOld({organizations:rows,next:null});}''')
        page.wait_for_timeout(50)
        check('late session response does not reveal old names',page.locator('button.choose').count()==0)
        page.evaluate('''()=>{workspace.authenticated=true;workspace.request=()=>new Promise(r=>window.resolveOld=r);picker.configure(workspace);workspace.request=async()=>({organizations:[{id:id(3),name:'Current workspace',role:'VIEWER'}],next:null});picker.configure(workspace);resolveOld({organizations:rows,next:null});}''')
        page.get_by_role('button',name='Current workspace VIEWER').wait_for()
        check('reconfiguration suppresses older response',page.locator('button.choose').count()==1)
        check('no uncaught browser errors',not errors)
        browser.close()
    report={'mode':'offline-component-with-synthetic-transport','passed':len(checks),'checks':checks,'errors':errors,'notValidated':['Next.js','real browser cookies/login','PostgreSQL RLS','complete connected workspace']}
    (out/'results.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__':main()
