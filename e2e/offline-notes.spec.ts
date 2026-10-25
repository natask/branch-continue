import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('opens and saves notes with every external service blocked', async ({ page, baseURL }) => {
  const externalRequests: string[] = []
  const downloads: Promise<string>[] = []
  const origin = new URL(baseURL!).origin
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin === origin || !['http:', 'https:'].includes(url.protocol)) return route.continue()
    externalRequests.push(url.href)
    return route.abort('internetdisconnected')
  })
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined })
  })
  page.on('download', (download) => {
    downloads.push(download.path().then((path) => readFile(path!, 'utf8')))
  })

  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Choose File', exact: true }).click()
  await (await chooser).setFiles({
    name: 'offline.org', mimeType: 'text/plain',
    buffer: Buffer.from('* Existing note\nKeep this text.\n'),
  })
  await page.getByRole('button', { name: 'New Note', exact: true }).click()
  const editor = page.locator('.note-editor')
  await editor.locator('textarea.note-editor-body').fill('Written without a server.')
  await expect(editor.locator('.save-icon--saved')).toBeVisible()
  await expect.poll(() => downloads.length).toBeGreaterThan(0)
  const savedFiles = await Promise.all(downloads)
  expect(savedFiles.some((content) => content.includes('Written without a server.'))).toBe(true)
  expect(savedFiles.at(-1)).toContain('Keep this text.')

  await editor.getByRole('button', { name: 'Versions', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Version history', exact: true })).toBeVisible()
  expect(externalRequests).toEqual([])
})
