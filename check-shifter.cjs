const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { chromium } = require('playwright');

// Run the shipped handler without rendering to check all 8! * 3 states cheaply.
const source = readFileSync(join(__dirname, 'case-shifter.html'), 'utf8');
const script = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const node = () => ({ dataset: {}, events: {}, addEventListener(type, handler) { this.events[type] = handler; } });
const nodes = Object.fromEntries(['shifter', 'fields', 'shuffle', 'layout-status', 'result'].map(id => [id, node()]));
nodes.fields.children = Array.from({ length: 8 }, (_, index) => ({ index }));
nodes.fields.append = function (...groups) { this.children = groups; };
runInNewContext(script, { document: { getElementById: id => nodes[id] }, AAProgress: { set() {} } });
const sequence = new Set();
const orders = [new Set(), new Set(), new Set()];
let previousOrder, previousFamily;
for (let index = 0; index < 120960; index++) {
    const order = nodes.fields.children.map(group => group.index).join('');
    const family = nodes.fields.dataset.layout;
    assert.notEqual(order, previousOrder);
    assert.notEqual(family, previousFamily);
    const signature = family + order;
    assert.equal(sequence.has(signature), false, `Repeated layout ${index + 1}`);
    sequence.add(signature);
    orders[index % 3].add(order);
    previousOrder = order;
    previousFamily = family;
    if (index < 120959) nodes.shuffle.events.click();
}
assert.deepEqual(orders.map(set => set.size), [40320, 40320, 40320]);
assert.equal(nodes.shuffle.disabled, true);
assert.match(nodes['layout-status'].textContent, /Layout 120,960 of 120,960.*Reset form/);
nodes.shuffle.events.click();
assert.equal(nodes.fields.children.map(group => group.index).join(''), previousOrder);
nodes.shifter.events.reset();
assert.equal(nodes.shuffle.disabled, false);
assert.equal(nodes.fields.dataset.layout, 'wide');
assert.equal(nodes.fields.children.map(group => group.index).join(''), '01234567');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    try {
        const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
        context.setDefaultTimeout(10000);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
        const base = process.env.AA_FORMS_URL || 'http://127.0.0.1:8765/';
        const go = file => page.goto(new URL(file, base).href);
        const result = async () => JSON.parse(await page.locator('#result').innerText());
        const completed = () => page.locator('#case-completion').innerText();
        const expected = { contact: 'Ada Torres', email: 'ada@example.test', department: 'Procurement',
            reference: 'PO-2048', units: '3', city: 'Lima', notes: 'Ship together.', confirmation: true };
        async function fill(contact = expected.contact) {
            for (const id of ['contact', 'email', 'reference', 'units', 'notes']) await page.locator('#' + id).fill(id === 'contact' ? contact : expected[id]);
            for (const id of ['department', 'city']) await page.locator('#' + id).selectOption(expected[id]);
            await page.locator('#confirmation').check();
        }
        await go('index.html');
        assert.equal(await page.locator('.sap-link').count(), 11);
        assert.equal(await page.locator('#progress').getAttribute('max'), '11');
        await page.evaluate(() => AAProgress.set('case-navigation.html', true));
        await page.getByRole('link', { name: /2\. Shape shifter/ }).click();
        assert.equal(await completed(), 'Not completed');
        assert.equal(await page.evaluate(() => document.getElementById('shifter').checkValidity()), false);
        await page.getByRole('button', { name: 'Submit order' }).click();
        assert.equal(await page.locator('#result').innerText(), 'Waiting for an order.');
        await fill('Wrong person');
        await page.getByRole('button', { name: 'Submit order' }).click();
        assert.deepEqual(await result(), { status: 'failed', ...expected, contact: 'Wrong person' });
        assert.equal(await completed(), 'Not completed');

        const geometry = await page.evaluate(() => {
            const fields = document.getElementById('fields');
            const controls = [...fields.querySelectorAll('input, select, textarea')];
            const saved = controls.map(control => ({ control, id: control.id, value: control.value,
                checked: control.checked, labels: [...control.labels].map(label => label.textContent) }));
            const seen = new Set();
            let previousOrder, previousFamily;
            for (let index = 0; index <= 1000; index++) {
                const groups = [...fields.children];
                const order = groups.map(group => group.querySelector('input, select, textarea').id).join(',');
                const family = fields.dataset.layout;
                if (order === previousOrder || family === previousFamily) throw new Error(`Unchanged order or family at ${index}`);
                const signature = groups.map(group => {
                    const rect = group.getBoundingClientRect();
                    return [group.querySelector('input, select, textarea').id, rect.x, rect.y, rect.width, rect.height];
                });
                const key = JSON.stringify(signature);
                if (seen.has(key)) throw new Error(`Repeated geometry at ${index}`);
                seen.add(key);
                for (const item of saved) {
                    const live = document.getElementById(item.id);
                    if (live !== item.control || live.value !== item.value || live.checked !== item.checked ||
                        JSON.stringify([...live.labels].map(label => label.textContent)) !== JSON.stringify(item.labels)) {
                        throw new Error(`Field changed at ${index}: ${item.id}`);
                    }
                }
                previousOrder = order;
                previousFamily = family;
                if (index < 1000) document.getElementById('shuffle').click();
            }
            return seen.size;
        });
        assert.equal(geometry, 1001);
        assert.match(await page.locator('#layout-status').innerText(), /^Layout 1,001 of 120,960:/);
        assert.deepEqual(await result(), { status: 'failed', ...expected, contact: 'Wrong person' });
        await page.locator('#contact').fill(expected.contact);
        await page.getByRole('button', { name: 'Submit order' }).click();
        assert.deepEqual(await result(), { status: 'passed', ...expected });
        assert.equal(await completed(), 'Completed');
        await page.getByRole('button', { name: 'Shuffle layout' }).click();
        assert.deepEqual(await result(), { status: 'passed', ...expected });
        assert.equal(await completed(), 'Completed');

        const order = await page.locator('#fields input, #fields select, #fields textarea').evaluateAll(controls => controls.map(control => control.id));
        await page.locator('#' + order[0]).focus();
        for (let index = 0; index < order.length; index++) {
            assert.equal(await page.evaluate(() => document.activeElement.id), order[index]);
            await page.keyboard.press('Tab');
        }
        await page.reload();
        assert.equal(await completed(), 'Completed');
        assert.equal(await page.locator('#contact').inputValue(), '');
        assert.match(await page.locator('#layout-status').innerText(), /^Layout 1 of/);
        await fill();
        await page.locator('#email').fill('invalid');
        await page.getByRole('button', { name: 'Submit order' }).click();
        assert.equal(await page.locator('#result').innerText(), 'Waiting for an order.');
        assert.equal(await completed(), 'Completed');
        await page.locator('#email').fill(expected.email);
        await page.locator('#reference').fill('INVALID');
        assert.equal(await page.evaluate(() => document.getElementById('reference').validity.patternMismatch), true);
        await page.locator('#reference').fill(expected.reference);
        await page.locator('#units').fill('101');
        assert.equal(await page.evaluate(() => document.getElementById('units').validity.rangeOverflow), true);
        await page.locator('#units').fill(expected.units);
        await page.locator('#confirmation').uncheck();
        assert.equal(await page.evaluate(() => document.getElementById('confirmation').validity.valueMissing), true);
        await page.locator('#confirmation').check();
        await page.locator('#city').selectOption('Cusco');
        await page.getByRole('button', { name: 'Submit order' }).click();
        assert.deepEqual(await result(), { status: 'failed', ...expected, city: 'Cusco' });
        assert.equal(await completed(), 'Not completed');
        await fill();
        await page.getByRole('button', { name: 'Submit order' }).click();
        await page.getByRole('button', { name: 'Shuffle layout' }).click();
        const beforeReset = await page.locator('#contact').elementHandle();
        await page.getByRole('button', { name: 'Reset form' }).click();
        assert.equal(await beforeReset.evaluate(control => control === document.getElementById('contact')), true);
        assert.equal(await completed(), 'Not completed');
        assert.equal(await page.locator('#result').innerText(), 'Waiting for an order.');
        assert.equal(await page.locator('#fields').getAttribute('data-layout'), 'wide');
        assert.deepEqual(await page.locator('#fields input, #fields select, #fields textarea').evaluateAll(controls => controls.map(control => [control.id, control.value, control.checked || false])),
            Object.keys(expected).map(id => [id, id === 'confirmation' ? 'on' : '', false]));
        assert.equal(await page.evaluate(() => AAProgress.isComplete('case-navigation.html')), true);

        if (process.env.AA_SCREENSHOTS) await mkdir(process.env.AA_SCREENSHOTS, { recursive: true });
        for (const mode of ['light', 'dark']) {
            await page.evaluate(mode => localStorage.setItem('aaforms:theme', mode), mode);
            for (const width of [1280, 390]) {
                await page.setViewportSize({ width, height: 900 });
                await go('case-shifter.html');
                assert.equal(await page.locator('html').getAttribute('data-theme'), mode);
                const borderContrast = await page.locator('#fields input:not([type="checkbox"]), #fields select, #fields textarea').evaluateAll(controls => {
                    const luminance = rgb => {
                        const channels = rgb.match(/\d+/g).slice(0, 3).map(value => Number(value) / 255)
                            .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
                        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
                    };
                    const panel = luminance(getComputedStyle(document.querySelector('.container')).backgroundColor);
                    return controls.flatMap(control => {
                        const style = getComputedStyle(control), border = luminance(style.borderTopColor);
                        return [luminance(style.backgroundColor), panel].map(background =>
                            (Math.max(border, background) + 0.05) / (Math.min(border, background) + 0.05));
                    });
                });
                assert.ok(borderContrast.length === 14 && borderContrast.every(ratio => ratio >= 3), `Field border contrast in ${mode} at ${width}px: ${borderContrast}`);
                const shapes = new Set();
                for (const family of ['wide', 'compact', 'offset']) {
                    assert.equal(await page.locator('#fields').getAttribute('data-layout'), family);
                    const shape = await page.evaluate(() => {
                        const fields = document.getElementById('fields');
                        const rectangles = [...fields.children].map(group => group.getBoundingClientRect());
                        if (document.documentElement.scrollWidth > innerWidth) throw new Error('Page overflow');
                        for (const rect of rectangles) {
                            if (rect.left < 0 || rect.right > innerWidth || rect.width <= 0 || rect.height <= 0) throw new Error('Field outside viewport');
                        }
                        for (let first = 0; first < rectangles.length; first++) {
                            for (let second = first + 1; second < rectangles.length; second++) {
                                const a = rectangles[first], b = rectangles[second];
                                if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) throw new Error('Overlapping groups');
                            }
                        }
                        const sorted = [...rectangles].sort((a, b) => a.top - b.top || a.left - b.left);
                        if (!rectangles.every((rect, index) => rect === sorted[index])) throw new Error('Visual and DOM order differ');
                        return JSON.stringify(rectangles.map(rect => [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width)]));
                    });
                    shapes.add(shape);
                    if (process.env.AA_SCREENSHOTS) await page.screenshot({ path: `${process.env.AA_SCREENSHOTS}/shifter-${family}-${mode}-${width}.png`, fullPage: true });
                    await page.getByRole('button', { name: 'Shuffle layout' }).click();
                }
                assert.equal(shapes.size, 3, `Distinct ${mode} layouts at ${width}px`);
            }
        }
        await page.getByRole('link', { name: 'Back to Main Menu' }).click();
        assert.equal(await page.locator('#progress-count').innerText(), '1 of 11 completed');
        await page.evaluate(() => AAProgress.set('case-shifter.html', true));
        assert.equal(await page.locator('#progress-count').innerText(), '2 of 11 completed');
        await page.getByRole('button', { name: 'Reset progress' }).click();
        assert.equal(await page.locator('#progress-count').innerText(), '0 of 11 completed');
        assert.equal(await page.evaluate(() => AAProgress.isComplete('case-shifter.html')), false);
        assert.deepEqual(errors, []);
        console.log(`Shape shifter passed: 120,960 unique states and exhaustion; 1,001 rendered layouts; stable nodes, IDs, labels, values, keyboard order, exact submissions, resets, progress, light/dark and 390/1280px. Chromium ${browser.version()}.`);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
