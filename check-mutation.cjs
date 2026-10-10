const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    try {
        const context = await browser.newContext({ colorScheme: 'light' });
        context.setDefaultTimeout(10000);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
        const base = process.env.AA_FORMS_URL || 'http://127.0.0.1:8765/';
        const go = file => page.goto(new URL(file, base).href);
        const current = () => page.getByRole('form', { name: 'Current order', exact: true });
        const reference = () => page.getByRole('form', { name: 'Reference order', exact: true });
        const expected = { contact: 'Ada Torres', email: 'ada@example.test', department: 'Procurement',
            reference: 'PO-2048', units: '3', city: 'Lima', notes: 'Ship together.', confirmation: true };
        const fieldLabels = ['Contact name', 'Email', 'Department', 'Order reference', 'Units', 'Delivery city', 'Notes', 'I confirm this synthetic order'];
        const controls = scope => scope.locator('input, select, textarea, button');
        const result = async () => JSON.parse(await page.locator('#result').innerText());
        async function fill(scope = current()) {
            for (const [label, value] of [['Contact name', expected.contact], ['Email', expected.email],
                ['Order reference', expected.reference], ['Units', expected.units], ['Notes', expected.notes]]) {
                await scope.getByLabel(label, { exact: true }).fill(value);
            }
            await scope.getByLabel('Department', { exact: true }).selectOption(expected.department);
            await scope.getByLabel('Delivery city', { exact: true }).selectOption(expected.city);
            await scope.getByLabel('I confirm this synthetic order', { exact: true }).check();
        }
        async function submit(scope = current()) { await scope.getByRole('button', { name: 'Submit order', exact: true }).click(); }
        async function empty(scope = current()) {
            assert.equal(await scope.locator('input, select, textarea').evaluateAll(nodes =>
                nodes.every(node => node.type === 'checkbox' ? !node.checked : node.value === '')), true);
        }
        async function completion(passed) {
            assert.equal(await page.locator('#case-completion').innerText(), passed ? 'Completed' : 'Not completed');
            assert.equal(await page.evaluate(() => AAProgress.isComplete('case-mutation.html')), passed);
        }
        async function waiting() {
            await empty();
            assert.equal(await page.locator('#result').innerText(), 'Waiting for an order.');
            assert.equal(await page.locator('#result').getAttribute('data-status'), null);
            await completion(false);
        }
        async function snapshot(scope = current()) {
            return scope.evaluate(form => [...form.querySelectorAll('input, select, textarea, button')].map(control => {
                let depth = 0;
                for (let parent = control.parentElement; parent && !parent.classList.contains('fields'); parent = parent.parentElement) depth++;
                const rect = control.getBoundingClientRect();
                return { label: control.type === 'submit' ? control.textContent : control.labels[0]?.textContent.trim(),
                    id: control.id, name: control.name, depth, x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width };
            }));
        }
        async function associations(scope = current()) {
            assert.equal(await scope.locator('input, select, textarea').evaluateAll(nodes => nodes.every(control =>
                control.id && control.name && control.labels.length === 1 && control.labels[0].htmlFor === control.id && control.labels[0].control === control)), true);
            const labels = (await snapshot(scope)).slice(0, 8).map(control => control.label);
            assert.deepEqual([...labels].sort(), [...fieldLabels].sort());
            assert.equal(await page.locator('[data-field]').count(), 0);
            assert.equal(await page.locator('[id]').evaluateAll(nodes => new Set(nodes.map(node => node.id)).size === nodes.length), true);
        }
        async function levelIs(level) {
            assert.match(await page.locator('#level-status').innerText(), new RegExp(`^Level ${level} of 6:`));
            assert.equal(await page.locator('#difficulty').getAttribute('max'), '6');
            assert.equal(await page.locator('#difficulty').evaluate(node => node.value), level);
            assert.equal(await page.locator('#obstacles li').count(), Math.max(level, 1));
            assert.equal(await page.getByRole('button', { name: 'Increase difficulty' }).isDisabled(), level === 6);
        }
        async function keyboardOrder() {
            const ids = await controls(current()).evaluateAll(nodes => nodes.map(node => node.id));
            await current().getByLabel((await snapshot())[0].label, { exact: true }).focus();
            for (const id of ids) {
                assert.equal(await page.evaluate(() => document.activeElement.id), id);
                await page.keyboard.press('Tab');
            }
        }
        async function boundsAndContrast() {
            const diagnostics = await page.evaluate(() => {
                const luminance = rgb => {
                    const channels = rgb.match(/\d+/g).slice(0, 3).map(value => Number(value) / 255)
                        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
                    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
                };
                const panel = luminance(getComputedStyle(document.querySelector('.container')).backgroundColor);
                const contrast = [];
                for (const field of document.querySelectorAll('.fields input:not([type="checkbox"]), .fields select, .fields textarea')) {
                    const style = getComputedStyle(field), border = luminance(style.borderTopColor);
                    contrast.push(...[luminance(style.backgroundColor), panel].map(background =>
                        (Math.max(border, background) + 0.05) / (Math.min(border, background) + 0.05)));
                }
                const failures = [];
                if (document.documentElement.scrollWidth > innerWidth) failures.push('Page overflow');
                for (const fields of document.querySelectorAll('.fields')) {
                    const rectangles = [...fields.children].map(group => group.getBoundingClientRect());
                    const sorted = [...rectangles].sort((a, b) => a.top - b.top || a.left - b.left);
                    if (!rectangles.every((rect, index) => rect === sorted[index])) failures.push('DOM and visual order differ');
                    rectangles.forEach((rect, index) => {
                        if (rect.left < 0 || rect.right > innerWidth || rect.width <= 0 || rect.height <= 0) failures.push('Field outside viewport');
                        for (const other of rectangles.slice(index + 1)) {
                            if (rect.left < other.right - 1 && rect.right > other.left + 1 && rect.top < other.bottom - 1 && rect.bottom > other.top + 1) failures.push('Overlapping groups');
                        }
                    });
                    for (const control of fields.querySelectorAll('input, select, textarea')) {
                        const rect = control.getBoundingClientRect();
                        if (rect.width < 20 || rect.height < 20 || rect.left < 0 || rect.right > innerWidth) failures.push('Unusable control');
                    }
                }
                return { contrast, failures };
            });
            assert.deepEqual(diagnostics.failures, []);
            assert.ok(diagnostics.contrast.length >= 14 && diagnostics.contrast.every(ratio => ratio >= 3), `Field boundary contrast: ${diagnostics.contrast}`);
        }

        await go('index.html');
        const catalogOrder = ['form.html', 'case-shifter.html', 'vision-fallback.html', 'case-navigation.html', 'case-remount.html', 'case-f.html',
            'case-recycled.html', 'case-mutation.html', 'case-canvas.html', 'case-closed.html', 'case-opaque.html'];
        assert.deepEqual(await page.locator('.sap-link').evaluateAll(links => links.map(link => link.getAttribute('href'))), catalogOrder);
        assert.equal(await page.locator('#progress-count').innerText(), '0 of 11 completed');
        assert.equal(await page.locator('#progress').getAttribute('max'), '11');
        await page.evaluate(() => AAProgress.set('case-shifter.html', true));
        await page.getByRole('button', { name: 'Switch to dark mode' }).click();
        await page.getByRole('link', { name: /8\. Mutation ladder/ }).click();
        await waiting();
        const baseline = await snapshot();
        const originalHandles = await controls(current()).elementHandles();
        let replacementHandles, renamedIDs;
        for (let level = 0; level <= 6; level++) {
            let previous;
            if (level) {
                previous = await snapshot();
                await page.getByRole('button', { name: 'Increase difficulty' }).click();
                await waiting();
            }
            await levelIs(level);
            await associations();
            const state = await snapshot();
            if (level <= 3) {
                for (const handle of originalHandles) assert.equal(await handle.evaluate(control => control === document.getElementById(control.id)), true);
                assert.deepEqual(state.map(control => [control.id, control.name]).sort(), baseline.map(control => [control.id, control.name]).sort());
            }
            if (level === 1) {
                assert.deepEqual(state.map(control => control.label), baseline.map(control => control.label));
                assert.ok(state.slice(0, 8).every(control => control.width !== baseline.find(item => item.label === control.label).width || control.x !== baseline.find(item => item.label === control.label).x));
                assert.deepEqual(state.map(control => control.depth), baseline.map(control => control.depth));
            }
            if (level >= 1) assert.equal(await current().locator('.fields').evaluate(node => node.classList.contains('shifted')), true);
            if (level >= 2) assert.notDeepEqual(state.map(control => control.label), baseline.map(control => control.label));
            if (level === 2) assert.ok(state.every(control => control.depth === previous.find(item => item.label === control.label).depth));
            if (level >= 3) {
                assert.ok(state.slice(0, 8).every(control => control.depth === baseline.find(item => item.label === control.label).depth + 2));
                assert.equal(await current().locator('.mutation-wrap').count(), 16);
            }
            if (level === 4) {
                for (const handle of originalHandles) assert.equal(await handle.evaluate(control => control.isConnected), false);
                assert.deepEqual(state.map(control => [control.id, control.name]), previous.map(control => [control.id, control.name]));
                replacementHandles = await controls(current()).elementHandles();
            }
            if (level >= 4) for (const handle of replacementHandles) assert.equal(await handle.evaluate(control => control.isConnected), true);
            if (level >= 5) {
                assert.ok(state.every(control => !baseline.some(item => item.id === control.id || item.name === control.name)));
                assert.equal(await current().evaluate(form => ['contact', 'email', 'department', 'reference', 'units', 'city', 'notes', 'confirmation', 'submit-order']
                    .every(id => !document.getElementById(id) && !form.elements.namedItem(id))), true);
                if (level === 5) renamedIDs = state.map(control => [control.id, control.name]);
                else assert.deepEqual(state.map(control => [control.id, control.name]), renamedIDs);
            }
            if (level === 6) {
                await empty(reference());
                await associations(reference());
                assert.deepEqual(await page.getByRole('form').evaluateAll(forms => forms.map(form => form.querySelector('h2').textContent)), ['Reference order', 'Current order']);
                for (const label of fieldLabels) assert.equal(await page.getByLabel(label, { exact: true }).count(), 2);
                assert.equal(await page.getByRole('button', { name: 'Submit order', exact: true }).count(), 2);
                await reference().locator('label').filter({ hasText: /^Contact name$/ }).click();
                assert.equal(await reference().getByLabel('Contact name', { exact: true }).evaluate(control => control === document.activeElement), true);
                await current().locator('label').filter({ hasText: /^Contact name$/ }).click();
                assert.equal(await current().getByLabel('Contact name', { exact: true }).evaluate(control => control === document.activeElement), true);
            }
            await boundsAndContrast();
            await keyboardOrder();
            await submit();
            await waiting();
            await fill();
            await submit();
            assert.deepEqual(await result(), { status: 'passed', ...expected });
            await completion(true);

            for (const [label, value] of [['Email', 'invalid'], ['Order reference', 'INVALID'], ['Units', '101'], ['I confirm this synthetic order', false]]) {
                const input = current().getByLabel(label, { exact: true });
                if (value === false) await input.uncheck(); else await input.fill(value);
                assert.equal(await current().evaluate(form => form.checkValidity()), false);
                await submit();
                assert.deepEqual(await result(), { status: 'passed', ...expected });
                await completion(true);
                await fill();
            }
            await current().getByLabel('Delivery city', { exact: true }).selectOption('Cusco');
            await submit();
            assert.deepEqual(await result(), { status: 'failed', ...expected, city: 'Cusco' });
            await completion(false);
            if (level === 6) {
                await fill();
                await submit();
                await fill(reference());
                await submit(reference());
                assert.deepEqual(await result(), { status: 'failed', context: 'Reference order', reason: 'Use the Current order form.' });
                await completion(false);
            }
            const beforeClear = await snapshot();
            const clearHandles = await controls(current()).elementHandles();
            const referenceHandles = level === 6 ? await controls(reference()).elementHandles() : [];
            await page.getByRole('button', { name: 'Clear form', exact: true }).click();
            await waiting();
            await levelIs(level);
            assert.deepEqual(await snapshot(), beforeClear);
            for (const handle of [...clearHandles, ...referenceHandles]) assert.equal(await handle.evaluate(control => control.isConnected), true);
            if (level === 6) await empty(reference());
            await fill();
            await submit();
            await completion(true);
            assert.equal(await page.evaluate(() => AAProgress.isComplete('case-shifter.html')), true);
            assert.equal(await page.evaluate(() => localStorage.getItem('aaforms:theme')), 'dark');
        }

        const maxState = await snapshot();
        await page.locator('#increase').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        await levelIs(6);
        assert.deepEqual(await snapshot(), maxState);
        assert.deepEqual(await result(), { status: 'passed', ...expected });
        await completion(true);
        await page.reload();
        await levelIs(0);
        await empty();
        await associations();
        await completion(true);
        assert.equal(await page.locator('#result').innerText(), 'Waiting for an order.');
        assert.deepEqual((await snapshot()).map(({ id, name, label, depth }) => ({ id, name, label, depth })), baseline.map(({ id, name, label, depth }) => ({ id, name, label, depth })));
        for (const resetLevel of [5, 6]) {
            for (let level = 1; level <= resetLevel; level++) await page.getByRole('button', { name: 'Increase difficulty' }).click();
            await fill();
            await submit();
            await completion(true);
            await page.getByRole('button', { name: 'Reset ladder' }).click();
            await levelIs(0);
            await waiting();
            await associations();
            assert.equal(await reference().count(), 0);
            assert.equal(await current().locator('.mutation-wrap').count(), 0);
            assert.deepEqual((await snapshot()).map(({ id, name, label, depth }) => ({ id, name, label, depth })), baseline.map(({ id, name, label, depth }) => ({ id, name, label, depth })));
            assert.equal(await page.evaluate(() => AAProgress.isComplete('case-shifter.html')), true);
            assert.equal(await page.evaluate(() => localStorage.getItem('aaforms:theme')), 'dark');
        }

        if (process.env.AA_SCREENSHOTS) await mkdir(process.env.AA_SCREENSHOTS, { recursive: true });
        for (const mode of ['light', 'dark']) {
            await page.evaluate(mode => localStorage.setItem('aaforms:theme', mode), mode);
            for (const width of [1280, 390]) {
                await page.setViewportSize({ width, height: 900 });
                await go('case-mutation.html');
                assert.equal(await page.locator('html').getAttribute('data-theme'), mode);
                for (let level = 0; level <= 6; level++) {
                    if (level) await page.getByRole('button', { name: 'Increase difficulty' }).click();
                    await levelIs(level);
                    await associations();
                    await boundsAndContrast();
                    await fill();
                    await submit();
                    assert.deepEqual(await result(), { status: 'passed', ...expected });
                    if (process.env.AA_SCREENSHOTS && [0, 3, 6].includes(level)) await page.screenshot({ path: `${process.env.AA_SCREENSHOTS}/mutation-level-${level}-${mode}-${width}.png`, fullPage: true });
                }
            }
        }
        await page.getByRole('link', { name: 'Back to Main Menu' }).click();
        assert.equal(await page.locator('#progress-count').innerText(), '2 of 11 completed');
        assert.equal(await page.locator('.sap-link[href="case-mutation.html"] .completion').innerText(), 'Completed');
        await page.getByRole('button', { name: 'Reset progress' }).click();
        assert.equal(await page.locator('#progress-count').innerText(), '0 of 11 completed');
        assert.equal(await page.evaluate(() => localStorage.getItem('aaforms:theme')), 'dark');
        assert.deepEqual(errors, []);
        console.log(`Mutation ladder passed: levels 0–6, cumulative geometry/order/wrappers, node identity/replacement, IDs/names, scoped forms, exact/wrong/native-invalid submissions, clear/reset/max/reload, eleven-case progress, theme preservation, keyboard, contrast and 390/1280px in light/dark. Chromium ${browser.version()}.`);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
