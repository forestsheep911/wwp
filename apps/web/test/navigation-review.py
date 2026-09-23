"""Full application navigation tests with explicit deterministic API fixtures."""
import json
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
from playwright.sync_api import sync_playwright, expect
out = Path(".local-data/navigation-review")
out.mkdir(parents=True, exist_ok=True)
work = {"assetKey":"notion-page-a","title":"测试电影","source":"notion","updatedAt":"2026-09-22","metadata":{"work":{"workId":"work-a","kind":"movie","credits":[{"personId":"person-a","name":"测试人物","department":"acting"}]},"genres":["剧情"],"release":{"year":"2000"}},"variants":[{"assetKey":"video-a","label":"正片","title":"正片","contentType":"video/mp4"}]}
person={"personId":"person-a","names":{"primary":"测试人物","aliases":[]},"departments":["acting"],"dataStatus":"verified","biographyLanguages":[],"workCount":1,"representativeWorks":["测试电影"],"works":[{"workId":"work-a","title":"测试电影","department":"acting"}]}
entries=[{"kind":"work","id":"w_abc","key":"notion-page-a","title":"测试电影","path":"/works/测试电影-w_abc","aliases":["work-a"]},{"kind":"person","id":"p_abc","key":"person-a","title":"测试人物","path":"/people/测试人物-p_abc","aliases":[]},{"kind":"video","id":"v_abc","key":"video-a","title":"正片","path":"/watch/v_abc","aliases":[]}]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for width in [1366,390,360]:
  page=browser.new_page(viewport={"width":width,"height":900})
  errors=[]; mutations=[]
  failures={"work":False}
  page.on("pageerror",lambda e:errors.append(str(e)))
  def api(route):
   req=route.request; path=urlparse(req.url).path
   if req.method != "GET": mutations.append(path)
   payload={}
   if failures["work"] and "/library-assets/" in path:
    route.fulfill(status=503,content_type="application/json",body=json.dumps({"error":"测试连接失败"})); return
   if path.endswith("/health"): payload={"ok":True}
   elif path.endswith("/auth/check"): payload={"ok":True,"role":"member","member":{"id":"test","name":"测试"}}
   elif path.endswith("/public-routes"): payload={"entries":entries}
   elif path.endswith("/search") or path.endswith("/browse-assets"): payload={"results":[work],"total":1,"hasMore":False}
   elif "/library-assets/" in path: payload={"result":work}
   elif path.endswith("/people"): payload={"people":[person],"total":1,"workRelationshipCount":1}
   elif "/people/" in path: payload=person
   elif "collection" in path: payload={"entries":[],"revision":"0"}
   elif "notices" in path: payload={"notices":[]}
   elif "cached-assets" in path: payload={"assets":[]}
   elif "movie-requests" in path: payload={"requests":[]}
   elif "forum/threads/" in path: payload={"thread":{"id":"t1","title":"帖子测试","body":"内容","replies":[],"createdAt":"2026-09-22","updatedAt":"2026-09-22","authorRole":"member","authorMemberName":"测试","replyCount":0}}
   elif "forum" in path: payload={"threads":[]}
   elif "/assets/" in path: payload={"status":"missing"}
   route.fulfill(status=200,content_type="application/json",body=json.dumps(payload,ensure_ascii=False))
  page.route("**/api/**",api); page.route("**/health",api)
  page.goto("http://127.0.0.1:5293/",wait_until="networkidle")
  page.keyboard.press("Control+k")
  field=page.get_by_role("textbox",name="搜索片名、导演或演员")
  expect(field).to_be_visible(); field.fill("测试"); field.press("Enter")
  page.wait_for_timeout(500)
  page.screenshot(path=str(out/f"search-{width}.png"))
  page.locator("section[aria-label=影视搜索结果]").get_by_role("link",name="测试电影").first.click()
  page.wait_for_url("**/works/**")
  assert "notion-page" not in page.url
  expect(page.get_by_role("button",name="探索影视关系")).to_be_visible()
  page.keyboard.press("Control+k")
  expect(field).to_have_value("测试")
  expect(page.locator("section[aria-label=影视搜索结果]").get_by_role("link",name="测试电影").first).to_be_visible()
  page.keyboard.press("Escape")
  page.reload(wait_until="networkidle")
  page.keyboard.press("Control+k")
  expect(field).to_have_value("测试")
  expect(page.locator("section[aria-label=影视搜索结果]").get_by_role("link",name="测试电影").first).to_be_visible()
  page.keyboard.press("Escape")
  page.get_by_role("button",name="探索影视关系").click()
  page.wait_for_url("**/graph*")
  page.get_by_role("button",name="关系列表",exact=True).click()
  page.get_by_role("button",name="测试人物").click()
  page.wait_for_url("**/people/**/graph*")
  page.reload(wait_until="networkidle")
  expect(page.get_by_role("dialog",name="影视关系")).to_be_visible()
  page.wait_for_timeout(1500)
  page.screenshot(path=str(out/f"graph-{width}.png"))
  page.go_back(wait_until="networkidle")
  assert "/works/" in page.url and "/graph" in page.url
  page.go_forward(wait_until="networkidle")
  assert "/people/" in page.url and "/graph" in page.url
  page.goto("http://127.0.0.1:5293/search?q=测试&scope=movie",wait_until="networkidle")
  expect(page.locator("section[aria-label=影视搜索结果]").get_by_role("link",name="测试电影").first).to_be_visible()
  assert page.get_by_role("dialog").count()==0
  page.screenshot(path=str(out/f"search-page-{width}.png"))
  page.goto("http://127.0.0.1:5293/not-a-page",wait_until="networkidle")
  expect(page.get_by_role("heading",name="页面不存在")).to_be_visible()
  page.goto("http://127.0.0.1:5293/people?q=测试",wait_until="networkidle")
  directory=page.get_by_placeholder("搜索中文名、英文名或代表作")
  expect(directory).to_have_value("测试")
  page.get_by_role("link",name="测试人物").first.click();page.wait_for_url("**/people/**")
  page.go_back(wait_until="networkidle");expect(directory).to_have_value("测试")
  page.goto("http://127.0.0.1:5293/forum/t1",wait_until="networkidle")
  expect(page.get_by_role("heading",name="帖子测试")).to_be_visible()
  drafts=page.locator("textarea");drafts.first.fill("未提交的帖子草稿");drafts.last.fill("未提交的回复")
  page.reload(wait_until="networkidle")
  expect(drafts.first).to_have_value("未提交的帖子草稿");expect(drafts.last).to_have_value("未提交的回复")
  page.goto("http://127.0.0.1:5293/profile/notices",wait_until="networkidle")
  expect(page.get_by_role("dialog")).to_be_visible()
  page.reload(wait_until="networkidle");expect(page.get_by_role("dialog")).to_be_visible()
  page.goto("http://127.0.0.1:5293/watch/v_abc",wait_until="networkidle")
  expect(page.get_by_role("dialog",name="选择使用方式")).to_be_visible()
  page.reload(wait_until="networkidle");expect(page.get_by_role("dialog",name="选择使用方式")).to_be_visible()
  failures["work"]=True
  page.goto("http://127.0.0.1:5293/works/测试电影-w_abc/graph",wait_until="networkidle")
  expect(page.get_by_role("heading",name="暂时无法打开这部作品")).to_be_visible()
  assert "/graph" in page.url
  failures["work"]=False
  page.get_by_role("button",name="重试",exact=True).click()
  expect(page.get_by_role("dialog",name="影视关系")).to_be_visible()
  assert not errors, errors
  assert not mutations, mutations
  print(json.dumps({"width":width,"search_roundtrip":True,"refresh":True,"graph_history":True,"shared_search":True,"not_found":True,"directory_return":True,"draft_refresh":True,"profile_refresh":True,"watch_no_autoplay":True,"graph_retry":True,"mutations":mutations,"errors":errors}),flush=True)
  page.close()
 browser.close()
