import { test, expect } from './fixtures.js';

test.describe('Legend', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('motorway and trunk are checked by default, primary and secondary are not', async ({ page }) => {
    await expect(page.locator('.legend-item[data-fclass="motorway"] input[type="checkbox"]')).toBeChecked();
    await expect(page.locator('.legend-item[data-fclass="trunk"] input[type="checkbox"]')).toBeChecked();
    await expect(page.locator('.legend-item[data-fclass="primary"] input[type="checkbox"]')).not.toBeChecked();
    await expect(page.locator('.legend-item[data-fclass="secondary"] input[type="checkbox"]')).not.toBeChecked();
  });

  test('legend lines have background color set', async ({ page }) => {
    // Wait for JS to apply styles
    await expect(
      page.locator('.legend-item[data-fclass="motorway"] .legend-status')
    ).toHaveText('');

    const lines = page.locator('.legend-line');
    const count = await lines.count();
    for (let i = 0; i < count; i++) {
      const bg = await lines.nth(i).evaluate(el => el.style.background);
      expect(bg).toBeTruthy();
    }
  });

  test('checking primary triggers data loading', async ({ page }) => {
    const checkbox = page.locator('.legend-item[data-fclass="primary"] input[type="checkbox"]');
    const status = page.locator('.legend-item[data-fclass="primary"] .legend-status');

    await checkbox.check();

    // Should show loading text (confirming data fetch was triggered)
    await expect(status).toHaveText('読み込み中...');
  });

  test('checkbox can be toggled', async ({ page }) => {
    const checkbox = page.locator('.legend-item[data-fclass="motorway"] input[type="checkbox"]');

    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
  });
});
