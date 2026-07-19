import { expect, test } from '@playwright/test'

for (const shortcut of ['Meta+K', 'Meta+Shift+K']) {
  test(`${shortcut} opens commands from the focused editor`, async ({ page }) => {
    await page.goto('/?agent-links=1')
    const editor = page.getByRole('textbox', { name: 'Single page source' })
    await editor.focus()
    await expect(editor).toBeFocused()

    await page.keyboard.press(shortcut)

    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await expect(palette.locator('.search-input')).toBeFocused()
  })
}
