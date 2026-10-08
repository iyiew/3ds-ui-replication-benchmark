import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateUrl(input) {
  const url = new URL(input);
  assert.ok(['http:', 'https:'].includes(url.protocol), 'Use an HTTP(S) candidate URL');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Capture is restricted to a locally served candidate');
  assert.ok(!url.username && !url.password, 'Do not put credentials in the candidate URL');
  return url.href;
}

export function parseArgs(args) {
  const options = { url: 'http://127.0.0.1:5173', out: 'runs/capture/evidence' };
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(['--url', '--out'].includes(args[i]) && args[i + 1], 'Usage: npm run capture -- --url LOCAL_URL --out NEW_DIRECTORY');
    options[args[i].slice(2)] = args[i + 1];
  }
  options.url = validateUrl(options.url);
  options.out = path.resolve(options.out);
  return options;
}

const norm = value => value.replace(/\s+/g, ' ').trim();

export async function collectEvidence(chromium, options, spec) {
  await mkdir(options.out, { recursive: true });
  assert.equal((await readdir(options.out)).length, 0, 'Output directory is not empty; choose a new directory to preserve evidence');
  const report = {
    benchmark: { id: spec.id, version: spec.version },
    url: options.url,
    viewports: { desktop: spec.capture.desktop, mobile: spec.capture.mobile },
    deviceScaleFactor: spec.capture.deviceScaleFactor,
    browser: null,
    checks: [],
    artifacts: [],
    errors: [],
    fatal: null,
  };
  let browser;
  const runCheck = async (id, action) => {
    try {
      await action();
      report.checks.push({ id, status: 'passed' });
      return true;
    } catch (error) {
      report.checks.push({ id, status: 'failed', detail: error.message });
      return false;
    }
  };
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BENCH_CHROMIUM_EXECUTABLE ? { executablePath: process.env.BENCH_CHROMIUM_EXECUTABLE } : {}) });
    report.browser = browser.version();
    const newPage = async (viewport, mobile = false) => {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: spec.capture.deviceScaleFactor,
        locale: spec.capture.locale,
        timezoneId: spec.capture.timezoneId,
        colorScheme: spec.capture.colorScheme,
        reducedMotion: spec.capture.reducedMotion,
        isMobile: mobile,
        hasTouch: mobile,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(2000);
      page.on('pageerror', error => report.errors.push({ viewport: mobile ? 'mobile' : 'desktop', type: 'pageerror', message: error.message }));
      page.on('console', msg => { if (msg.type() === 'error') report.errors.push({ viewport: mobile ? 'mobile' : 'desktop', type: 'console', message: msg.text() }); });
      page.on('requestfailed', request => report.errors.push({ viewport: mobile ? 'mobile' : 'desktop', type: 'requestfailed', url: request.url(), message: request.failure()?.errorText }));
      page.on('response', response => { if (response.status() >= 400) report.errors.push({ viewport: mobile ? 'mobile' : 'desktop', type: 'http', status: response.status(), url: response.url() }); });
      await page.goto(options.url, { waitUntil: 'networkidle', timeout: 20000 });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(Array.from(document.images).map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        })));
      });
      return { page, context };
    };
    const save = async (page, name, screenCrops = false) => {
      const filename = `${name}.png`;
      await page.screenshot({ path: path.join(options.out, filename), animations: 'disabled' });
      report.artifacts.push(filename);
      if (screenCrops) {
        for (const target of ['console', 'upper-screen', 'lower-screen']) {
          const locator = page.locator(`[data-bench="${target}"]`);
          if (await locator.count() === 1 && await locator.isVisible()) {
            const crop = `${name}-${target}.png`;
            await locator.screenshot({ path: path.join(options.out, crop), animations: 'disabled' });
            report.artifacts.push(crop);
          }
        }
      }
    };
    const visible = async (page, selector) => {
      const locator = page.locator(selector);
      assert.equal(await locator.count(), 1, `Expected one ${selector}`);
      assert.ok(await locator.isVisible(), `${selector} is not visible`);
      return locator;
    };
    const tile = (page, id) => page.locator(`[data-bench="software-tile"][data-app-id="${id}"]`);
    const selected = async page => {
      const locator = page.locator('[data-bench="software-tile"][aria-pressed="true"]');
      assert.equal(await locator.count(), 1, 'There must be exactly one selected software tile');
      return locator.getAttribute('data-app-id');
    };
    const assertPreview = async (page, id) => {
      assert.equal(await selected(page), id);
      assert.equal(norm(await page.locator('[data-bench="preview-title"]').innerText()), spec.interactionApps[id]);
    };
    const assertDialog = async (page, title) => {
      const dialog = await visible(page, '[data-bench="app-dialog"]');
      assert.ok(norm(await dialog.innerText()).includes(title), 'Dialog does not show the selected software title');
    };
    const assertReturned = async (page, id) => {
      const dialog = page.locator('[data-bench="app-dialog"]');
      assert.ok(await dialog.count() === 0 || !await dialog.isVisible(), 'App dialog stayed open');
      await assertPreview(page, id);
    };
    const desktop = await newPage(spec.capture.desktop);
    const page = desktop.page;
    const resetMenu = async () => { await page.goto(options.url, { waitUntil: 'networkidle', timeout: 20000 }); };
    await save(page, 'desktop-initial', true);
    const hasStructure = await runCheck('desktop-structure', async () => {
      for (const part of ['console', 'upper-screen', 'lower-screen', 'preview-title', 'open', 'home']) await visible(page, `[data-bench="${part}"]`);
      assert.equal(await page.locator('[data-bench="software-tile"]').count(), 28, 'Expected 28 primary software tiles');
      const ids = await page.locator('[data-bench="software-tile"]').evaluateAll(elements => elements.map(el => el.getAttribute('data-app-id')));
      assert.ok(ids.every(Boolean) && new Set(ids).size === 28, 'App IDs must be present and unique');
      assert.equal(ids[7], 'mario-64-ds', 'Mario should be row 2 column 1 in row-major DOM order');
      assert.equal(ids[15], 'nintendo-eshop', 'eShop should be row 3 column 2');
      assert.equal(ids[23], 'system-settings', 'Settings should be row 4 column 3');
    });
    await runCheck('desktop-initial-state', () => assertPreview(page, spec.initialState.selectedApp));
    await runCheck('desktop-framing', async () => {
      const box = await page.locator('[data-bench="console"]').boundingBox();
      assert.ok(box, 'Console has no visible bounds');
      assert.ok(Math.abs(box.width - spec.capture.desktopConsoleWidth) <= 35, 'Console width should be approximately 700px');
      assert.ok(Math.abs(box.x + box.width / 2 - spec.capture.desktop.width / 2) <= 6, 'Console is not horizontally centered');
      assert.ok(Math.abs(box.y + box.height / 2 - spec.capture.desktop.height / 2) <= 10, 'Console is not vertically centered');
      assert.ok(box.y >= 0 && box.y + box.height <= spec.capture.desktop.height, 'Console is clipped');
    });
    if (hasStructure) {
      await runCheck('click-eshop', async () => { await tile(page, 'nintendo-eshop').click(); await assertPreview(page, 'nintendo-eshop'); await save(page, 'desktop-eshop', true); });
      await runCheck('open-button', async () => { await page.locator('[data-bench="open"]').click(); await assertDialog(page, 'Nintendo eShop'); await save(page, 'desktop-open'); });
      await runCheck('back-button', async () => { await page.locator('[data-bench="back"]').click(); await assertReturned(page, 'nintendo-eshop'); await save(page, 'desktop-return'); });
      await runCheck('hardware-a-b-home', async () => {
        await resetMenu(); await tile(page, 'nintendo-eshop').click(); await assertPreview(page, 'nintendo-eshop');
        await page.locator('[data-control="a"]').click(); await assertDialog(page, 'Nintendo eShop');
        await page.locator('[data-control="b"]').click(); await assertReturned(page, 'nintendo-eshop');
        await page.locator('[data-control="a"]').click(); await assertDialog(page, 'Nintendo eShop');
        await page.locator('[data-bench="home"]').click(); await assertReturned(page, 'nintendo-eshop');
      });
      await runCheck('hardware-dpad', async () => {
        await resetMenu();
        await tile(page, 'mario-64-ds').click();
        const expected = await page.locator('[data-bench="software-tile"]').nth(8).getAttribute('data-app-id');
        await page.locator('[data-control="right"]').click(); assert.equal(await selected(page), expected);
        await page.locator('[data-control="left"]').click(); await assertPreview(page, 'mario-64-ds');
      });
      await runCheck('keyboard', async () => {
        await resetMenu();
        await tile(page, 'mario-64-ds').click();
        const expected = await page.locator('[data-bench="software-tile"]').nth(8).getAttribute('data-app-id');
        await page.keyboard.press('ArrowRight'); assert.equal(await selected(page), expected);
        await page.keyboard.press('ArrowLeft'); await assertPreview(page, 'mario-64-ds');
        await page.keyboard.press('Enter'); await assertDialog(page, 'Super Mario 64 DS');
        await page.keyboard.press('Escape'); await assertReturned(page, 'mario-64-ds');
      });
      await runCheck('click-settings', async () => { await resetMenu(); await tile(page, 'system-settings').click(); await assertPreview(page, 'system-settings'); await save(page, 'desktop-settings', true); });
    }
    await desktop.context.close();
    const mobile = await newPage(spec.capture.mobile, true);
    await save(mobile.page, 'mobile-initial', true);
    await runCheck('mobile-initial-state', () => assertPreview(mobile.page, spec.initialState.selectedApp));
    await runCheck('mobile-framing', async () => {
      const box = await mobile.page.locator('[data-bench="console"]').boundingBox();
      assert.ok(box, 'Console has no visible bounds');
      const viewport = spec.capture.mobile;
      assert.ok(box.x >= spec.capture.mobileMargin - 1 && box.x + box.width <= viewport.width - spec.capture.mobileMargin + 1, 'Console violates mobile margins');
      assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, 'Mobile console is clipped');
      assert.ok(Math.abs(box.x + box.width / 2 - viewport.width / 2) <= 6, 'Mobile console is not horizontally centered');
      assert.ok(Math.abs(box.y + box.height / 2 - viewport.height / 2) <= 10, 'Mobile console is not vertically centered');
      const scrollWidth = await mobile.page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(scrollWidth <= viewport.width, 'Mobile page has horizontal overflow');
    });
    if (hasStructure) {
      await runCheck('mobile-touch', async () => {
        await tile(mobile.page, 'nintendo-eshop').tap(); await assertPreview(mobile.page, 'nintendo-eshop');
        await mobile.page.locator('[data-bench="open"]').tap(); await assertDialog(mobile.page, 'Nintendo eShop');
        await mobile.page.locator('[data-bench="back"]').tap(); await assertReturned(mobile.page, 'nintendo-eshop');
        await save(mobile.page, 'mobile-return');
      });
    }
    await mobile.context.close();
    report.checks.push({ id: 'browser-errors', status: report.errors.length ? 'failed' : 'passed', ...(report.errors.length ? { detail: `${report.errors.length} browser/network errors; see errors` } : {}) });
  } catch (error) {
    report.fatal = error.message;
  } finally {
    await browser?.close();
    await writeFile(path.join(options.out, 'capture.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const spec = JSON.parse(await readFile(new URL('../benchmark.json', import.meta.url), 'utf8'));
    const { chromium } = await import('playwright');
    const report = await collectEvidence(chromium, options, spec);
    const failed = report.checks.filter(check => check.status === 'failed').length;
    console.log(JSON.stringify({ output: options.out, browser: report.browser, checks: report.checks.length, failed, fatal: report.fatal, artifacts: report.artifacts.length }, null, 2));
    if (failed || report.fatal) process.exitCode = 1;
  } catch (error) {
    console.error('Capture failed:', error.message);
    process.exitCode = 1;
  }
}
