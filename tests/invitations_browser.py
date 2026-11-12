"""Offline exact-component checks with synthetic API/session data. No live invitations sent."""
from pathlib import Path
import argparse,json,shutil
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def source(path):
    return '\n'.join(line for line in (ROOT/path).read_text().splitlines() if not line.startswith('import ')).replace('export class ','class ')
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--artifacts',default='test-results/invitations');args=parser.parse_args()
    out=Path(args.artifacts);out.mkdir(parents=True,exist_ok=True);checks=[];errors=[]
    def check(label,value):
        assert value,label
        checks.append(label)
    with sync_playwright() as p:
        exe=shutil.which('chromium') or shutil.which('chromium-browser')
        browser=p.chromium.launch(headless=True,**({'executable_path':exe} if exe else {}))
        page=browser.new_page(viewport={'width':1440,'height':1100},reduced_motion='reduce')
        page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(5000)
        page.set_content('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#071320"><div style="color:#b0bdcd;padding:8px 24px;font:12px system-ui">Component test · synthetic identities and invitations · no email sent</div></body></html>')
        page.add_script_tag(content='''
        window.id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');window.counter=100;
        crypto.randomUUID=()=>id(counter++);
        window.calls=[];window.receipts=new Map();window.rows=[];window.mode='normal';window.lose=true;
        window.code='nvi1.'+'A'.repeat(43);window.org=id(1);window.inv=id(2);
        window.fetch=async(path,init={})=>{
          calls.push({path,method:init.method||'GET',body:init.body,key:init.headers?.['idempotency-key']});
          if(path.endsWith('/session'))return Response.json({authenticated:true,csrfToken:'synthetic-csrf',expiresAt:new Date(Date.now()+3600000).toISOString()});
          if(path.endsWith('/logout'))return Response.json({signedOut:true});
          if(path.includes('/me/organizations'))return Response.json({organizations:[{id:org,name:'Navyix Engineering',role:'OWNER'}],next:null});
          if(mode==='denied')return Response.json({error:{code:'FORBIDDEN',message:'Access unavailable'}},{status:403});
          const key=init.headers?.['idempotency-key'];
          if(path.endsWith('/preview'))return Response.json({orgId:org,organizationName:'Navyix Engineering',role:'REVIEWER',expiresAt:new Date(Date.now()+86400000).toISOString(),alreadyMember:false});
          if(path.endsWith('/accept'))return Response.json({orgId:org,organizationName:'Navyix Engineering',role:'REVIEWER',alreadyMember:false,requestId:key});
          if(path.endsWith('/revoke')){rows[0].status='revoked';return Response.json({orgId:org,invitationId:inv,status:'revoked',requestId:key});}
          if(init.method==='POST'){
            if(receipts.has(key))return Response.json(receipts.get(key));
            const input=JSON.parse(init.body),result={orgId:org,invitationId:inv,email:input.email,role:input.role,status:'pending',expiresAt:new Date(Date.now()+86400000).toISOString(),code,requestId:key};
            receipts.set(key,result);rows=[{id:inv,email:input.email,role:input.role,status:'pending',createdAt:new Date().toISOString(),expiresAt:result.expiresAt}];
            if(lose){lose=false;throw new Error('Simulated lost response after commit');}return Response.json(result);
          }
          return Response.json({orgId:org,invitations:rows,next:null});
        };
        ''')
        page.add_script_tag(content='(()=>{'+source('packages/browser-session/src/client.mjs')+';window.BrowserWorkspace=BrowserWorkspace;})();')
        page.add_script_tag(content='(()=>{'+source('packages/browser-session/src/invitation-client.mjs')+';window.InvitationClient=InvitationClient;})();')
        ui=source('apps/web/workbench/invitations.mjs')
        ui=ui.replace('<link rel="stylesheet" href="/workbench/invitations.css">','<style>'+ (ROOT/'apps/web/workbench/invitations.css').read_text()+'</style>')
        page.add_script_tag(content='(()=>{'+ui+'})();')
        page.evaluate("()=>{window.app=document.createElement('navyix-invitations');document.body.append(app);}")
        page.get_by_label('Organization',exact=True).select_option(page.evaluate('org'))
        page.get_by_label('Recipient email').wait_for()
        check('only non-admin invitation roles appear',page.locator('#role option').evaluate_all('(rows)=>rows.map(x=>x.value)').count('OWNER')==0)
        check('the identity-verification and separate-project-access boundary is visible',page.get_by_text('Membership is not project access.',exact=True).is_visible())
        page.get_by_label('Recipient email').fill('collaborator@example.test')
        page.get_by_label('Organization role').select_option('REVIEWER')
        page.get_by_role('button',name='Create invitation →').click()
        page.get_by_role('button',name='Retry original request').wait_for()
        check('lost creation response retains one pending operation',page.evaluate('Boolean(app.client.pending) && receipts.size===1'))
        first=page.evaluate("calls.filter(x=>x.method==='POST').at(-1)")
        page.get_by_role('button',name='Retry original request').click()
        page.get_by_label('Share this code privately').wait_for()
        retried=page.evaluate("calls.filter(x=>x.method==='POST').at(-1)")
        check('retry keeps the original identifier and body',first['key']==retried['key'] and first['body']==retried['body'])
        check('one saved invitation is shown after lost-response recovery',page.locator('.records article').count()==1 and page.evaluate('receipts.size')==1)
        page.get_by_role('button',name='Hide code').click()
        check('hiding the issued code removes it from the DOM',page.locator('#issued-code').count()==0)
        page.screenshot(path=str(out/'invitations-desktop.png'),full_page=True)
        for width in [360,390,768,1440]:
            page.set_viewport_size({'width':width,'height':1000})
            check('no page overflow at '+str(width),page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            if width==390:page.screenshot(path=str(out/'invitations-mobile.png'),full_page=True)
        page.get_by_role('button',name='Revoke',exact=True).click()
        page.get_by_role('dialog').wait_for()
        check('revoke confirmation focuses Cancel',page.evaluate("app.shadowRoot.activeElement?.value==='cancel'"))
        page.get_by_role('button',name='Cancel',exact=True).click()
        check('cancelling revocation does not change the row',page.evaluate("rows[0].status==='pending'"))
        page.get_by_role('button',name='Revoke',exact=True).click()
        page.get_by_role('button',name='Revoke invitation',exact=True).click()
        page.wait_for_function("!app.busy && rows[0].status==='revoked'")
        check('confirmed revocation is shown without changing membership',page.locator('.records .badge').inner_text().lower()=='revoked')
        page.get_by_label('Invitation code',exact=True).fill(page.evaluate('code'))
        page.get_by_role('button',name='Verify and review →').click()
        page.get_by_role('button',name='Accept invitation',exact=True).wait_for()
        check('preview is explicit and no acceptance runs automatically',not page.evaluate("calls.some(x=>x.path.endsWith('/accept'))"))
        check('the code is removed from the form during review',page.locator('#code').count()==0)
        page.get_by_role('button',name='Accept invitation',exact=True).click()
        page.wait_for_function('app.client.preview===null && !app.busy')
        check('acceptance returns a membership confirmation',page.get_by_text('Membership confirmed in Navyix Engineering.',exact=False).is_visible())
        check('no code appears in any requested URL',page.evaluate('calls.every(x=>!x.path.includes(code))'))
        page.evaluate("mode='denied'");page.get_by_role('button',name='Refresh',exact=True).click()
        page.get_by_role('alert').wait_for()
        check('access denial clears prior invitation records',page.locator('.records article').count()==0)
        page.evaluate("app.channel.onmessage({data:'signed-out'})")
        page.get_by_role('button',name='Sign in securely →').wait_for()
        check('cross-tab sign-out clears sensitive page state',page.evaluate('!app.client.pending && !app.client.preview && !app.created && app.orgs.length===0'))
        check('no uncaught browser JavaScript exceptions',not errors)
        browser.close()
    result={'scope':'offline exact-component/client, synthetic API/session, no PostgreSQL or provider calls','passed':len(checks),'checks':checks,'errors':errors}
    (out/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
