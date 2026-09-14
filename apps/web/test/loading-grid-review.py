"""Isolated UI check: start apps/web Vite on 5294, then run from repo root."""
from pathlib import Path
from playwright.sync_api import sync_playwright

output = Path(".local-data/loading-grid-review")
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(has_touch=True)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    for width, height in [(390, 844), (768, 1024), (1024, 768), (1920, 1080), (2560, 1440)]:
        page.set_viewport_size({"width": width, "height": height})
        page.goto("http://127.0.0.1:5294/test/fixtures/touch-review.html?loading", wait_until="networkidle")
        grid = page.locator("[data-browse-loading-grid]")
        grid.wait_for(state="visible")
        check = r"""() => {
          const grid = document.querySelector('[data-browse-loading-grid]');
          if (!grid) return false;
          const cols = getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length;
          const cards = [...grid.children];
          const last = cards.at(-1).getBoundingClientRect();
          return cards.length % cols === 0 && last.bottom >= innerHeight - 1
            && Math.abs(last.right - grid.getBoundingClientRect().right) < 2
            && document.documentElement.scrollWidth <= innerWidth;
        }"""
        page.wait_for_function(check)
        print({"viewport": [width, height], "cards": grid.locator("article").count()})
        page.screenshot(path=str(output / f"loading-{width}.png"))
        page.get_by_role("button", name="展开片库筛选条件").click()
        page.wait_for_function(check)
        page.get_by_role("button", name="收起片库筛选条件").click()
        page.wait_for_function(check)
        # Rotate without reloading: the same mounted skeleton must adapt.
        page.set_viewport_size({"width": height, "height": width})
        page.wait_for_function(check)
    assert not errors, errors
    browser.close()
