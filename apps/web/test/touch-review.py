"""Run with Vite on 5293. Screenshots use isolated fixture data, not a live account."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

phase = sys.argv[1] if len(sys.argv) > 1 else "after"
output = Path(".local-data/ui-touch-review")
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width, height in [(360, 800), (390, 844), (768, 1024), (1024, 768), (1366, 1024), (1440, 900)]:
        page = browser.new_page(viewport={"width": width, "height": height}, has_touch=width < 1440, device_scale_factor=1)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:5293/test/fixtures/touch-review.html", wait_until="networkidle")
        page.locator(".movie-card").first.wait_for(state="attached")
        page.screenshot(path=str(output / f"{phase}-{width}.png"))
        assert not errors, errors
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"overflow at {width}"
        if phase == "after" and width < 1440:
            expand = page.get_by_role("button", name="展开片库筛选条件")
            assert expand.is_visible()
            expand.tap()
            filters = page.locator("[data-library-filter]")
            for button in filters.get_by_role("button").all():
                assert button.bounding_box()["height"] >= 44
            filters.get_by_role("button", name="剧情", exact=True).tap()
            expect(filters.get_by_role("button", name="剧情", exact=True)).to_have_attribute("aria-pressed", "true")
            filters.get_by_role("button", name="清除", exact=True).tap()
            page.get_by_role("button", name="收起片库筛选条件").tap()
            more = page.get_by_role("button", name="更多功能")
            more.tap()
            dialog = page.get_by_role("dialog")
            dialog.wait_for()
            page.screenshot(path=str(output / f"{phase}-menu-{width}.png"))
            buttons = dialog.get_by_role("button")
            for button in buttons.all():
                box = button.bounding_box()
                assert box["height"] >= 44 and box["width"] >= 44, box
            dialog.get_by_role("button", name="人物索引", exact=True).tap()
            dialog.wait_for(state="hidden")
            assert page.locator("[data-review-action]").inner_text() == "people"
            page.get_by_role("button", name="返回首页").tap()
            if width < 768:
                card = page.locator(".movie-card").first
                card.get_by_role("button", name="想看", exact=True).tap()
                assert card.get_by_role("button", name="已想看", exact=True).get_attribute("aria-pressed") == "true"
                card.get_by_role("link", name="查看详情", exact=True).tap()
            else:
                page.locator("[data-gallery-card]").first.tap()
            page.locator("[data-detail-back]").wait_for(state="visible")
            page.screenshot(path=str(output / f"{phase}-detail-{width}.png"))
            page.locator("[data-detail-back]").tap()
            assert page.locator("[data-detail-back]").count() == 0
            more.tap()
            page.keyboard.press("Escape")
            expect(dialog).not_to_be_visible()
            expect(more).to_be_focused()
            more.tap()
            page.get_by_role("button", name="站内信").tap()
            notice = page.get_by_role("dialog", name="测试站内信")
            expect(notice).to_be_visible()
            expect(notice.get_by_role("button", name="关闭")).to_be_focused()
            notice.get_by_role("button", name="关闭").tap()
            expect(notice).not_to_be_visible()
            more.tap()
            page.get_by_role("button", name="切换亮色").tap()
            expect(dialog).not_to_be_visible()
            page.screenshot(path=str(output / f"{phase}-light-{width}.png"), animations="disabled")
            page.get_by_role("button", name="搜索影片").tap()
            assert page.locator("[data-review-action]").inner_text() == "搜索已打开"
        print(json.dumps({"phase": phase, "width": width, "passed": True}))
        page.close()
    browser.close()
