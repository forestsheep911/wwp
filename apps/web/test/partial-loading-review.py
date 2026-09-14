from pathlib import Path
from playwright.sync_api import sync_playwright, expect

output = Path(".local-data/loading-grid-review")
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width, height in [(390, 844), (768, 1024), (1024, 768), (1920, 1080), (2560, 1440)]:
        page = browser.new_page(viewport={"width": width, "height": height}, has_touch=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:5294/test/fixtures/touch-review.html?partial", wait_until="networkidle")
        grid = page.locator("[data-browse-loading-grid]")
        expect(grid).to_be_visible()
        page.wait_for_function(r"""() => {
          const grid = document.querySelector('[data-browse-loading-grid]');
          const cards = [...grid.children].filter(el => el.getBoundingClientRect().height > 0);
          const cols = getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length;
          return cards.length % cols === 0 && cards.at(-1).getBoundingClientRect().bottom >= innerHeight;
        }""")
        placeholders = grid.locator("[data-loading-placeholder]")
        if width >= 1920:
            assert placeholders.count() > 0
        page.screenshot(path=str(output / f"partial-{width}.png"))
        # Already-loaded films are still actionable while more data is pending.
        card = page.locator(".movie-card a").first if width < 768 else page.locator("[data-gallery-card]").first
        card.click()
        expect(page.locator("[data-detail-back]")).to_be_visible()
        page.locator("[data-detail-back]").click()
        page.get_by_role("button", name="Fail fixture").click()
        expect(placeholders).to_have_count(0)
        expect(grid.locator("[data-gallery-card]")).to_have_count(12)
        page.get_by_role("button", name="Retry fixture").click()
        if width >= 1920:
            expect(placeholders.first).to_be_attached()
        page.get_by_role("button", name="Finish fixture").click()
        expect(placeholders).to_have_count(0)
        assert not errors, errors
        print({"width": width, "passed": True})
        page.close()
    browser.close()
