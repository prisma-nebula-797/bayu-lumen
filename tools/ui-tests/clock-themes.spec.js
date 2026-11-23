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

// Clock designs: ten shapes, each in any theme. Every shape draws the current time without errors.
const SHAPES = { flip: '.cf-flip-card', nixie: '.cf-nixie-tube', binary: '.cf-bit', rings: '.cf-arc', dots: '.cf-dot', stacked: '.cf-stack-v', segment: '.cf-seg-digit', bars: '.cf-bar', orbit: '.cf-body', dayline: '.cf-day-track' };

test('every Clock designs shape draws the time, in the chrome variants too', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.clock.install({ time: new Date(2026, 0, 1, 13, 37, 42) });
  const names = Object.keys(SHAPES);
  const variants = ['chrome', 'chrome-black', 'chrome-blue', 'chrome-mirror', 'chrome-gunmetal', 'chrome-copper', 'chrome-holo', 'chrome-liquid', 'neon', 'lcd'];
  await open(page, names.map((shape, i) => ({ id: 'f' + i, type: 'clockface', x: (i % 4) * 3, y: Math.floor(i / 4) * 2, w: 3, h: 2, options: { shape, theme: variants[i] } })));
  const tiles = page.locator('[data-id="clocks"] .w-clockface');
  await expect(tiles).toHaveCount(names.length);
  for (const [i, shape] of names.entries()) {
    const tile = tiles.nth(i);
    await expect(tile).toHaveAttribute('data-shape', shape);
    await expect(tile).toHaveAttribute('data-clock-theme', variants[i]);
    await expect(tile.locator(SHAPES[shape]).first()).toBeAttached();
  }
  // the time itself: 13:37:42 on a 24-hour panel
  await expect(tiles.nth(0).locator('.cf-flip-v').first()).toHaveText('13');
  await expect(tiles.nth(1).locator('.cf-nixie-d')).toHaveText(['1', '3', '3', '7', '4', '2']);
  // binary: 3 (0011) in the hour units column lights the two lowest dots
  const unitsLit = await tiles.nth(2).locator('.cf-bin-col').nth(1).locator('.cf-bit').evaluateAll((d) => d.map((x) => x.classList.contains('on')));
  expect(unitsLit).toEqual([false, false, true, true]);
  // the metal variants paint their text with a gradient
  expect(await tiles.nth(0).getAttribute('data-gradient')).toBe('');
  expect(await tiles.nth(8).getAttribute('data-gradient')).toBeNull(); // neon glows instead
  expect(errors).toEqual([]);
});

test('an unknown shape falls back to flip cards', async ({ page }) => {
  await open(page, [{ id: 'f', type: 'clockface', x: 0, y: 0, w: 4, h: 3, options: { shape: 'nope', theme: 'nope' } }]);
  const tile = page.locator('[data-id="clocks"] .w-clockface');
  await expect(tile).toHaveAttribute('data-shape', 'flip');
  await expect(tile).toHaveAttribute('data-clock-theme', 'default');
});
