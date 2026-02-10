import { test, expect } from '@playwright/test';

test.describe('App load', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page title is correct', async ({ page }) => {
    await expect(page).toHaveTitle(/道路閲覧検索アプリ/);
  });

  test('main UI elements exist', async ({ page }) => {
    await expect(page.locator('#map')).toBeVisible();
    await expect(page.locator('#controls')).toBeVisible();
    await expect(page.locator('#legend')).toBeVisible();
    await expect(page.locator('#help-btn')).toBeVisible();
    await expect(page.locator('#search-panel')).toBeVisible();
  });

  test('legend has 4 items', async ({ page }) => {
    const items = page.locator('.legend-item');
    await expect(items).toHaveCount(4);
  });

  test('maplibre canvas appears', async ({ page }) => {
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 });
  });

  test('default checked fclasses (motorway, trunk) load data', async ({ page }) => {
    // Wait for motorway data to finish loading (legend-status becomes empty)
    await expect(
      page.locator('.legend-item[data-fclass="motorway"] .legend-status')
    ).toHaveText('', { timeout: 60000 });

    await expect(
      page.locator('.legend-item[data-fclass="trunk"] .legend-status')
    ).toHaveText('', { timeout: 60000 });
  });
});
