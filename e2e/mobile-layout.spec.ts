import { expect, test } from '@playwright/test'

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Checks phone viewport geometry.')
})

for (const width of [320, 430]) {
  test(`note and commands fit a ${width}px phone with the keyboard open`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 })
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showOpenFilePicker', { value: undefined })
    })
    await page.goto('/')
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Choose File', exact: true }).click()
    await (await chooser).setFiles({ name: 'mobile-notes.org', mimeType: 'text/plain', buffer: Buffer.from('* Phone note\nA page to refine.\n') })
    await page.getByRole('button', { name: 'New Note', exact: true }).click()
    const editor = page.locator('.note-editor')
    await expect(editor).toBeVisible()
    await expect(page.locator('.app')).toHaveCSS('transform', 'none')

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--editor-keyboard-inset', '280px')
    })
    const geometry = await editor.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const shell = element.querySelector('.note-editor-shell')!
      return {
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        shellWidth: shell.clientWidth,
        contentWidth: shell.scrollWidth,
      }
    })
    expect(geometry.left).toBeGreaterThanOrEqual(0)
    expect(geometry.right).toBeLessThanOrEqual(width)
    expect(geometry.bottom).toBeLessThanOrEqual(460)
    expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.shellWidth)
    await page.screenshot({ path: `test-results/mobile-editor-${width}.png` })

    await editor.getByRole('button', { name: 'Enhance', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Refine with Codex', exact: true })
    await expect(sheet).toBeVisible()
    await sheet.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    const sheetGeometry = await sheet.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: element.clientWidth, contentWidth: element.scrollWidth }
    })
    expect(sheetGeometry.left).toBeGreaterThanOrEqual(0)
    expect(sheetGeometry.right).toBeLessThanOrEqual(width)
    expect(sheetGeometry.top).toBeGreaterThanOrEqual(0)
    expect(sheetGeometry.bottom).toBeLessThanOrEqual(460)
    expect(sheetGeometry.contentWidth).toBeLessThanOrEqual(sheetGeometry.width)
    await sheet.getByLabel('Ask Codex to edit this page').fill('Keep my meaning and make this clearer.')
    await expect(sheet.getByRole('button', { name: 'Run on note', exact: true })).toBeInViewport()
    await page.screenshot({ path: `test-results/mobile-sheet-${width}.png` })
    await sheet.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(editor).toBeVisible()

    const search = editor.getByRole('button', { name: 'Search', exact: true }).first()
    await search.scrollIntoViewIfNeeded()
    await search.click()
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    const paletteRect = await palette.boundingBox()
    expect(paletteRect!.x).toBeGreaterThanOrEqual(0)
    expect(paletteRect!.x + paletteRect!.width).toBeLessThanOrEqual(width)
    expect(paletteRect!.y + paletteRect!.height).toBeLessThanOrEqual(460)
    await page.screenshot({ path: `test-results/mobile-note-${width}.png` })
  })
}
