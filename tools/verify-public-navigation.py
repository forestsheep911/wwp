import sys
sys.excepthook = lambda kind, value, traceback: print(f"Verification failed: {kind.__name__}: " + str(value).split("Call log:")[0].strip(), file=sys.stderr)
"""Verify deployed home frontend and authenticated read paths; never requests playback."""
import json, subprocess, re, os
from pathlib import Path
from urllib.parse import unquote
from playwright.sync_api import sync_playwright, expect
base = os.environ.get("WWP_VERIFY_ORIGIN", "https://www888eee.synology.me:38443")
key = subprocess.check_output(["node","--input-type=module","-e","import {config} from './tools/lib/project-secrets.mjs'; config(); process.stdout.write(process.env.WWPDW_ADMIN_KEY ?? '');"], text=True).strip()
assert key, "Configured admin credential is missing"
out = Path(".local-data/navigation-review"); out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 context=browser.new_context(ignore_https_errors=False)
 context.set_default_timeout(60000)
 context.set_default_navigation_timeout(90000)
 login=context.request.post(base+"/api/auth/login", data={"passcode":key}, headers={"Origin":base})
 assert login.ok, f"Login failed: {login.status}"
 print(json.dumps({"stage":"login","status":login.status}),flush=True)
 if base.startswith("http://127.0.0.1"):
  from http.cookies import SimpleCookie
  cookies=SimpleCookie();cookies.load(login.headers.get("set-cookie", ""))
  context.add_cookies([{"name":name,"value":value.value,"url":base,"secure":False,"sameSite":"Lax"} for name,value in cookies.items()])
 page=context.new_page(); errors=[]; forbidden=[]
 page.on("pageerror",lambda error:errors.append(str(error)))
 page.on("request",lambda request:forbidden.append(request.url) if any(term in request.url for term in ["/api/playback", "/api/ensure-cache"]) and request.method != "GET" else None)
 response=context.request.get(base+"/api/public-routes",timeout=120000); assert response.ok, f"Identity endpoint failed: {response.status}: {response.text()[:300]}"
 entries=response.json()["entries"]
 print(json.dumps({"stage":"identities", "count":len(entries)}),flush=True)
 work=next(entry for entry in entries if entry["kind"]=="work")
 person=next(entry for entry in entries if entry["kind"]=="person")
 for entry in [work,person]:
  resolved=context.request.get(base+f'/api/public-resolve/{entry["kind"]}/{entry["id"]}')
  assert resolved.ok and resolved.json()["id"]==entry["id"]
  response=page.goto(base+entry["path"],wait_until="domcontentloaded")
  assert response.status==200
  try:
   expect(page.get_by_role("button",name="探索影视关系")).to_be_visible(timeout=30000)
  except Exception:
   page.screenshot(path=str(out/"live-failure.png"))
   print(json.dumps({"stage":"detail-failed","url":page.url,"errors":errors,"body":page.locator("body").inner_text()[:1000]},ensure_ascii=False),flush=True)
   raise
  print(json.dumps({"stage":"detail", "kind":entry["kind"]}),flush=True)
  page.reload(wait_until="domcontentloaded")
  expect(page.get_by_role("button",name="探索影视关系")).to_be_visible()
  assert entry["id"] in page.url
  assert "notion-page" not in page.url
  page.screenshot(path=str(out/f'live-{entry["kind"]}.png'))
 page.goto(base+"/movie/"+work["key"],wait_until="domcontentloaded")
 page.wait_for_url("**/works/**")
 assert work["id"] in page.url
 page.keyboard.press("Control+k")
 field=page.get_by_role("textbox",name="搜索片名、导演或演员")
 expect(field).to_be_visible();field.fill(work["title"]);field.press("Enter")
 result=page.locator('section[aria-label="影视搜索结果"] a').first
 expect(result).to_be_visible(timeout=30000)
 result.click(); page.wait_for_url("**/works/**")
 page.keyboard.press("Control+k"); expect(field).to_have_value(work["title"]);expect(result).to_be_visible()
 page.keyboard.press("Escape")
 page.get_by_role("button",name="探索影视关系").click();page.wait_for_url("**/graph*")
 expect(page.get_by_role("dialog",name="影视关系")).to_be_visible()
 page.reload(wait_until="domcontentloaded");expect(page.get_by_role("dialog",name="影视关系")).to_be_visible()
 print(json.dumps({"stage":"graph-refresh"}),flush=True)
 expect(page.get_by_role("button",name="关系列表",exact=True)).to_be_visible(timeout=120000)
 expect(page.locator('canvas').first).to_be_visible(timeout=120000)
 expect(page.get_by_text("正在排列关系图",exact=True)).not_to_be_visible(timeout=120000)
 page.screenshot(path=str(out/("live-local-graph.png" if "127.0.0.1" in base else "live-public-graph.png")))
 html=context.request.get(base+"/").text(); assets=re.findall(r'/assets/[^" ]+\.js',html)
 assert assets
 # The browser already executed the entry bundle; avoid downloading large bundles a second time over the home uplink.
 assert context.request.get(base+"/api/missing-navigation-probe").status==404
 assert context.request.get(base+"/assets/missing-navigation-probe.js").status==404
 assert not forbidden, forbidden
 assert not errors, errors
 report={"origin":base,"identities":len(entries),"assets":assets,"legacy_redirect":True,"deep_link_refresh":True,"search_roundtrip":True,"graph_refresh":True,"write_or_playback_requests":forbidden,"page_errors":errors}
 (out/("live-local-report.json" if "127.0.0.1" in base else "live-public-report.json")).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
 (out/"live-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
 print(json.dumps(report,ensure_ascii=False))
 csrf=login.json().get("csrfToken", "")
 context.request.post(base+"/api/auth/logout",headers={"Origin":base,"x-wwpdw-csrf-token":csrf})
 browser.close()
