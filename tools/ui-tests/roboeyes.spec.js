const { test, expect } = require('@playwright/test');

// Robot eyes: they draw on a canvas, keep the camera off unless asked, start fooling around after the chosen minutes
// without a touch, and a touch brings them back.
async function open(page, options, { camera = 'none' } = {}) {
  await page.addInitScript(([json, camera]) => {
    localStorage.setItem('cfg', json);
    localStorage.setItem('pb-demo-config', json);
    window.__gum = 0;
    if (camera !== 'none') {
      navigator.mediaDevices.getUserMedia = async () => { window.__gum++; throw new DOMException('denied', 'NotAllowedError'); };
    } else if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => { window.__gum++; throw new Error('should not be called'); };
    }
  }, [JSON.stringify({ display: { language: 'en' }, night: { enabled: false }, rules: [], shortcuts: [],
    pages: [{ id: 'eyes', title: 'Eyes', widgets: [{ id: 'r', type: 'roboeyes', x: 0, y: 0, w: 6, h: 4, options }] }] }), camera]);
  await page.goto('/panel/');
  return page.locator('[data-id="eyes"] .w-roboeyes');
}

test('the eyes draw and leave the camera alone by default', async ({ page }) => {
  const eyes = await open(page, {});
  await expect(eyes.locator('canvas.re-canvas')).toBeAttached();
  await expect(eyes).toHaveAttribute('data-mood', 'neutral');
  // something lit is on the canvas
  await expect.poll(() => eyes.locator('canvas').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) lit++;
    return lit;
  })).toBeGreaterThan(50);
  expect(await page.evaluate(() => window.__gum)).toBe(0);
});

test('after the idle minutes they fool around, and a touch brings them back', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 0, 1, 12, 0, 0) });
  const eyes = await open(page, { idle: 2 });
  await expect(eyes).toHaveAttribute('data-mood', 'neutral');
  await page.clock.runFor(60_000);
  expect(await eyes.getAttribute('data-antic')).toBeFalsy(); // one minute is not two
  await page.clock.runFor(70_000);
  await expect.poll(() => eyes.getAttribute('data-antic')).toBeTruthy();
  const antics = await page.evaluate(async () => (await import('/panel/widgets/roboeyes.js')).ANTICS);
  expect(antics).toContain(await eyes.getAttribute('data-antic'));
  await page.mouse.click(5, 5);
  await expect(eyes).toHaveAttribute('data-mood', 'surprised');
  expect(await eyes.getAttribute('data-antic')).toBeFalsy();
  await page.clock.runFor(2_000);
  await expect(eyes).toHaveAttribute('data-mood', 'neutral');
});

test('by default an antic plays every 10 seconds, sleepy and watching TV among them', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 0, 1, 12, 0, 0) });
  const eyes = await open(page, {});
  await page.clock.runFor(5_000);
  expect(await eyes.getAttribute('data-antic')).toBeFalsy();
  await page.clock.runFor(6_000);
  await expect.poll(() => eyes.getAttribute('data-antic')).toBeTruthy();
  const first = await eyes.getAttribute('data-antic');
  // the next one starts about 10 seconds after the first began, not 10 seconds after it ended
  await page.clock.runFor(10_500);
  const started = await page.evaluate(() => document.querySelector('[data-id="eyes"] .w-roboeyes').dataset.antic);
  expect(started).toBeTruthy();
  const { ANTICS, SENSITIVITY } = await page.evaluate(async () => {
    const m = await import('/panel/widgets/roboeyes.js');
    return { ANTICS: m.ANTICS, SENSITIVITY: m.SENSITIVITY };
  });
  expect(ANTICS).toEqual(expect.arrayContaining(['sleepy', 'tv', first]));
  expect(ANTICS.length).toBeGreaterThanOrEqual(20);
  expect(SENSITIVITY.high.threshold).toBeLessThan(SENSITIVITY.normal.threshold);
  expect(SENSITIVITY.high.every).toBeLessThan(SENSITIVITY.normal.every);
});

test('the eyes are drawn in OLED pixels, sharp, unless that is turned off', async ({ page }) => {
  const eyes = await open(page, {});
  const px = await eyes.locator('canvas').evaluate((c) => ({ w: c.width, rendering: getComputedStyle(c).imageRendering }));
  expect(px.w).toBe(128);
  expect(px.rendering).toMatch(/pixelated|crisp-edges/);
  await expect(eyes).toHaveClass(/re-pixels/);
});

test('with the camera option on, a refused camera says so instead of tracking', async ({ page }) => {
  const eyes = await open(page, { camera: true }, { camera: 'deny' });
  await expect(eyes.locator('.re-status')).toHaveText('Camera not allowed');
  await expect(eyes).toHaveAttribute('data-camera', 'denied');
  expect(await page.evaluate(() => window.__gum)).toBe(1);
});

test('movement in the camera frame turns the eyes towards it, mirrored like a face', async ({ page }) => {
  await page.goto('/panel/');
  const out = await page.evaluate(async () => {
    const { motionCentroid, lookAt } = await import('/panel/widgets/roboeyes.js');
    const w = 40, h = 30, prev = new Uint8ClampedArray(w * h), cur = new Uint8ClampedArray(w * h);
    // something moves in the left part of the camera picture (the person's right)
    for (let y = 10; y < 20; y++) for (let x = 4; x < 10; x++) cur[y * w + x] = 200;
    const m = motionCentroid(prev, cur, w, h);
    const still = motionCentroid(prev, prev, w, h);
    return { m, still, look: lookAt(m.x, m.y), centre: lookAt(0.5, 0.45) };
  });
  expect(out.still.count).toBe(0);
  expect(out.m.count).toBe(60);
  expect(out.m.x).toBeCloseTo(7 / 40, 3); // columns 4..9: centre 6.5, plus half a pixel
  expect(out.look.x).toBeGreaterThan(0.5); // the eyes look to their right-hand side of the screen, at the person
  expect(out.centre).toEqual({ x: 0, y: 0 });
});
