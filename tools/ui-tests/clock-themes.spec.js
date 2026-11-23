const { test, expect } = require('@playwright/test');

// The digital and analog clocks take a "theme" option. The metal themes paint the analog face with gradients whose ids
// are per widget, so two clocks on one page never share (or steal) each other's gradient.
const THEMES = ['default', 'chrome', 'gold', 'rosegold', 'neon', 'sunset', 'ocean', 'lcd', 'amber', 'glass', 'bold', 'pastel'];

async function open(page, widgets) {
  await page.addInitScript((json) => {
    localStorage.setItem('cfg', json);
    localStorage.setItem('pb-demo-config', json);
  }, JSON.stringify({ display: { language: 'en' }, night: { enabled: false }, rules: [], shortcuts: [], pages: [{ id: 'clocks', title: 'Clocks', widgets }] }));
  await page.goto('/panel/');
}

test('every digital clock theme is applied, and an unknown one falls back to the default', async ({ page }) => {
  const widgets = [...THEMES, 'no-such-theme'].map((theme, i) => ({
    id: 'c' + i, type: 'clock', x: (i % 4) * 3, y: Math.floor(i / 4) * 2 % 6, w: 3, h: 2,
    options: { theme, status: false, weather: false, date: false },
  }));
  await open(page, widgets);
  const clocks = page.locator('[data-id="clocks"] .w-clock');
  await expect(clocks).toHaveCount(widgets.length);
  const applied = await clocks.evaluateAll((els) => els.map((el) => el.dataset.clockTheme));
  expect(applied).toEqual([...THEMES, 'default']);
  // the chrome theme gives the clock its metal panel and gradient digits
  const chrome = clocks.nth(THEMES.indexOf('chrome'));
  const look = await chrome.evaluate((el) => ({
    shadow: getComputedStyle(el).boxShadow,
    fill: getComputedStyle(el.querySelector('.clock .hh')).webkitTextFillColor,
    clip: getComputedStyle(el.querySelector('.clock .hh')).webkitBackgroundClip,
  }));
  expect(look.shadow).not.toBe('none');
  expect(look.fill).toBe('rgba(0, 0, 0, 0)');
  expect(look.clip).toBe('text');
  await expect(chrome.locator('.clock .hh')).not.toHaveText('--');
});

test('analog metal themes get their own gradients per widget', async ({ page }) => {
  await open(page, [
    { id: 'a1', type: 'analog', x: 0, y: 0, w: 3, h: 3, options: { theme: 'chrome' } },
    { id: 'a2', type: 'analog', x: 3, y: 0, w: 3, h: 3, options: { theme: 'gold' } },
    { id: 'a3', type: 'analog', x: 6, y: 0, w: 3, h: 3, options: { theme: 'neon' } },
    { id: 'a4', type: 'analog', x: 9, y: 0, w: 3, h: 3, options: {} },
  ]);
  const clocks = page.locator('[data-id="clocks"] .w-analog');
  await expect(clocks).toHaveCount(4);
  const info = await clocks.evaluateAll((els) => els.map((el) => ({
    theme: el.dataset.clockTheme,
    gradients: [...el.querySelectorAll('radialGradient, linearGradient')].map((g) => g.id),
    face: getComputedStyle(el.querySelector('.face')).fill,
  })));
  expect(info.map((i) => i.theme)).toEqual(['chrome', 'gold', 'neon', 'default']);
  expect(info[0].gradients).toHaveLength(2);
  expect(info[1].gradients).toHaveLength(2);
  expect(new Set([...info[0].gradients, ...info[1].gradients]).size).toBe(4); // no shared ids
  expect(info[0].face).toContain(info[0].gradients[0]);
  expect(info[2].gradients).toEqual([]); // neon is flat colour
  expect(info[3].gradients).toEqual([]);
});
