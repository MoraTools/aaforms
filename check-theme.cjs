const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const { readFileSync, readdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { chromium } = require('playwright');

(async () => {
    for (const file of readdirSync(__dirname).filter(file => file.endsWith('.html'))) {
        const source = readFileSync(join(__dirname, file), 'utf8');
        const refs = [...source.matchAll(/(?:href|src)=["']([^"'$]+\.(?:css|js)(?:\?[^"']*)?)["']/g),
            ...source.matchAll(/new URL\('([^']+\.(?:css|js)(?:\?[^']*)?)'/g)];
        for (const [, ref] of refs) {
            if (/^(https?:)?\/\//.test(ref)) continue;
            const url = new URL(ref, 'http://fixture/');
            const digest = createHash('sha256').update(readFileSync(join(__dirname, url.pathname.slice(1)))).digest('hex').slice(0, 12);
            assert.equal(url.searchParams.get('v'), digest, `${file}: refresh the asset hash for ${url.pathname}`);
        }
    }
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    try {
        const context = await browser.newContext({ colorScheme: 'dark' });
        context.setDefaultTimeout(10000);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const base = process.env.AA_FORMS_URL || 'http://127.0.0.1:8765/';
        const go = file => page.goto(new URL(file, base).href);
        const check = (scope, mode) => scope.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode);
        await go('index.html');
        await check(page, 'dark');
        assert.equal(await page.evaluate(() => localStorage.getItem('aaforms:theme')), null);
        await page.emulateMedia({ colorScheme: 'light' });
        await check(page, 'light');
        await page.getByRole('button', { name: 'Switch to dark mode' }).click();
        await check(page, 'dark');
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.emulateMedia({ colorScheme: 'light' });
        await check(page, 'dark');
        await page.reload();
        await check(page, 'dark');

        const other = await context.newPage();
        await other.goto(new URL('form.html', base).href);
        await other.getByRole('button', { name: 'Switch to light mode' }).click();
        await check(page, 'light');
        await page.getByRole('button', { name: 'Use OS setting' }).click();
        await check(page, 'light');
        await check(other, 'dark'); // Each tab follows its own emulated OS setting.
        await page.emulateMedia({ colorScheme: 'dark' });
        await check(page, 'dark');
        await other.close();

        const routes = ['index', 'form', 'vision-fallback', 'case-remount', 'case-f', 'case-recycled', 'case-canvas', 'case-closed', 'case-opaque', 'expense-approval'];
        if (process.env.AA_SCREENSHOTS) await mkdir(process.env.AA_SCREENSHOTS, { recursive: true });
        for (const mode of ['dark', 'light']) {
            await page.evaluate(mode => localStorage.setItem('aaforms:theme', mode), mode);
            for (const width of [1280, 390]) {
                await page.setViewportSize({ width, height: 900 });
                for (const route of routes) {
                    await go(`${route}.html`);
                    await check(page, mode);
                    assert.equal(await page.locator('#theme-toggle').count(), 1);
                    const bounds = await page.locator('#theme-toggle').boundingBox();
                    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y < 56);
                    if (mode === 'dark') {
                        assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(16, 24, 32)');
                        assert.equal(await page.locator('h1').evaluate(element => getComputedStyle(element).color), 'rgb(165, 214, 255)');
                        for (const surface of await page.locator('.container, .card').all()) {
                            assert.equal(await surface.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(26, 37, 48)');
                        }
                    }
                    if (route === 'case-opaque') {
                        await page.frameLocator('#outer').frameLocator('iframe').getByLabel('Contact name').waitFor();
                        for (const frame of page.frames()) await check(frame, mode);
                    }
                    if (process.env.AA_SCREENSHOTS) await page.screenshot({ path: `${process.env.AA_SCREENSHOTS}/${route}-${mode}-${width}.png`, fullPage: true });
                }
            }
        }

        await go('case-opaque.html');
        const inner = page.frameLocator('#outer').frameLocator('iframe');
        await inner.getByLabel('Contact name').fill('Ada Torres');
        const node = await inner.getByLabel('Contact name').elementHandle();
        await page.getByRole('button', { name: 'Switch to dark mode' }).click();
        for (const frame of page.frames()) await check(frame, 'dark');
        assert.equal(await node.evaluate(element => element.isConnected), true);
        assert.equal(await inner.getByLabel('Contact name').inputValue(), 'Ada Torres');
        assert.equal(await inner.getByLabel('Contact name').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(18, 30, 41)');
        assert.equal(await page.evaluate(() => document.querySelector('#outer').contentDocument), null);

        await go('case-canvas.html');
        await page.getByLabel('Passenger name').fill('Ada Torres');
        const canvas = page.locator('canvas');
        await canvas.focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Space');
        const before = await canvas.evaluate(canvas => canvas.toDataURL());
        await page.getByRole('button', { name: 'Switch to light mode' }).click();
        assert.notEqual(await canvas.evaluate(canvas => canvas.toDataURL()), before);
        assert.match(await page.locator('#seat-status').innerText(), /Selected: B3/);
        await page.getByRole('button', { name: 'Reserve seat', exact: true }).click();
        assert.equal(await page.locator('#case-completion').innerText(), 'Completed');
        await page.getByRole('button', { name: 'Switch to dark mode' }).click();
        assert.equal(await page.locator('#case-completion').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(23, 60, 42)');
        await go('index.html');
        await page.getByRole('button', { name: 'Reset progress' }).click();
        await check(page, 'dark');
        assert.equal(await page.evaluate(() => localStorage.getItem('aaforms:theme')), 'dark');
        assert.deepEqual(errors, []);
        console.log(`Theme checks passed: OS default/change, saved toggle, OS reset, tab sync, all pages, frames, shadow fields, canvas, progress. Chromium ${browser.version()}.`);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
