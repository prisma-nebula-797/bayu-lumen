const { test, expect } = require('@playwright/test');

// The Keyboard widget types on the PC through /api/trackpad: text as typed, one key combo per button. It stays locked
// until "Allow typing on the PC from the phone" is ticked, and the agent checks the same switch.
const config = (options) => JSON.stringify({
  display: { language: 'en' }, night: { enabled: false }, rules: [], shortcuts: [],
  pages: [{ id: 'kb', title: 'Keyboard', widgets: [{ id: 'k', type: 'keyboard', x: 0, y: 0, w: 8, h: 6, options }] }],
});

// The phone app path: the panel calls the native bridge (window.Android) with the panel's key; the app forwards it.
async function open(page, options) {
  const sent = [];
  await page.exposeFunction('__kbSent', (type, value) => {
    sent.push(type === 'text' ? { type, text: value } : { type, keys: value });
  });
  await page.addInitScript((json) => {
    localStorage.setItem('cfg', json);
    localStorage.setItem('pb-demo-config', json);
    window.__phoneboxKey = 'pb-key-test';
    window.Android = {
      battery: () => '{}', version: () => 'test', haptic() {}, buzz() {}, setBrightness() {}, setVolumeKeys() {}, is24Hour: () => true,
      transport: () => 'usb', pcs: () => '[]',
      keyboard: (key, type, value) => { if (key === 'pb-key-test') window.__kbSent(type, value); },
    };
  }, config(options));
  await page.goto('/panel/');
  return sent;
}

test('a keyboard without typing allowed shows the lock and sends nothing', async ({ page }) => {
  const sent = await open(page, { control: false });
  const widget = page.locator('[data-id="kb"] .w-keyboard');
  await expect(widget.locator('.kb-off')).toBeVisible();
  await expect(widget.locator('.kb-input')).toHaveCount(0);
  expect(sent).toEqual([]);
});

test('typing sends the text, erasing sends backspaces and Enter sends the enter key', async ({ page }) => {
  const sent = await open(page, { control: true });
  const input = page.locator('[data-id="kb"] .w-keyboard .kb-input');
  await input.click();
  await input.pressSequentially('Hai');
  await input.press('Backspace');
  await input.press('Enter');
  await expect.poll(() => sent.length).toBeGreaterThanOrEqual(5);
  expect(sent).toEqual([
    { type: 'text', text: 'H' }, { type: 'text', text: 'a' }, { type: 'text', text: 'i' },
    { type: 'key', keys: 'backspace' }, { type: 'key', keys: 'enter' },
  ]);
  await expect(input).toHaveValue('');
});

test('a word replaced at once (autocorrect) is erased and retyped', async ({ page }) => {
  const sent = await open(page, { control: true });
  const input = page.locator('[data-id="kb"] .w-keyboard .kb-input');
  await input.fill('teh');
  await input.fill('the ');
  await expect.poll(() => sent.length).toBe(4);
  expect(sent).toEqual([
    { type: 'text', text: 'teh' }, { type: 'key', keys: 'backspace' }, { type: 'key', keys: 'backspace' }, { type: 'text', text: 'he ' },
  ]);
});

test('the key buttons send their combos, and the shortcut row can be hidden', async ({ page }) => {
  const sent = await open(page, { control: true });
  const widget = page.locator('[data-id="kb"] .w-keyboard');
  await widget.locator('.kb-key[aria-label="esc"]').dispatchEvent('pointerdown');
  await widget.locator('.kb-key[aria-label="ctrl+c"]').dispatchEvent('pointerdown');
  await expect.poll(() => sent.length).toBe(2);
  expect(sent).toEqual([{ type: 'key', keys: 'esc' }, { type: 'key', keys: 'ctrl+c' }]);
});

test('the shortcut row is hidden when "Show shortcut keys" is off', async ({ page }) => {
  await open(page, { control: true, shortcuts: false });
  const widget = page.locator('[data-id="kb"] .w-keyboard');
  await expect(widget.locator('.kb-key[aria-label="esc"]')).toHaveCount(1);
  await expect(widget.locator('.kb-shortcuts')).toHaveCount(0);
});
