// QA test script for Branch Continue
import { chromium } from '@playwright/test';

const URL = 'http://localhost:5180';
const SCREENSHOT_DIR = '.gstack/qa-reports/screenshots';

const results = {
  consoleErrors: [],
  consoleWarnings: [],
  screenshots: [],
  tests: [],
};

function log(label, pass, detail = '') {
  const status = pass ? 'PASS' : 'FAIL';
  results.tests.push({ label, status, detail });
  console.log(`[${status}] ${label}${detail ? ' — ' + detail : ''}`);
}

async function screenshot(page, name) {
  const path = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  results.screenshots.push(path);
  return path;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Collect console messages
  page.on('console', (msg) => {
    if (msg.type() === 'error') results.consoleErrors.push(msg.text());
    if (msg.type() === 'warning') results.consoleWarnings.push(msg.text());
  });

  page.on('pageerror', (err) => {
    results.consoleErrors.push(`PAGE ERROR: ${err.message}`);
  });

  // === Phase 1: Initial Load ===
  console.log('\n=== Phase 1: Initial Load ===');
  try {
    const response = await page.goto(URL, { waitUntil: 'networkidle', timeout: 15000 });
    log('Page loads', response?.ok(), `status ${response?.status()}`);
  } catch (e) {
    log('Page loads', false, e.message);
  }

  await page.waitForTimeout(2000); // Wait for WASM init
  await screenshot(page, '01-initial-load');

  // Check for error overlay
  const hasErrorOverlay = await page.locator('vite-error-overlay').count();
  log('No Vite error overlay', hasErrorOverlay === 0, hasErrorOverlay > 0 ? 'Vite error overlay present' : '');

  // Check page title
  const title = await page.title();
  log('Page title correct', title === 'Branch Continue', `got: "${title}"`);

  // Check visible content
  const bodyText = await page.textContent('body');
  log('Body has content', bodyText && bodyText.trim().length > 0, `length: ${bodyText?.trim().length}`);

  // === Phase 2: Empty State ===
  console.log('\n=== Phase 2: Empty State ===');

  const hasEmptyState = await page.locator('.empty-state').count();
  log('Empty state shown', hasEmptyState > 0);

  const hasNewPageBtn = await page.locator('.btn-create').count();
  log('"New Page" button visible', hasNewPageBtn > 0);

  const hasSidebar = await page.locator('.sidebar').count();
  log('Sidebar present', hasSidebar > 0);

  const hasLoading = await page.locator('.loading').count();
  const isStuckLoading = hasLoading > 0 && hasEmptyState === 0;
  log('Not stuck on loading', !isStuckLoading, isStuckLoading ? 'Stuck on "Loading..."' : '');

  await screenshot(page, '02-empty-state');

  // === Phase 3: Create Page ===
  console.log('\n=== Phase 3: Create Page ===');

  if (hasNewPageBtn > 0) {
    await page.click('.btn-create');
    await page.waitForTimeout(1500);
    await screenshot(page, '03-after-create-page');

    const hasEditor = await page.locator('.editor').count();
    log('Editor appears after create', hasEditor > 0);

    const hasTitleInput = await page.locator('.editor-title').count();
    log('Title input present', hasTitleInput > 0);

    const hasTextarea = await page.locator('.editor-content').count();
    log('Content textarea present', hasTextarea > 0);

    const hasBranchBtn = await page.locator('.btn-branch').count();
    log('Branch button present', hasBranchBtn > 0);

    // Check sidebar updated
    const sidebarItems = await page.locator('.sidebar-item').count();
    log('Page appears in sidebar', sidebarItems > 0, `count: ${sidebarItems}`);
  } else {
    log('Create page flow', false, 'No create button found');
  }

  // === Phase 4: Edit Content ===
  console.log('\n=== Phase 4: Edit Content ===');

  const textarea = page.locator('.editor-content');
  if (await textarea.count() > 0) {
    await textarea.fill('# Hello World\n\nThis is a test page.');
    await page.waitForTimeout(1000); // Wait for debounce save
    log('Content editable', true);
    await screenshot(page, '04-content-edited');
  } else {
    log('Content editable', false, 'No textarea found');
  }

  // === Phase 5: Edit Title ===
  console.log('\n=== Phase 5: Edit Title ===');

  const titleInput = page.locator('.editor-title');
  if (await titleInput.count() > 0) {
    await titleInput.fill('My Test Page');
    await titleInput.blur();
    await page.waitForTimeout(500);

    // Check sidebar updated
    const sidebarText = await page.locator('.sidebar-item').first().textContent();
    log('Title updates sidebar', sidebarText?.includes('My Test Page'), `sidebar text: "${sidebarText}"`);
    await screenshot(page, '05-title-edited');
  } else {
    log('Title editable', false, 'No title input found');
  }

  // === Phase 6: Branch Page ===
  console.log('\n=== Phase 6: Branch Page ===');

  const branchBtn = page.locator('.btn-branch');
  if (await branchBtn.count() > 0) {
    await branchBtn.click();
    await page.waitForTimeout(1500);

    const sidebarItems = await page.locator('.sidebar-item').count();
    log('Branch creates new page', sidebarItems >= 2, `sidebar items: ${sidebarItems}`);

    // Check child has parent's content
    const content = await page.locator('.editor-content').inputValue();
    log('Branch copies content', content.includes('Hello World'), `content length: ${content.length}`);

    await screenshot(page, '06-branched-page');
  } else {
    log('Branch flow', false, 'No branch button found');
  }

  // === Phase 7: Page Navigation ===
  console.log('\n=== Phase 7: Page Navigation ===');

  const firstSidebarItem = page.locator('.sidebar-item').first();
  if (await firstSidebarItem.count() > 0) {
    await firstSidebarItem.click();
    await page.waitForTimeout(500);

    const activeItem = await page.locator('.sidebar-item.active').count();
    log('Active page highlighted in sidebar', activeItem > 0);

    await screenshot(page, '07-navigation');
  }

  // === Phase 8: Search (Cmd+K) ===
  console.log('\n=== Phase 8: Search (Cmd+K) ===');

  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(500);

  const searchModal = await page.locator('.search-overlay').count();
  log('Cmd+K opens search modal', searchModal > 0);

  if (searchModal > 0) {
    await screenshot(page, '08-search-open');

    const searchInput = page.locator('.search-input');
    await searchInput.fill('Test');
    await page.waitForTimeout(300);

    const searchResults = await page.locator('.search-result').count();
    log('Search returns results', searchResults > 0, `results: ${searchResults}`);

    await screenshot(page, '09-search-results');

    // Close with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const searchClosed = await page.locator('.search-overlay').count();
    log('Escape closes search', searchClosed === 0);
  }

  // === Phase 9: Sidebar "+ New" button ===
  console.log('\n=== Phase 9: Sidebar New Button ===');

  const sidebarNewBtn = page.locator('.btn-new');
  if (await sidebarNewBtn.count() > 0) {
    const itemsBefore = await page.locator('.sidebar-item').count();
    await sidebarNewBtn.click();
    await page.waitForTimeout(1000);
    const itemsAfter = await page.locator('.sidebar-item').count();
    log('Sidebar "+ New" creates page', itemsAfter > itemsBefore, `before: ${itemsBefore}, after: ${itemsAfter}`);
    await screenshot(page, '10-sidebar-new');
  }

  // === Phase 10: Responsive ===
  console.log('\n=== Phase 10: Responsive ===');

  // Mobile
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  await screenshot(page, '11-mobile-375');
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > 375);
  log('No horizontal overflow at 375px', !mobileOverflow);

  // Tablet
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(500);
  await screenshot(page, '12-tablet-768');

  // Back to desktop
  await page.setViewportSize({ width: 1440, height: 900 });

  // === Summary ===
  console.log('\n=== Console Errors ===');
  results.consoleErrors.forEach((e) => console.log(`  ERROR: ${e}`));
  if (results.consoleErrors.length === 0) console.log('  (none)');

  console.log('\n=== Console Warnings ===');
  results.consoleWarnings.forEach((w) => console.log(`  WARN: ${w}`));
  if (results.consoleWarnings.length === 0) console.log('  (none)');

  console.log('\n=== Test Summary ===');
  const passed = results.tests.filter((t) => t.status === 'PASS').length;
  const failed = results.tests.filter((t) => t.status === 'FAIL').length;
  console.log(`${passed} passed, ${failed} failed out of ${results.tests.length} tests`);
  console.log(`Screenshots: ${results.screenshots.length} saved`);
  console.log(`Console errors: ${results.consoleErrors.length}`);

  // Write JSON results
  const fs = await import('fs');
  fs.writeFileSync('.gstack/qa-reports/qa-results.json', JSON.stringify(results, null, 2));

  await browser.close();
})();
