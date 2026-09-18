"""Isolated collection rendering: no account reads or writes."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

output = Path('.local-data/favorites-review')
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width, height in [(360,800), (390,844), (768,1024), (1024,768)]:
        page = browser.new_page(viewport={'width':width,'height':height}, has_touch=True)
        page.route('**/api/posters/fixture.webp', lambda route: route.fulfill(content_type='image/svg+xml', body='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#12594c"/><text x="35" y="150" fill="white">Test poster</text></svg>'))
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto('http://127.0.0.1:5293/test/fixtures/touch-review.html?collection', wait_until='networkidle')
        tab = page.get_by_role('tab', name='想看 953')
        tab.scroll_into_view_if_needed()
        tablist = tab.locator('..')
        for item in tablist.get_by_role('tab').all():
            box = item.bounding_box()
            assert box['x'] >= 0 and box['x'] + box['width'] <= width, box
        card = page.locator('article').first
        card.scroll_into_view_if_needed()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert card.evaluate('(el) => el.scrollWidth <= el.clientWidth'), 'card overflow'
        expect(card.locator('img')).to_be_visible()
        assert card.locator('img').evaluate('(img) => img.complete && img.naturalWidth > 0')
        page.screenshot(path=str(output / f'collection-{width}.png'))
        detail = card.get_by_role('link', name='查看详情', exact=False).last
        assert detail.get_attribute('href').startswith('?detail=')
        detail.tap()
        expect(page.locator('[data-detail-back]')).to_be_visible()
        assert not errors, errors
        print(f'PASS {width}x{height}: tabs, overflow, poster, detail navigation')
        page.close()
    browser.close()
