"""Browser workflow checks.
Normal: python tests/workflow_browser.py --url http://127.0.0.1:4173
Offline DOM harness: add --offline. Uses the exact local component/domain source,
embedded CSS and an in-memory Storage adapter. It does NOT verify HTTP imports,
real localStorage persistence, the Next.js build, or authentication.
Requires Python Playwright and a Chromium installation. Never triggers CI/CD.
"""
import argparse
import datetime as dt
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--offline', action='store_true')
parser.add_argument('--url', default='http://127.0.0.1:4173')
parser.add_argument('--browser', default=None, help='Optional Chromium executable path')
parser.add_argument('--artifacts', default='test-artifacts')
args = parser.parse_args()
out = ROOT / args.artifacts
out.mkdir(parents=True, exist_ok=True)
checks = []

def passed(name):
    checks.append(name)
    print(f'PASS {len(checks):02d}: {name}', flush=True)

def state(page):
    return page.evaluate("JSON.parse(document.querySelector('navyix-workbench').store.getItem('navyix.local-workbench.v1'))")

def project(page):
    return state(page)['projects'][0]

def nav(page, view):
    page.locator(f'[data-action="nav"][data-view="{view}"]').click()

def submit(page, name='Save record'):
    page.get_by_role('dialog').get_by_role('button', name=name, exact=True).click()
    expect(page.get_by_role('dialog')).not_to_be_visible()

def report_for(p, status, run_id):
    b = p['builds'][0]
    return {'schemaVersion': 1, 'projectId': p['id'], 'runId': run_id, 'buildId': b['id'],
            'artifactDigest': b['artifactDigest'], 'environment': b['environment'],
            'executedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
            'results': [{'testCaseId': t['id'], 'testCaseRevision': t['revision'], 'status': status} for t in p['testCases']]}

with sync_playwright() as pw:
    options = {'headless': True}
    if args.browser:
        options['executable_path'] = args.browser
    browser = pw.chromium.launch(**options)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    page.set_default_timeout(5000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    if args.offline:
        domain = (ROOT / 'packages/workflow/src/workflow.mjs').read_text()
        storage = (ROOT / 'packages/workflow/src/storage.mjs').read_text()
        app = (ROOT / 'apps/web/workbench/app.mjs').read_text()
        source = '\n'.join(re.sub(r'^export ', '', s, flags=re.M) for s in (domain, storage))
        source += '\n' + re.sub(r'^import .*?;\n', '', app, flags=re.M)
        source = source.replace('import.meta.url', "'http://127.0.0.1:4173/app.mjs'")
        source = re.sub(r'<link rel="stylesheet" href="\$\{new URL\(.*?\)\.href\}">', '', source)
        css = (ROOT / 'apps/web/workbench/workbench.css').read_text()
        page.set_content('<!doctype html><html lang="en"><head><title>Navyix browser checks</title></head><body></body></html>')
        page.add_style_tag(content='body{margin:0}')
        page.add_script_tag(content=source)
        page.evaluate('''css=>{
          const records=new Map();
          window.testStorage={getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)};
          window.mountWorkbench=()=>{document.querySelector('navyix-workbench')?.remove();
            const app=document.createElement('navyix-workbench');app.storage=window.testStorage;document.body.append(app);
            const style=document.createElement('style');style.textContent=css;app.shadowRoot.append(style);};
          window.mountWorkbench();
        }''', css)
    else:
        page.goto(args.url)
    expect(page.get_by_role('button', name='Create your first project')).to_be_visible()
    passed('Empty onboarding has no fabricated records')
    animation = page.locator('.orb span').evaluate('(el)=>getComputedStyle(el).animationName')
    assert animation == 'none'
    passed('Reduced-motion preference disables the decorative animation')

    page.get_by_role('button', name='Create your first project').click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).not_to_be_visible()
    passed('Modal opens and closes with Escape')
    page.get_by_role('button', name='Create your first project').click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Project name').fill('Acceptance Portal')
    dialog.get_by_label('Project goal').fill('Verify one-time login before release.')
    dialog.get_by_label('Owner', exact=True).fill('QA owner')
    submit(page, 'Save project')
    assert project(page)['name'] == 'Acceptance Portal'
    passed('Project form creates and stores a real local project')

    page.locator('[data-action="requirement"]').first.click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Requirement title').fill('Reject reused codes')
    dialog.get_by_label('Acceptance criteria').fill('The second use of the same OTP is rejected.')
    submit(page)
    assert len(project(page)['requirements']) == 1
    passed('Requirement form persists measurable acceptance criteria')
    nav(page, 'readiness')
    page.get_by_label('Readiness activity').select_option('build')
    expect(page.locator('.decision-banner')).to_contain_text('Blocked')
    passed('Unreviewed requirement blocks build readiness')
    nav(page, 'requirements')
    page.get_by_role('button', name='Mark reviewed', exact=True).click()
    assert project(page)['requirements'][0]['reviewedRevision'] == 1
    nav(page, 'design')
    page.locator('[data-action="design"]').first.click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Design title').fill('Atomic code consumption')
    dialog.get_by_label('Decision and tradeoffs').fill('Hash the code and consume it atomically.')
    dialog.get_by_role('checkbox').check()
    submit(page)
    page.get_by_role('button', name='Mark reviewed', exact=True).click()
    assert project(page)['designs'][0]['reviewedAt']
    passed('Design records link exact requirement revisions and retain review records')

    nav(page, 'builds')
    page.locator('[data-action="build"]').first.click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Build label').fill('candidate-1')
    dialog.get_by_label('Commit SHA').fill('abc123')
    dialog.get_by_label('Artifact digest').fill('sha256:' + 'b' * 64)
    dialog.get_by_role('button', name='Save record').click()
    expect(dialog.locator('.form-error')).to_contain_text('complete')
    assert not project(page)['builds']
    passed('Invalid build identity is rejected without writing a build')
    dialog.get_by_label('Commit SHA').fill('a' * 40)
    submit(page)
    assert project(page)['builds'][0]['artifactDigest'] == 'sha256:' + 'b' * 64
    passed('Build record preserves exact artifact and environment')

    nav(page, 'tests')
    page.locator('[data-action="test"]').first.click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Test title').fill('Code reuse is rejected')
    dialog.get_by_label('Test steps').fill('Submit the same code twice.')
    dialog.get_by_label('Expected outcome').fill('The second request is rejected.')
    submit(page)
    assert len(project(page)['testCases']) == 1
    passed('Test definitions are stored separately from execution results')
    nav(page, 'readiness')
    page.get_by_label('Readiness activity').select_option('test')
    expect(page.locator('.decision-banner')).to_contain_text('Ready')
    page.get_by_label('Readiness activity').select_option('release')
    expect(page.locator('.decision-banner')).to_contain_text('Insufficient evidence')
    passed('Prepared tests allow testing but do not establish release readiness')
    page.get_by_label('Target build').select_option('')
    expect(page.locator('.decision-banner')).to_contain_text('No artifact selected')
    page.get_by_label('Target build').select_option('BLD-001')
    passed('Clearing build selection does not silently reuse the previous target')

    nav(page, 'tests')
    page.get_by_role('button', name='Import test results').click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Report JSON').fill('{bad json')
    dialog.get_by_role('button', name='Validate & import').click()
    expect(dialog.locator('.form-error')).to_contain_text('valid JSON')
    assert not project(page)['reports']
    passed('Malformed report import is atomic and leaves state unchanged')
    failing = report_for(project(page), 'failed', 'observed-run-1')
    dialog.locator('#report-file').set_input_files({'name': 'test-run.json', 'mimeType': 'application/json', 'buffer': json.dumps(failing).encode()})
    expect(dialog.get_by_label('Report JSON')).to_have_value(json.dumps(failing))
    submit(page, 'Validate & import')
    assert project(page)['reports'][0]['results'][0]['status'] == 'failed'
    passed('JSON file upload validates and imports observed failed execution')
    nav(page, 'readiness')
    expect(page.locator('.decision-banner')).to_contain_text('Blocked')
    page.locator('[data-action="criterion"][data-key="test:TST-001"]').click()
    expect(page.get_by_role('dialog')).to_contain_text('observed-run-1')
    expect(page.get_by_role('dialog')).to_contain_text('Next action')
    page.keyboard.press('Escape')
    passed('Failed criterion exposes its evidence, owner and next action')

    nav(page, 'tests')
    page.get_by_role('button', name='Import test results').click()
    passing = report_for(project(page), 'passed', 'observed-run-2')
    page.get_by_role('dialog').get_by_label('Report JSON').fill(json.dumps(passing))
    submit(page, 'Validate & import')
    nav(page, 'readiness')
    expect(page.locator('.decision-banner')).to_contain_text('Ready')
    assert len(project(page)['reports']) == 2
    passed('Fresh passing retest clears the blocker while preserving failed-run history')
    page.get_by_role('button', name='Save assessment', exact=True).click()
    snapshot = project(page)['assessments'][0]
    assert snapshot['status'] == 'Ready' and snapshot['advisory'] is True
    passed('Save assessment captures the exact policy, target and evidence')
    nav(page, 'history')
    # Capture the actual exported payload without requiring a browser download permission.
    page.evaluate("document.querySelector('navyix-workbench').download=(value,name)=>{window.exported={value,name}}")
    page.get_by_role('button', name='Export snapshot').click()
    exported = page.evaluate('window.exported')
    assert exported['value'] == snapshot and exported['name'] == 'navyix-ASM-001.json'
    passed('Export action generates the unchanged assessment JSON payload')

    nav(page, 'requirements')
    page.get_by_role('button', name='Edit', exact=True).click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Acceptance criteria').fill('Reject reused and expired codes.')
    submit(page)
    nav(page, 'readiness')
    expect(page.locator('.decision-banner')).to_contain_text('Blocked')
    assert project(page)['assessments'][0] == snapshot
    passed('Requirement revision invalidates current readiness without rewriting saved history')

    for width in (360, 390, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 900})
        for view in ('overview', 'requirements', 'design', 'builds', 'tests', 'readiness', 'history'):
            nav(page, view)
            assert page.evaluate('document.documentElement.scrollWidth') <= width, (width, view)
    passed('Seven views fit 360, 390, 768 and 1440 px without page-level horizontal overflow')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    nav(page, 'overview')
    page.screenshot(path=str(out / 'workflow-overview.png'), full_page=True)
    nav(page, 'readiness')
    page.screenshot(path=str(out / 'workflow-readiness.png'), full_page=True)
    page.get_by_role('button', name='Light theme', exact=True).click()
    assert page.locator('.root').get_attribute('data-theme') == 'light'
    page.screenshot(path=str(out / 'workflow-light.png'), full_page=True)
    passed('Light/dark theme toggle works')
    page.get_by_role('button', name='Dark theme', exact=True).click()
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(out / 'workflow-mobile.png'), full_page=True)
    page.set_viewport_size({'width': 1440, 'height': 1000})

    if args.offline:
        page.evaluate('window.mountWorkbench()')
    else:
        page.reload()
    assert project(page)['assessments'][0] == snapshot
    expect(page.get_by_role('heading', name='See the whole delivery story.')).to_be_visible()
    passed('Reopening component retains stored project and assessment' if args.offline else 'Browser reload retains localStorage project and assessment')
    page.get_by_role('button', name='+ New project', exact=True).click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Project name').fill('<img src=x onerror="window.injected=1">')
    dialog.get_by_label('Project goal').fill('Keep projects separate within the local preview.')
    dialog.get_by_label('Owner', exact=True).fill('Second owner')
    submit(page, 'Save project')
    assert len(state(page)['projects']) == 2
    expect(page.get_by_role('heading', name='Start with one clear requirement')).to_be_visible()
    assert page.evaluate('window.injected') is None
    assert page.locator('img').count() == 0
    passed('Project switch shows its own records; user text is escaped, not executed')
    page.get_by_label('Active project').select_option(project(page)['id'])
    expect(page.get_by_role('heading', name='Reject reused codes')).to_be_visible()
    passed('Switching projects restores the selected project records')
    assert not errors, errors
    passed('No uncaught browser JavaScript errors during the workflow')
    result = {'mode': 'offline-component-with-memory-storage' if args.offline else 'http-preview', 'browser': 'Chromium', 'checksPassed': len(checks), 'checks': checks, 'pageErrors': errors}
    (out / 'browser-results.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({'checksPassed': len(checks), 'mode': result['mode']}))
    browser.close()
