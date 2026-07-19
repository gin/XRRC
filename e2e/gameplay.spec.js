'use strict';

const { test, expect } = require('@playwright/test');

const vehicles = {
  rally: 'Rally car',
  buggy: 'Dune buggy',
  truck: '4x4 truck',
  motorcycle: 'RC motorcycle',
  tank: 'Mini tank',
  plane: 'Prop plane',
  helicopter: 'Helicopter',
};

async function waitForRenderedGame(page) {
  await page.waitForFunction(() => (
    window.XRRC_DIAGNOSTICS &&
    window.XRRC_DIAGNOSTICS.snapshot().calls > 0
  ));
}

test('renders every vehicle with the optimized circuit', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  for (const [vehicle, label] of Object.entries(vehicles)) {
    await test.step(label, async () => {
      await page.goto(`/?signal=off&mode=desktop&vehicle=${vehicle}`);
      await waitForRenderedGame(page);
      await expect(page.locator('#vehicle-label')).toHaveText(label);
      const diagnostics = await page.evaluate(() => window.XRRC_DIAGNOSTICS.snapshot());
      expect(diagnostics.localVehicle).toBe(vehicle);
      expect(diagnostics.calls).toBeLessThanOrEqual(90);
      expect(diagnostics.geometries).toBeLessThanOrEqual(90);
      expect(diagnostics.roadNormalY).toBeGreaterThan(0.9);
      expect(diagnostics.triangles).toBeGreaterThan(10_000);
    });
  }

  expect(pageErrors).toEqual([]);
});

test('keyboard driving accelerates and reset returns the vehicle to the grid', async ({ page }) => {
  await page.goto('/?signal=off&mode=desktop&vehicle=rally');
  await waitForRenderedGame(page);
  await expect(page.locator('#countdown')).toHaveText('', { timeout: 6_000 });

  await page.keyboard.down('w');
  await expect.poll(async () => Number(await page.locator('#speed-value').textContent())).toBeGreaterThan(0);
  await page.keyboard.up('w');
  await page.keyboard.press('r');

  await expect(page.locator('#toast')).toHaveText('Vehicle reset to the grid');
  await expect(page.locator('#speed-value')).toHaveText('00');
});

test('Quest quality mode reduces headset GPU cost', async ({ page }) => {
  await page.goto('/?signal=off&mode=desktop&quality=quest');
  await waitForRenderedGame(page);
  const diagnostics = await page.evaluate(() => window.XRRC_DIAGNOSTICS.snapshot());

  expect(diagnostics).toMatchObject({
    antialias: false,
    particles: 96,
    pixelRatio: 1,
    quality: 'quest',
    shadows: false,
  });
  expect(diagnostics.calls).toBeLessThanOrEqual(90);
});
