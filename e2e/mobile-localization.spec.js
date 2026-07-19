'use strict';

const { test, expect, devices } = require('@playwright/test');

test.use({ ...devices['Pixel 7'] });

test('localizes the complete setup and persists language changes', async ({ page }) => {
  await page.goto('/?signal=off&lang=es');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('#setup-title')).toHaveText('Prepara la carrera');
  await expect(page.locator('input[value="helicopter"] + .vehicle-glyph + strong'))
    .toHaveText('Helicoptero');
  await expect(page.locator('#signal-panel .status-dot')).toHaveCount(1);

  await page.locator('#language-select').selectOption('fr');
  await expect(page.locator('#setup-title')).toHaveText('Preparez la course');
  await page.goto('/?signal=off');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('#desktop-btn span')).toHaveText('Course sur ordinateur');
});

test('mobile touch steering remains reachable and drives the vehicle', async ({ page }) => {
  await page.goto('/?signal=off&mode=desktop&controls=touch');
  await page.waitForFunction(() => window.XRRC_DIAGNOSTICS?.snapshot().calls > 0);
  await expect(page.locator('#countdown')).toHaveText('', { timeout: 6_000 });
  await expect(page.locator('#joystick-zone')).toBeVisible();

  const viewport = page.viewportSize();
  const joystick = await page.locator('#joystick').boundingBox();
  expect(joystick.x).toBeGreaterThanOrEqual(0);
  expect(joystick.y).toBeGreaterThanOrEqual(0);
  expect(joystick.x + joystick.width).toBeLessThanOrEqual(viewport.width);
  expect(joystick.y + joystick.height).toBeLessThanOrEqual(viewport.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport.width
  );

  await page.mouse.move(joystick.x + joystick.width / 2, joystick.y + joystick.height / 2);
  await page.mouse.down();
  await page.mouse.move(joystick.x + joystick.width * 0.72, joystick.y + joystick.height * 0.15);
  await expect.poll(async () => Number(await page.locator('#speed-value').textContent())).toBeGreaterThan(0);
  await page.mouse.up();
});
