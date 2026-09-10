const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    try {
        const context = await browser.newContext();
        context.setDefaultTimeout(10000);
        const page = await context.newPage();
        const base = process.env.AA_FORMS_URL || 'http://127.0.0.1:8765/';
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
        const go = file => page.goto(new URL(file, base).href);
        const progress = async (id, expected) => {
            await page.waitForFunction(({ id, expected }) =>
                (localStorage.getItem('aaforms:completed:' + id) === '1') === expected, { id, expected });
            const url = new URL(page.url());
            if (url.pathname.endsWith('/' + id) && url.searchParams.get('root') !== 'open') {
                assert.equal(await page.locator('#case-completion').innerText(), expected ? 'Completed' : 'Not completed');
            }
        };
        const result = async (scope = page) => {
            const value = JSON.parse(await scope.locator('#result').innerText());
            const url = new URL(page.url());
            if (url.searchParams.get('root') !== 'open') {
                await progress(url.pathname.split('/').pop(), value.status === 'passed');
            }
            return value;
        };
        async function supplier(scope) {
            await scope.getByLabel('Contact name').fill('Ada Torres');
            await scope.getByLabel('Department').selectOption('Procurement');
            await scope.getByLabel('Supplier code').fill('SUP-204');
            await scope.getByLabel('I accept the supplier terms').check();
            await scope.getByRole('button', { name: 'Save supplier' }).click();
            assert.equal((await result(scope)).status, 'passed');
            assert.equal(await scope.locator('#case-completion').innerText(), 'Completed');
        }

        await go('index.html');
        await page.evaluate(() => localStorage.setItem('aa_visited', '["form.html","case-closed.html"]'));
        await page.reload();
        assert.equal(await page.locator('#progress-count').innerText(), '0 of 8 completed');
        const order = ['form.html', 'vision-fallback.html', 'case-remount.html', 'case-f.html', 'case-recycled.html', 'case-canvas.html', 'case-closed.html', 'case-opaque.html'];
        assert.deepEqual(await page.locator('.sap-link').evaluateAll(links => links.map(link => link.getAttribute('href'))), order);
        const catalog = await page.context().newPage();
        await catalog.goto(new URL('index.html', base).href);
        await page.locator('.sap-link').first().click();
        await page.getByRole('link', { name: 'Back to Main Menu' }).click();
        assert.equal(new URL(page.url()).pathname.split('/').pop(), 'index.html');
        await page.locator('.sap-link').first().click();
        await progress('form.html', false);
        await page.locator('#submit-btn').click();
        await progress('form.html', false);
        await page.locator('#name').fill('Test Person');
        await page.locator('#country').fill('Peru');
        await page.locator('#feature').fill('Progress check');
        await page.locator('#other').check();
        await page.locator('#bot-type').selectOption({ label: 'Task Bot' });
        await page.locator('#submit-btn').click();
        await progress('form.html', true);
        await catalog.waitForFunction(() => document.getElementById('progress-count').textContent === '1 of 8 completed');
        const restored = await browser.newContext({ storageState: await context.storageState() });
        const restoredPage = await restored.newPage();
        await restoredPage.goto(new URL('index.html', base).href);
        assert.equal(await restoredPage.locator('#progress-count').innerText(), '1 of 8 completed');
        await restored.close();
        await page.reload();
        await progress('form.html', true);
        await page.locator('#reset-btn').click();
        await progress('form.html', false);
        await catalog.waitForFunction(() => document.getElementById('progress-count').textContent === '0 of 8 completed');

        await go('case-closed.html');
        assert.equal(await page.evaluate(() => document.getElementById('host').shadowRoot), null);
        assert.equal(await page.locator('input').count(), 0);
        // Use real keyboard input: ordinary selectors cannot enter the closed root.
        for (let run = 0; run < 2; run++) {
            if (run) { await page.reload(); await progress('case-closed.html', true); }
            await page.locator('#theme-toggle').focus();
            await page.keyboard.press('Tab');
            await page.keyboard.insertText('Ada Torres');
            await page.keyboard.press('Tab');
            await page.keyboard.press('p');
            await page.keyboard.press('Tab');
            await page.keyboard.insertText('SUP-204');
            await page.keyboard.press('Tab');
            await page.keyboard.press('Space');
            await page.keyboard.press('Tab');
            await page.keyboard.press('Enter');
            assert.equal((await result()).status, 'passed');
        }
        // Focus is still on Save supplier; the next control is Clear form.
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        await progress('case-closed.html', false);
        await go('case-closed.html?root=open');
        await supplier(page);
        await progress('case-closed.html', false);
        await page.getByRole('button', { name: 'Clear form' }).click();
        assert.equal(await page.getByLabel('Contact name').inputValue(), '');

        await go('case-opaque.html');
        await progress('case-opaque.html', false);
        await page.evaluate(() => window.postMessage({ type: 'aaforms-supplier-result', passed: true }, '*'));
        await progress('case-opaque.html', false);
        for (let run = 0; run < 2; run++) {
            if (run) {
                await page.getByRole('button', { name: 'Recreate frames' }).click();
                await progress('case-opaque.html', false);
            }
            const inner = page.frameLocator('#outer').frameLocator('iframe');
            await supplier(inner);
            assert.equal(await page.evaluate(() => document.getElementById('outer').contentDocument), null);
            const outer = page.frames().find(frame => frame.url() === 'about:srcdoc');
            assert.equal(await outer.evaluate(() => document.querySelector('iframe').contentDocument), null);
            const child = page.frames().find(frame => frame.url().includes('embedded=1'));
            assert.equal(await child.evaluate(() => document.getElementById('host').shadowRoot.mode), 'open');
        }
        await page.frameLocator('#outer').frameLocator('iframe').getByRole('button', { name: 'Clear form' }).click();
        await progress('case-opaque.html', false);
        await supplier(page.frameLocator('#outer').frameLocator('iframe'));
        await page.reload();
        await progress('case-opaque.html', true);

        await go('case-recycled.html');
        assert.equal(await page.locator('input').count(), 6);
        assert.equal(await page.getByLabel('INV-1042 amount').count(), 0);
        const firstNode = await page.locator('#slot-0').elementHandle();
        async function scrollTo(index) {
            await page.locator('#viewport').evaluate((element, i) => { element.scrollTop = i * 48; }, index);
            await page.waitForFunction(i => document.querySelector('#pool label').textContent === `INV-${1000 + i} amount`, index);
        }
        await scrollTo(42);
        assert.equal(await firstNode.evaluate(node => node === document.getElementById('slot-0')), true);
        await page.getByLabel('INV-1042 amount').fill('275.50');
        await scrollTo(70);
        await scrollTo(42);
        assert.equal(await page.getByLabel('INV-1042 amount').inputValue(), '275.50');
        await page.getByRole('button', { name: 'Submit invoice batch' }).click();
        assert.equal((await result()).status, 'passed');
        await page.getByRole('button', { name: 'Reset batch' }).click();
        await progress('case-recycled.html', false);
        await scrollTo(43);
        await firstNode.fill('275.50');
        await page.getByRole('button', { name: 'Submit invoice batch' }).click();
        assert.deepEqual(await result(), { status: 'failed', edits: [{ invoice: 'INV-1043', amount: '275.50' }] });
        await scrollTo(114);
        await page.getByLabel('INV-1119 amount').fill('1');
        await page.getByRole('button', { name: 'Reset batch' }).click();
        await page.getByRole('button', { name: 'Submit invoice batch' }).click();
        assert.deepEqual((await result()).edits, []);

        await go('case-remount.html');
        const oldRegion = await page.getByLabel('Region', { exact: true }).getAttribute('id');
        await page.getByLabel('Region', { exact: true }).selectOption('Chile');
        const loading = await page.getByLabel('Supplier', { exact: true }).elementHandle();
        assert.equal(await page.getByRole('button', { name: 'Continue' }).isDisabled(), true);
        await page.getByLabel('Region', { exact: true }).selectOption('Peru');
        await page.getByLabel('Supplier', { exact: true }).selectOption('Lima Parts');
        assert.equal(await loading.evaluate(node => node.isConnected), false);
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByLabel('Order reference').evaluate(node => { node.value = 'PO-2048'; });
        await page.getByLabel('Units').evaluate(node => { node.value = '3'; });
        await page.getByRole('button', { name: 'Place order' }).click();
        assert.equal((await result()).status, 'failed');
        await page.getByLabel('Order reference').fill('');
        await page.getByLabel('Order reference').fill('PO-2048');
        await page.getByLabel('Units').fill('');
        await page.getByLabel('Units').fill('3');
        await page.getByRole('button', { name: 'Place order' }).click();
        assert.equal((await result()).status, 'passed');
        await page.getByRole('button', { name: 'Reset order' }).click();
        await progress('case-remount.html', false);
        assert.notEqual(await page.getByLabel('Region', { exact: true }).getAttribute('id'), oldRegion);
        await page.getByLabel('Region', { exact: true }).selectOption('Chile');
        await page.getByRole('button', { name: 'Reset order' }).click();
        // The fixture's only timer is 450 ms; ensure reset cancels that pending update.
        await page.waitForTimeout(550);
        assert.equal(await page.getByLabel('Supplier', { exact: true }).isDisabled(), true);
        assert.equal(await page.getByLabel('Region', { exact: true }).inputValue(), '');

        await go('case-canvas.html');
        assert.equal(await page.locator('canvas *').count(), 0);
        await page.getByLabel('Passenger name').fill('Ada Torres');
        const canvas = page.locator('canvas');
        const bounds = await canvas.boundingBox();
        const seatB3 = { x: bounds.width * 300 / 480, y: bounds.height * 120 / 240 };
        await canvas.click({ position: seatB3 });
        await page.getByRole('button', { name: 'Reserve seat', exact: true }).click();
        assert.equal((await result()).status, 'passed');
        await page.getByRole('button', { name: 'Clear reservation' }).click();
        await progress('case-canvas.html', false);
        await page.getByRole('button', { name: 'Reverse seat layout' }).click();
        await page.getByLabel('Passenger name').fill('Ada Torres');
        await canvas.click({ position: seatB3 });
        await page.getByRole('button', { name: 'Reserve seat', exact: true }).click();
        assert.equal((await result()).status, 'failed');
        assert.equal((await result()).seat, 'B2');
        await canvas.focus();
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Space');
        await page.getByRole('button', { name: 'Reserve seat', exact: true }).click();
        assert.equal((await result()).status, 'passed');

        await go('case-f.html');
        for (let run = 0; run < 2; run++) {
            const editor = page.getByRole('textbox', { name: 'Contract document' });
            const old = await editor.elementHandle();
            await editor.locator('strong, em').click();
            await page.keyboard.press('Home');
            for (let index = 0; index < 'Quantity: '.length; index++) await page.keyboard.press('ArrowRight');
            await page.keyboard.press('Shift+ArrowRight');
            await page.keyboard.insertText('3');
            await page.getByRole('button', { name: 'Save amendment' }).click();
            assert.equal((await result()).status, 'passed');
            await page.getByRole('button', { name: 'Rebuild editor' }).click();
            await progress('case-f.html', false);
            assert.equal(await old.evaluate(node => node.isConnected), false);
        }
        await page.getByRole('textbox').fill('Contract CT-2048 Quantity: 3 units Delivery: Lima');
        await page.getByRole('button', { name: 'Save amendment' }).click();
        assert.equal((await result()).status, 'failed');
        await page.getByRole('button', { name: 'Rebuild editor' }).click();
        await page.getByRole('textbox').locator('strong, em').evaluate(node => { node.textContent = '3'; });
        await page.getByRole('button', { name: 'Save amendment' }).click();
        assert.equal((await result()).status, 'failed');

        await go('vision-fallback.html');
        assert.equal(await page.locator('#decoys button').count(), 1800);
        const targetRow = () => page.locator('#queue li').filter({ hasText: 'INV-2048Acme PartsUSD 275.50' });
        await targetRow().getByRole('button').click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#result').innerText(), 'Waiting for an approval.');
        await targetRow().getByRole('button').click();
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
        assert.equal(await page.locator('#result').innerText(), 'Waiting for an approval.');
        const oldButton = await targetRow().getByRole('button').elementHandle();
        for (let run = 0; run < 2; run++) {
            await targetRow().getByRole('button').click();
            assert.equal(await page.locator('#confirm-record').innerText(), 'INV-2048 / Acme Parts / USD 275.50');
            await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
            await page.waitForFunction(() => document.getElementById('result').textContent.startsWith('{'));
            assert.equal((await result()).status, 'passed');
            await page.getByRole('button', { name: 'Reset and reverse queue' }).click();
            await progress('vision-fallback.html', false);
        }
        assert.equal(await oldButton.evaluate(node => node.isConnected), false);
        await page.locator('#queue li').first().getByRole('button').click();
        await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('result').textContent.startsWith('{'));
        assert.equal((await result()).status, 'failed');
        await targetRow().getByRole('button').click();
        await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
        await page.waitForFunction(() => JSON.parse(document.getElementById('result').textContent).approved.length === 2);
        assert.equal((await result()).status, 'failed');

        await go('index.html');
        assert.equal(await page.locator('.readme').count(), 0);
        assert.equal(await page.locator('.catalog').count(), 1);
        assert.equal(await page.locator('.sap-link').count(), 8);
        assert.equal(await page.locator('.sap-link').first().getAttribute('href'), 'form.html');
        assert.equal(await page.locator('#hard-cases').count(), 0);
        await page.locator('.sap-link').first().click();
        await go('index.html');
        assert.equal(await page.locator('.sap-link').first().evaluate(link => link.classList.contains('completed')), false);
        assert.equal(await page.locator('#progress-count').innerText(), '2 of 8 completed');
        await page.getByRole('button', { name: 'Reset progress' }).click();
        assert.equal(await page.locator('.sap-link.completed').count(), 0);
        assert.equal(await page.locator('#progress-count').innerText(), '0 of 8 completed');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('aa_people_list')).length), 3);
        await catalog.waitForFunction(() => document.getElementById('progress-count').textContent === '0 of 8 completed');
        await catalog.close();
        for (const href of await page.locator('a[href]').evaluateAll(links => links.map(link => link.getAttribute('href')))) {
            assert.equal((await page.request.get(new URL(href, base).href)).ok(), true, href);
        }
        const routes = ['index', 'case-closed', 'case-opaque', 'case-recycled', 'case-remount', 'case-canvas', 'case-f', 'vision-fallback'];
        if (process.env.AA_SCREENSHOTS) await mkdir(process.env.AA_SCREENSHOTS, { recursive: true });
        for (const width of [1280, 390]) {
            await page.setViewportSize({ width, height: 900 });
            for (const route of routes) {
                await go(`${route}.html`);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} at ${width}px`);
                if (route === 'case-opaque') await page.frameLocator('#outer').frameLocator('iframe').getByLabel('Contact name').waitFor();
                if (process.env.AA_SCREENSHOTS) await page.screenshot({ path: `${process.env.AA_SCREENSHOTS}/${route}-${width}.png`, fullPage: true });
            }
        }
        const blocked = await browser.newContext();
        await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', {
            get() { throw new DOMException('Storage blocked', 'SecurityError'); }
        }));
        const blockedPage = await blocked.newPage();
        blockedPage.on('pageerror', error => errors.push(error.message));
        await blockedPage.goto(new URL('index.html', base).href);
        await blockedPage.evaluate(() => AAProgress.set('form.html', true));
        assert.equal(await blockedPage.locator('#progress-count').innerText(), '0 of 8 completed');
        assert.match(await blockedPage.locator('#progress-storage-note').innerText(), /cannot be saved/);
        await blocked.close();
        assert.deepEqual(errors, []);
        console.log(`Catalog passed: eight cases, success-only progress, reload/tab persistence, resets, keyboard, links, desktop/mobile. Chromium ${browser.version()}.`);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
