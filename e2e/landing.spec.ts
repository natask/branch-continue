import { test, expect } from '@playwright/test';

test('landing page renders correctly', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make room for your next thought.' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Choose File', exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/landing-${test.info().project.name}.png`, fullPage: true });
  await expect(page).toHaveScreenshot({ fullPage: true });
});
