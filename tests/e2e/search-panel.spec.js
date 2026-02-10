import { test, expect } from '@playwright/test';

test.describe('Search panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('search inputs and buttons exist', async ({ page }) => {
    await expect(page.locator('#search-name')).toBeVisible();
    await expect(page.locator('#search-fclass')).toBeVisible();
    await expect(page.locator('#search-ref')).toBeVisible();
    await expect(page.locator('#search-btn')).toBeVisible();
    await expect(page.locator('#clear-btn')).toBeVisible();
  });

  test('clear button resets inputs', async ({ page }) => {
    await page.locator('#search-name').fill('test');
    await page.locator('#search-ref').fill('1');

    await page.locator('#clear-btn').click();

    await expect(page.locator('#search-name')).toHaveValue('');
    await expect(page.locator('#search-ref')).toHaveValue('');
    await expect(page.locator('#search-result')).toHaveText('');
  });

  test('fclass dropdown has correct options', async ({ page }) => {
    const options = page.locator('#search-fclass option');
    await expect(options).toHaveCount(5); // empty + 4 fclasses
    await expect(options.nth(0)).toHaveAttribute('value', '');
    await expect(options.nth(1)).toHaveAttribute('value', 'motorway');
    await expect(options.nth(2)).toHaveAttribute('value', 'trunk');
    await expect(options.nth(3)).toHaveAttribute('value', 'primary');
    await expect(options.nth(4)).toHaveAttribute('value', 'secondary');
  });

  test('searching for non-existent name shows no results', async ({ page }) => {
    // Wait for motorway data to load first
    await expect(
      page.locator('.legend-item[data-fclass="motorway"] .legend-status')
    ).toHaveText('', { timeout: 60000 });

    await page.locator('#search-name').fill('存在しない道路XXXYYY');
    await page.locator('#search-btn').click();

    await expect(page.locator('#search-result')).toHaveText('該当なし');
  });

  test('searching for existing road name shows results', async ({ page }) => {
    test.setTimeout(120000);

    // Wait for motorway data to load
    await expect(
      page.locator('.legend-item[data-fclass="motorway"] .legend-status')
    ).toHaveText('', { timeout: 90000 });

    // "東名" should match motorway data (東名高速道路, 新東名高速道路)
    await page.locator('#search-name').fill('東名');
    await page.locator('#search-btn').click();

    await expect(page.locator('#search-result')).toContainText('検索結果');
  });
});
