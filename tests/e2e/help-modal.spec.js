import { test, expect } from '@playwright/test';

test.describe('Help modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('modal is hidden by default', async ({ page }) => {
    const modal = page.locator('#help-modal');
    await expect(modal).not.toHaveClass(/visible/);
  });

  test('clicking help button opens modal', async ({ page }) => {
    await page.locator('#help-btn').click();
    await expect(page.locator('#help-modal')).toHaveClass(/visible/);
  });

  test('clicking close button closes modal', async ({ page }) => {
    await page.locator('#help-btn').click();
    await expect(page.locator('#help-modal')).toHaveClass(/visible/);

    await page.locator('#help-close').click();
    await expect(page.locator('#help-modal')).not.toHaveClass(/visible/);
  });

  test('Escape key closes modal', async ({ page }) => {
    await page.locator('#help-btn').click();
    await expect(page.locator('#help-modal')).toHaveClass(/visible/);

    await page.keyboard.press('Escape');
    await expect(page.locator('#help-modal')).not.toHaveClass(/visible/);
  });

  test('clicking backdrop closes modal', async ({ page }) => {
    await page.locator('#help-btn').click();
    await expect(page.locator('#help-modal')).toHaveClass(/visible/);

    // Click on the modal backdrop (top-left corner, outside content)
    await page.locator('#help-modal').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#help-modal')).not.toHaveClass(/visible/);
  });
});
