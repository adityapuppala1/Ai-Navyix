"""Offline exact-component recovery checks; synthetic API and page lifecycle events.
No Next.js, provider, database, actual bfcache entry, or native unload dialog is claimed.
"""
from pathlib import Path
import argparse, json, shutil
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
def source(path):
    return '\n'.join(line for line in (ROOT/path).read_text().splitlines() if not line.startswith('import ')).replace('export class ', 'class ')
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifacts', default='test-results/invitation-recovery')
    args = parser.parse_args(); out = Path(args.artifacts); out.mkdir(parents=True, exist_ok=True)
    checks, errors = [], []
    def check(label, result):
        assert result, label
        checks.append(label)
    with sync_playwright() as p:
        exe = shutil.which('chromium') or shutil.which('chromium-browser')
        browser = p.chromium.launch(headless=True, **({'executable_path': exe} if exe else {}))
        page = browser.new_page(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
        page.set_default_timeout(5000); page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0;background:#071320"><p style="font:12px system-ui;color:#b0bdcd;padding:0 24px">Recovery test · synthetic identities · no live invitation or email</p></body></html>')
        page.add_script_tag(content='''
          window.id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
          window.sequence=100; crypto.randomUUID=()=>id(sequence++);
          window.calls=[]; window.receipts=new Map(); window.rows=[]; window.lose=true;
          window.mode='normal'; window.expired=false; window.code='nvi1.'+'A'.repeat(43);
          window.fetch=async(path, init={})=>{
            calls.push({path,method:init.method||'GET',body:init.body,key:init.headers?.['idempotency-key']});
            if(path.endsWith('/session'))return expired?Response.json({error:{code:'SESSION_EXPIRED'}},{status:401}):Response.json({authenticated:true,csrfToken:'synthetic-csrf',expiresAt:new Date(Date.now()+3600000).toISOString()});
            if(path.endsWith('/logout'))return Response.json({signedOut:true});
            if(path.includes('/me/organizations'))return Response.json({organizations:[{id:id(1),name:'Synthetic Engineering',role:'OWNER'}],next:null});
            if(init.method==='POST'){
              const key=init.headers['idempotency-key'];
              if(receipts.has(key))return Response.json(receipts.get(key));
              const input=JSON.parse(init.body),r={orgId:id(1),invitationId:id(2),email:input.email,role:input.role,status:'pending',expiresAt:new Date(Date.now()+86400000).toISOString(),code,requestId:key};
              receipts.set(key,r);rows=[{id:id(2),email:input.email,role:input.role,status:'pending',createdAt:new Date().toISOString(),expiresAt:r.expiresAt}];
              if(lose){lose=false;throw Error('Synthetic lost acknowledgement');}
              return Response.json(r);
            }
            if(mode==='denied')return Response.json({error:{code:'FORBIDDEN',message:'Synthetic access removed'}},{status:403});
            if(mode==='defer')return new Promise(resolve=>window.releaseList=()=>resolve(Response.json({orgId:id(1),invitations:rows,next:null})));
            return Response.json({orgId:id(1),invitations:rows,next:null});
          };
        ''')
        page.add_script_tag(content='(()=>{'+source('packages/browser-session/src/client.mjs')+';window.BrowserWorkspace=BrowserWorkspace;})();')
        page.add_script_tag(content='(()=>{'+source('packages/browser-session/src/invitation-client.mjs')+';window.InvitationClient=InvitationClient;})();')
        ui = source('apps/web/workbench/invitations.mjs').replace('<link rel="stylesheet" href="/workbench/invitations.css">', '<style>'+(ROOT/'apps/web/workbench/invitations.css').read_text()+'</style>')
        page.add_script_tag(content='(()=>{'+ui+'})();')
        page.evaluate("()=>{window.app=document.createElement('navyix-invitations');document.body.append(app);}")
        page.get_by_label('Organization', exact=True).select_option(page.evaluate('id(1)'))
        page.wait_for_function('!app.busy')
        check('no unload guard is installed for a clean invitation page', page.evaluate('!app.navigationGuard'))
        page.get_by_label('Recipient email').fill('colleague@example.test')
        page.get_by_role('button',name='Create invitation →').click()
        page.get_by_role('button',name='Retry original request').wait_for()
        check('lost acknowledgement retains original operation and installs navigation guard', page.evaluate('Boolean(app.client.pending)&&app.navigationGuard&&receipts.size===1'))
        first = page.evaluate("calls.filter(c=>c.method==='POST').at(-1)")
        blocked = page.evaluate("()=>{const e=new MouseEvent('click',{bubbles:true,composed:true,cancelable:true});app.shadowRoot.querySelector('header a[href]').dispatchEvent(e);return e.defaultPrevented;}")
        check('workspace link cannot silently discard an unconfirmed invitation', blocked)
        check('navigation warning retains a usable original-request retry', page.get_by_role('button',name='Retry original request').is_visible())
        check('synthetic beforeunload event is cancelled while a save is pending', page.evaluate("()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}"))
        for width in (360,390,768,1440):
            page.set_viewport_size({'width':width,'height':1000})
            check(f'no horizontal page overflow at {width}px', page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        page.screenshot(path=str(out/'pending-recovery-desktop.png'),full_page=True)
        page.get_by_role('button',name='Retry original request').click()
        page.get_by_label('Share this code privately').wait_for()
        last = page.evaluate("calls.filter(c=>c.method==='POST').at(-1)")
        check('recovery reuses identical request body and key', first['body']==last['body'] and first['key']==last['key'])
        check('confirmed save removes the unload guard and preserves one invitation', page.evaluate('!app.navigationGuard && !app.client.pending && receipts.size===1'))
        check('clean synthetic beforeunload event is not cancelled', page.evaluate("()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return !e.defaultPrevented;}"))
        # A pagehide wipes secrets; persisted pageshow revalidates the session, never resubmits.
        previous_sessions = page.evaluate("calls.filter(c=>c.path.endsWith('/session')).length")
        previous_posts = page.evaluate("calls.filter(c=>c.method==='POST').length")
        page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))")
        check('pagehide clears code, memberships, pending request and guard', page.evaluate('!app.created && !app.client.pending && app.orgs.length===0 && !app.navigationGuard'))
        page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))")
        page.get_by_label('Organization', exact=True).wait_for()
        check('persisted pageshow revalidates the server session',page.evaluate("calls.filter(c=>c.path.endsWith('/session')).length")==previous_sessions+1)
        check('page restoration does not replay a mutation or restore an issued code',page.evaluate("calls.filter(c=>c.method==='POST').length")==previous_posts and page.locator('#issued-code').count()==0)
        page.get_by_label('Organization', exact=True).select_option(page.evaluate('id(1)'));page.wait_for_function('!app.busy')
        # An acknowledged save followed by revoked access stays acknowledged but loses visible secrets.
        page.evaluate("mode='denied'")
        page.get_by_label('Recipient email').fill('different@example.test')
        page.get_by_role('button',name='Create invitation →').click()
        page.wait_for_function('!app.busy')
        check('denied refresh after confirmed creation clears the issued code',page.locator('#issued-code').count()==0 and page.evaluate('app.created===null'))
        check('denied refresh cannot cause a second creation or leave stale creation controls enabled',page.evaluate('app.client.pending===null && app.client.adminGeneration===null') and page.get_by_role('button',name='Create invitation →').is_disabled())
        check('confirmed save with failed refresh is explicitly labeled saved',page.get_by_text('The save was confirmed, but the list could not refresh.',exact=False).is_visible())
        # A late list failure must not put a success message back onto the signed-out page.
        page.evaluate("mode='normal'");page.get_by_role('button',name='Refresh',exact=True).click();page.wait_for_function('!app.busy')
        page.evaluate("mode='defer'");page.get_by_label('Recipient email').fill('third@example.test')
        page.get_by_role('button',name='Create invitation →').click();page.wait_for_function("typeof releaseList==='function'")
        page.evaluate("app.channel.onmessage({data:'signed-out'})");page.evaluate('releaseList()');page.wait_for_timeout(30)
        check('late post-save refresh cannot repopulate signed-out state or notices',page.evaluate("app.phase==='signedout' && app.notice==='' && !app.created && app.orgs.length===0"))
        page.evaluate("mode='normal';expired=true;window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))")
        page.get_by_role('button',name='Sign in securely →').wait_for()
        check('restored page with an expired server session stays signed out',page.evaluate('!app.api.authenticated && app.orgs.length===0'))
        # Reattachment should reinitialize rather than display the previous private component state.
        page.evaluate("()=>{expired=false;app.remove();document.body.append(app);}")
        page.get_by_label('Organization',exact=True).wait_for()
        check('detached/reconnected component can initialize without private prior records',page.evaluate("app.phase==='ready'&&!app.created&&!app.client.pending&&app.client.rows.length===0"))
        check('no uncaught browser JavaScript errors',not errors)
        browser.close()
    result={'scope':'offline component/client with synthetic API, lifecycle events and transport','passed':len(checks),'checks':checks,'errors':errors,
            'notValidated':['Next/Nest','PostgreSQL/IdP','actual bfcache navigation','native beforeunload warning delivery','clipboard permissions']}
    (out/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
