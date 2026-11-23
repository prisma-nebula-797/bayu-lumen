const { test, expect } = require('@playwright/test');

// The prayer times widget works the times out on the phone from the weather location. Jakarta's Kemenag table for
// 23 November 2026 gives Dhuhr 11:41, Asr 15:06 and Isha 19:09 (WIB); the widget must land on the same minutes.
const config = (options = {}, language = 'en', weather = { city: 'Jakarta', lat: -6.2088, lon: 106.8456, unit: 'celsius', model: '' }) =>
  JSON.stringify({
    display: { language }, night: { enabled: false }, rules: [], shortcuts: [], weather,
    pages: [{ id: 'pray', title: 'Prayer', widgets: [{ id: 'pr', type: 'prayer', x: 0, y: 0, w: 4, h: 6, options }] }],
  });

const useConfig = (page, json) => page.addInitScript((json) => {
  localStorage.setItem('cfg', json);
  localStorage.setItem('pb-demo-config', json);
}, json);

test.describe('prayer times in Jakarta', () => {
  test.use({ timezoneId: 'Asia/Jakarta' });

  test('matches the Kemenag table and counts down to the next prayer', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-23T10:00:00+07:00') });
    await useConfig(page, config());
    await page.goto('/panel/');
    const widget = page.locator('[data-id="pray"] .w-prayer');
    await expect(widget).toHaveCount(1);
    await expect(widget.locator('.pr-dhuhr .pr-t')).toHaveText(/11:41/);
    await expect(widget.locator('.pr-asr .pr-t')).toHaveText(/(15|3):06/);
    await expect(widget.locator('.pr-isha .pr-t')).toHaveText(/(19|7):09/);
    await expect(widget.locator('.pr-next-name')).toHaveText('Dhuhr');
    await expect(widget.locator('.pr-dhuhr')).toHaveClass(/\bnext\b/);
    await expect(widget.locator('.pr-next-in')).not.toBeEmpty();
  });

  test('after isha the next prayer is tomorrow\'s fajr', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-23T22:00:00+07:00') });
    await useConfig(page, config());
    await page.goto('/panel/');
    const widget = page.locator('[data-id="pray"] .w-prayer');
    await expect(widget.locator('.pr-next-name')).toHaveText('Fajr');
    await expect(widget.locator('.pr-isha')).toHaveClass(/\bnow\b/);
  });

  test('speaks Indonesian and can hide imsak', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-23T10:00:00+07:00') });
    await useConfig(page, config({ imsak: false }, 'id'));
    await page.goto('/panel/');
    const widget = page.locator('[data-id="pray"] .w-prayer');
    await expect(widget.locator('.pr-next-name')).toHaveText('Dzuhur');
    await expect(widget.locator('.pr-fajr .pr-n')).toHaveText('Subuh');
    await expect(widget.locator('.pr-imsak')).toHaveCount(0);
  });

  test('a missing location shows a hint instead of times', async ({ page }) => {
    await useConfig(page, config({}, 'en', { city: '', lat: null, lon: '', unit: 'celsius', model: '' }));
    await page.goto('/panel/');
    const widget = page.locator('[data-id="pray"] .w-prayer');
    await expect(widget.locator('.pr-next-name')).toHaveText('—');
    await expect(widget.locator('.pr-dhuhr .pr-t')).toHaveText('—');
  });
});

// Reminders: a message on the panel and a vibration N minutes before a prayer (or at its time), once per prayer.
test.describe('prayer reminders in Jakarta', () => {
  test.use({ timezoneId: 'Asia/Jakarta' });

  async function openWithBridge(page, options, time) {
    await page.clock.install({ time });
    await page.addInitScript((json) => {
      localStorage.setItem('cfg', json);
      localStorage.setItem('pb-demo-config', json);
      window.__phoneboxKey = 'pb-key-test';
      window.__buzz = [];
      window.Android = {
        battery: () => '{}', version: () => 'test', haptic() {}, setBrightness() {}, setVolumeKeys() {}, is24Hour: () => true,
        transport: () => 'usb', pcs: () => '[]', buzz: (key, p) => { if (key === 'pb-key-test') window.__buzz.push(p); },
      };
    }, config(options));
    await page.goto('/panel/');
  }

  test('ten minutes before Dhuhr the panel says so and vibrates, once', async ({ page }) => {
    await openWithBridge(page, { remind: '10', chime: false }, new Date('2026-11-23T11:31:20+07:00'));
    await expect(page.locator('#toast.on')).toContainText('Dhuhr in 10 min');
    await expect.poll(() => page.evaluate(() => window.__buzz.length)).toBe(1);
    await page.clock.runFor(45_000); // later updates in the same window do not ring again
    expect(await page.evaluate(() => window.__buzz.length)).toBe(1);
  });

  test('"at the prayer time" says it is time, and "off" stays quiet', async ({ page }) => {
    await openWithBridge(page, { remind: '0', chime: false }, new Date('2026-11-23T11:41:10+07:00'));
    await expect(page.locator('#toast.on')).toContainText('Time for Dhuhr');
  });

  test('reminders are off by default', async ({ page }) => {
    await openWithBridge(page, {}, new Date('2026-11-23T11:41:10+07:00'));
    await page.clock.runFor(35_000);
    expect(await page.evaluate(() => window.__buzz.length)).toBe(0);
  });
});
