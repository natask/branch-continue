import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined })
  })
  await page.route('**/codex/account', (route) => route.fulfill({ json: { account: { type: 'chatgpt', email: 'test@example.com' }, requiresOpenaiAuth: false } }))
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Choose File', exact: true }).click()
  await (await chooser).setFiles({ name: 'sheets.org', mimeType: 'text/plain', buffer: Buffer.from('* A quiet note\nThe writing stays in view.\n') })
  await page.getByRole('button', { name: 'New Note', exact: true }).click()
  await page.locator('textarea.note-editor-body').fill('A thought worth keeping.')
  await expect(page.locator('.note-editor .save-icon--saved')).toBeVisible()
})

test('page tools open as modal sheets and return focus without closing the note', async ({ page }, testInfo) => {
  const editor = page.locator('.note-editor')
  const body = editor.locator('textarea.note-editor-body')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.note-agent-composer')).toHaveCount(0)
  await expect(page.locator('.note-version-panel')).toHaveCount(0)

  for (const [triggerName, dialogName] of [['Enhance', 'Refine with Codex'], ['Versions', 'Version history'], ['Ideas', 'Ideas']] as const) {
    const trigger = editor.getByRole('button', { name: triggerName, exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: dialogName, exact: true })
    await expect(dialog).toBeVisible()
    await expect.poll(() => dialog.evaluate((element) => element.matches(':modal'))).toBe(true)
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    if (triggerName === 'Enhance') {
      await expect(dialog.getByLabel('Ask Codex to edit this page')).toBeFocused()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await expect(dialog.locator('summary').filter({ hasText: 'Instructions for this page' })).toBeFocused()
    }
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await dialog.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    const geometry = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: element.clientWidth, scrollWidth: element.scrollWidth }
    })
    const viewport = page.viewportSize()!
    expect(geometry.left).toBeGreaterThanOrEqual(0)
    expect(geometry.right).toBeLessThanOrEqual(viewport.width)
    expect(geometry.top).toBeGreaterThanOrEqual(0)
    expect(geometry.bottom).toBeLessThanOrEqual(viewport.height)
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width)
    await page.screenshot({ path: `test-results/sheet-${triggerName.toLowerCase()}-${testInfo.project.name}.png` })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(editor).toBeVisible()
    await expect(trigger).toBeFocused()
    await expect(body).toHaveValue('A thought worth keeping.')
  }
  await body.fill('Still writing after closing page tools.')
  await expect(editor.locator('.save-icon--saved')).toBeVisible()
})

test('a sheet closes from its backdrop and keeps the editor open', async ({ page }) => {
  const editor = page.locator('.note-editor')
  const trigger = editor.getByRole('button', { name: 'Versions', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Version history', exact: true })
  await expect(dialog).toBeVisible()
  const bounds = await dialog.boundingBox()
  // The small top inset belongs to the backdrop on both the desktop and phone.
  await page.mouse.click(Math.max(1, bounds!.x - 1), 1)
  await expect(dialog).toHaveCount(0)
  await expect(editor).toBeVisible()
  await expect(trigger).toBeFocused()
})
