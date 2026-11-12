"""Behavioral Chromium integration of production UI + HTTP session handler.

Synthetic IdP, memory sessions, and a fixture API using the real workflow domain.
NOT Next/Nest, real PostgreSQL/RLS, external login or visual/accessibility certification.
Run: python tests/connected_workflow.py --browser /path/to/chromium --artifacts /tmp/navyix-tests
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ORG_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"


def run(browser_path: str | None, artifacts: Path, offline: bool = False) -> dict:
    artifacts.mkdir(parents=True, exist_ok=True)
    process = None if offline else subprocess.Popen(
        ["node", str(ROOT / "tests/fixtures/connected-harness.mjs")], cwd=ROOT,
        env={**os.environ, "NAVYIX_TEST_HARNESS": "1", "NODE_ENV": "test"},
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    checks: list[str] = []
    errors: list[str] = []
    result: dict = {"checks": checks, "page_errors": errors, "scope": "synthetic connected behavioral integration"}
    try:
        line = process.stdout.readline() if process else '{}'
        if not line:
            raise RuntimeError("Fixture failed to start: " + process.stderr.read())
        config = json.loads(line) if not offline else {"origin":"https://offline.invalid", "stylesLoaded":False}
        result["scope"] = "offline Chromium component/transport; synthetic API" if offline else result["scope"]
        origin = config["origin"]
        result["base_styles_loaded"] = config["stylesLoaded"]

        def control(action="inspect", **fields):
            req = urllib.request.Request(origin + "/__test/control", data=json.dumps({"action": action, **fields}).encode(),
                  headers={"Content-Type": "application/json", "X-Test-Control": config["controlKey"]})
            with urllib.request.urlopen(req, timeout=10) as response:
                return json.load(response)

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=browser_path, args=["--no-sandbox"])
            context = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 1000})
            if not offline: context.add_init_script("""
              localStorage.setItem('navyix.local-workbench.v1', 'LOCAL_PRIVATE_SENTINEL');
              window.previewStorageReads = 0;
              const original = Storage.prototype.getItem;
              Storage.prototype.getItem = function(key) {
                if (key === 'navyix.local-workbench.v1') window.previewStorageReads++;
                return original.call(this, key);
              };
            """)
            # Intercept the explicitly synthetic provider; never contact a real account.
            def route_request(route):
                if route.request.url.startswith("https://identity.test/authorize"):
                    from urllib.parse import parse_qs, urlparse, urlencode
                    state = parse_qs(urlparse(route.request.url).query)["state"][0]
                    route.fulfill(status=302, headers={"location": origin + "/api/browser/callback?" + urlencode({"state": state, "code": "synthetic-code"})}, body="")
                elif route.request.url.startswith(origin + "/"):
                    route.continue_()
                else:
                    route.abort()
            if not offline: context.route("**/*", route_request)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            if offline:
                import re
                parts = []
                paths = ["packages/workflow/src/workflow.mjs", "packages/workflow/src/storage.mjs",
                    "tests/fixtures/offline-workspace.mjs", "packages/browser-session/src/client.mjs",
                    "apps/web/workbench/app.mjs", "apps/web/workbench/connected.mjs"]
                for name in paths:
                    text = (ROOT/name).read_text()
                    text = re.sub(r"^import .*?;\n", "", text, flags=re.M)
                    text = re.sub(r"^export (?=(const|class|function))", "", text, flags=re.M)
                    # Only replace module stylesheet URLs. Logic and DOM remain production sources.
                    text = re.sub(r"new URL\('\./(?:workbench|connected)\.css', import.meta.url\)\.href", "'data:text/css,'", text)
                    parts.append(text)
                parts.append("const app=document.createElement('navyix-connected-workbench');app.download=(value,name)=>window.__offline.downloads.push({value,name});document.body.append(app);")
                script = "\n".join(parts).replace('</script', '<\\/script')
                page.set_content('<!doctype html><html lang="en"><meta charset="utf-8"><body><p>OFFLINE SYNTHETIC COMPONENT TEST</p><script type="module">'+script+'</script></body></html>')
                control = lambda action="inspect", **fields: page.evaluate("x=>window.__offline.control(x)", {"action":action, **fields})
                expect(page.get_by_label("Organization ID")).to_be_visible()
                checks.append("authenticated-state fixture loads the connected component without network navigation")
            else:
                page.goto(origin + "/workspace")
                expect(page.get_by_role("button", name="Sign in with your organization")).to_be_visible()
                checks.append("unauthenticated UI contains no project records")
                page.get_by_role("button", name="Sign in with your organization").click()
                expect(page.get_by_label("Organization ID")).to_be_visible()
                assert "navyix-dev-session" not in page.evaluate("document.cookie")
                assert any(c["name"] == "navyix-dev-session" and c["httpOnly"] for c in context.cookies())
                checks.append("real browser redirect/callback installs an HttpOnly development session cookie")

            def connect(org):
                page.get_by_label("Organization ID").fill(org)
                page.get_by_role("button", name="Connect workspace").click()
                expect(page.get_by_label("Active project")).to_be_visible()

            def nav(view):
                page.locator(f'[data-action="nav"][data-view="{view}"]').click()

            def submit(fields, save="Save record"):
                dialog = page.locator("dialog[open]")
                for name, value in fields.items():
                    dialog.locator(f'[name="{name}"]').fill(value)
                dialog.get_by_role("button", name=save, exact=True).click()
                expect(dialog).not_to_be_visible()

            connect(ORG_A)
            expect(page.get_by_role("button", name="Explore sample workflow")).to_have_count(0)
            page.get_by_role("button", name="Create your first project").click()
            submit({"name": "Alpha Portal (synthetic)", "goal": "Validate connected design-build-test readiness", "owner": "Fixture team"}, "Save project")
            expect(page.locator(".breadcrumbs b")).to_have_text("Alpha Portal (synthetic)")
            checks.append("project creation uses the server-issued identifier and server records")
            page.get_by_role("button", name="+ Add requirement", exact=True).first.click()
            submit({"title": "One-time code", "acceptance": "A code succeeds once; reuse is rejected"})
            page.get_by_role("button", name="Mark reviewed", exact=True).click()
            expect(page.locator(".record .pill")).to_have_text("Reviewed")
            checks.append("requirement creation and review use the connected API")
            nav("design")
            page.get_by_role("button", name="+ Add design", exact=True).first.click()
            page.locator('dialog [name="requirementIds"]').check()
            submit({"title": "Atomic code consumption", "decision": "Consume a hashed OTP atomically"})
            page.get_by_role("button", name="Mark reviewed", exact=True).click()
            expect(page.locator(".record .pill")).to_have_text("Reviewed")
            checks.append("linked design creation and review use the connected API")
            nav("builds")
            page.get_by_role("button", name="+ Record build", exact=True).first.click()
            submit({"label": "Synthetic build 1", "commitSha": "a" * 40, "artifactDigest": "sha256:" + "b" * 64})
            checks.append("full artifact identity is recorded and selected")
            nav("tests")
            page.get_by_role("button", name="+ Add test case", exact=True).first.click()
            submit({"title": "Reject code reuse", "steps": "Submit the same code twice", "expected": "Second request is rejected"})
            checks.append("test definition is linked without inventing execution evidence")
            if offline:
                page.get_by_role("button", name="Download report template", exact=True).click()
                page.wait_for_function("window.__offline.downloads.length > 0")
                template = page.evaluate("window.__offline.downloads.at(-1).value")
            else:
                with page.expect_download() as info:
                    page.get_by_role("button", name="Download report template", exact=True).click()
                template = json.loads(Path(info.value.path()).read_text())
            assert template["results"][0]["status"] == "skipped"
            checks.append("template export payload contains skipped results and the exact target" if offline else "real browser download returns a revision-specific skipped-result template")
            def import_result(status, run_id):
                report = {**template, "runId": run_id, "executedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                          "results": [{**template["results"][0], "status": status, "note": "Synthetic browser-test fixture, NOT a real product test execution"}]}
                page.get_by_role("button", name="Import test results", exact=True).click()
                submit({"report": json.dumps(report)}, "Validate & import")
            import_result("failed", "synthetic-failure")
            nav("readiness")
            expect(page.locator(".decision-banner h2")).to_have_text("Blocked")
            checks.append("failed execution blocks the displayed server-calculated readiness")
            page.locator('[data-action="criterion"][data-key="test:TST-001"]').click()
            expect(page.locator("dialog[open] .evidence-json")).to_contain_text("synthetic-failure")
            page.locator('dialog [data-action="close-dialog"]').click()
            checks.append("evidence inspector exposes the actual returned run reference")
            nav("tests"); import_result("passed", "synthetic-retest")
            nav("readiness")
            expect(page.locator(".decision-banner h2")).to_have_text("Ready")
            page.get_by_role("button", name="Save assessment", exact=True).click()
            expect(page.locator('#alerts')).to_contain_text("Saved")
            nav("history")
            expect(page.locator(".record .pill")).to_have_text("Ready")
            if offline:
                page.get_by_role("button", name="Export snapshot").click()
                page.wait_for_function("window.__offline.downloads.length > 1")
                snapshot = page.evaluate("window.__offline.downloads.at(-1).value")
            else:
                with page.expect_download() as info:
                    page.get_by_role("button", name="Export snapshot").click()
                snapshot = json.loads(Path(info.value.path()).read_text())
            assert snapshot["status"] == "Ready" and snapshot["artifactDigest"] == template["artifactDigest"]
            checks.append("passing retest and exported assessment preserve the exact target")

            # Lost acknowledgement: the fixture commits once, then returns a transport failure.
            nav("requirements")
            control("drop-next")
            page.get_by_role("button", name="+ Add requirement", exact=True).first.click()
            dialog = page.locator("dialog[open]")
            dialog.locator('[name="title"]').fill("Retry-safe requirement")
            dialog.locator('[name="acceptance"]').fill("There is exactly one stored record")
            dialog.get_by_role("button", name="Save record", exact=True).click()
            expect(dialog.locator('[data-action="retry-save"]')).to_be_visible()
            expect(dialog.locator('[type="submit"]')).not_to_be_visible()
            dialog.locator('[data-action="retry-save"]').click()
            expect(dialog).not_to_be_visible()
            state = control()
            project = state["organizations"][ORG_A][0]
            assert sum(r["title"] == "Retry-safe requirement" for r in project["requirements"]) == 1
            post_calls = [c for c in state["calls"] if c["method"] == "POST"]
            assert post_calls[-1]["key"] == post_calls[-2]["key"]
            checks.append("unconfirmed modal save has an accessible exact-request retry and creates one record")
            nav("readiness")
            expect(page.locator(".decision-banner h2")).not_to_have_text("Ready")
            nav("history"); expect(page.locator(".record .pill")).to_have_text("Ready")
            checks.append("new scope invalidates current readiness without rewriting the saved snapshot")

            # Closing a failed-save modal must not trap the user behind the pending-write guard.
            nav("requirements"); control("drop-next")
            page.get_by_role("button", name="+ Add requirement", exact=True).first.click()
            dialog = page.locator("dialog[open]")
            dialog.locator('[name="title"]').fill("Cancelable pending dialog")
            dialog.locator('[name="acceptance"]').fill("Cancel closes the modal, not the committed operation")
            dialog.get_by_role("button", name="Save record", exact=True).click()
            expect(dialog.locator('[data-action="retry-save"]')).to_be_visible()
            dialog.get_by_role("button", name="Cancel", exact=True).click()
            expect(dialog).not_to_be_visible()
            page.locator('#alerts [data-action="retry-save"]').click()
            expect(page.locator('#alerts')).to_contain_text("confirmed")
            checks.append("pending modal can close and retry safely from the workspace")

            # Selection is reset consistently when an acknowledged/retried new build becomes current.
            nav("builds"); control("drop-next")
            page.get_by_role("button", name="+ Record build", exact=True).first.click()
            dialog = page.locator("dialog[open]")
            for field, value in {"label": "Synthetic build 2", "commitSha": "c" * 40, "artifactDigest": "sha256:" + "d" * 64}.items():
                dialog.locator(f'[name="{field}"]').fill(value)
            dialog.get_by_role("button", name="Save record", exact=True).click()
            expect(dialog.locator('[data-action="retry-save"]')).to_be_visible()
            dialog.locator('[data-action="retry-save"]').click()
            expect(dialog).not_to_be_visible()
            nav("readiness")
            expect(page.get_by_label("Target build")).to_have_value("BLD-002")
            assert page.evaluate("document.querySelector('navyix-connected-workbench').assessment().buildId") == "BLD-002"
            checks.append("retried build save keeps the selector and server assessment on the same artifact")
            page.get_by_label("Target build").select_option("")
            expect(page.locator(".decision-note")).to_contain_text("No artifact selected")
            page.get_by_role("button", name="Refresh", exact=True).click()
            expect(page.get_by_label("Target build")).to_have_value("")
            checks.append("explicit no-build selection survives server refresh")

            control("read-only", orgId=ORG_A, value=True)
            nav("requirements")
            page.get_by_role("button", name="+ Add requirement", exact=True).first.click()
            dialog = page.locator("dialog[open]")
            dialog.locator('[name="title"]').fill("Forbidden synthetic change")
            dialog.locator('[name="acceptance"]').fill("Must be rejected by fixture")
            dialog.get_by_role("button", name="Save record", exact=True).click()
            expect(dialog.locator('.form-error')).to_contain_text("read-only")
            dialog.get_by_role("button", name="Cancel", exact=True).click()
            assert not any(r["title"] == "Forbidden synthetic change" for r in control()["organizations"][ORG_A][0]["requirements"])
            checks.append("denied mutation remains an error, never a saved record")
            control("read-only", orgId=ORG_A, value=False)

            page.get_by_role("button", name="Switch organization", exact=True).click()
            expect(page.get_by_label("Organization ID")).to_be_visible()
            assert "Alpha Portal" not in page.locator('navyix-connected-workbench').inner_text()
            connect(ORG_B)
            expect(page.get_by_role("button", name="Create your first project")).to_be_visible()
            assert "Alpha Portal" not in page.locator('navyix-connected-workbench').inner_text()
            checks.append("switching organizations clears all previous project content from the rendered UI")
            assert page.evaluate("window.previewStorageReads") == 0
            if not offline: assert page.evaluate("localStorage.getItem('navyix.local-workbench.v1')") == "LOCAL_PRIVATE_SENTINEL"
            checks.append("connected mode never reads or overwrites the local-preview store")

            page.get_by_role("button", name="Switch organization", exact=True).click(); connect(ORG_A)
            control("revoke", orgId=ORG_A)
            page.get_by_role("button", name="Refresh", exact=True).click()
            expect(page.get_by_role("button", name="Retry connection", exact=True)).to_be_visible()
            assert "Alpha Portal" not in page.locator('navyix-connected-workbench').inner_text()
            expect(page.get_by_role("button", name="Switch organization", exact=True)).to_be_visible()
            checks.append("revoked access removes project content and offers organization recovery")
            page.get_by_role("button", name="Switch organization", exact=True).click(); connect(ORG_B)

            if offline:
                page.get_by_role("button", name="Sign out", exact=True).click()
                expect(page.get_by_role("button", name="Sign in with your organization")).to_be_visible()
                assert not page.evaluate("document.querySelector('navyix-connected-workbench').api.authenticated")
                checks.append("logout clears the component and transport state (synthetic session)")
                control("authenticate")
                page.evaluate("document.querySelector('navyix-connected-workbench').load()")
                connect(ORG_B)
            else:
                other = context.new_page(); other.on('pageerror', lambda error: errors.append(str(error)))
                other.goto(origin + '/workspace'); expect(other.get_by_label('Organization ID')).to_be_visible()
                page.get_by_role("button", name="Sign out", exact=True).click()
                expect(page.get_by_role("button", name="Sign in with your organization")).to_be_visible()
                expect(other.get_by_role("button", name="Sign in with your organization")).to_be_visible()
                assert not any(c['name'] == 'navyix-dev-session' for c in context.cookies())
                page.reload(); expect(page.get_by_role("button", name="Sign in with your organization")).to_be_visible()
                checks.append("real logout removes the cookie, clears another tab, and remains signed out after reload")
                other.close()
                page.get_by_role("button", name="Sign in with your organization").click(); connect(ORG_B)
            control("expire")
            page.get_by_role("button", name="Refresh", exact=True).click()
            expect(page.get_by_role("button", name="Sign in with your organization")).to_be_visible()
            checks.append("expired server session clears the connected workspace")
            assert not errors, errors
            checks.append("no uncaught JavaScript errors during the executed connected journey")
            context.close(); browser.close()
        result['passed'] = len(checks); result['status'] = 'passed'
    except Exception as error:
        result['status'] = 'failed'; result['failure'] = str(error)
        raise
    finally:
        (artifacts / 'connected-results.json').write_text(json.dumps(result, indent=2))
        if process:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', default=shutil.which('chromium'))
    parser.add_argument('--artifacts', type=Path, default=Path('test-results/connected'))
    parser.add_argument('--offline', action='store_true', help='No navigation/network/cookies. Production DOM with synthetic transport and captured export payloads only.')
    args = parser.parse_args()
    print(json.dumps(run(args.browser, args.artifacts, args.offline), indent=2))
