import { test, expect } from '@playwright/test';

test('landing page renders correctly', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('button.btn-primary')).toBeVisible();
  await page.screenshot({ path: `test-results/landing-${test.info().project.name}.png`, fullPage: true });
  await expect(page).toHaveScreenshot({ fullPage: true });
});
