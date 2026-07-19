'use strict';

const { test, expect } = require('@playwright/test');

test('two browsers exchange distinct vehicle physics over WebRTC', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const tankPage = await context.newPage();
  const helicopterPage = await context.newPage();
  const room = `playwright-${Date.now()}`;
  const signal = encodeURIComponent(baseURL);

  await Promise.all([
    tankPage.goto(`/?mode=desktop&room=${room}&vehicle=tank&signal=${signal}`),
    helicopterPage.goto(`/?mode=desktop&room=${room}&vehicle=helicopter&signal=${signal}`),
  ]);

  await Promise.all([
    expect(tankPage.locator('#peer-count')).toHaveText('2', { timeout: 15_000 }),
    expect(helicopterPage.locator('#peer-count')).toHaveText('2', { timeout: 15_000 }),
  ]);
  await expect.poll(async () => (
    tankPage.evaluate(() => window.XRRC_DIAGNOSTICS?.snapshot().remoteVehicles)
  )).toContain('helicopter');
  await expect.poll(async () => (
    helicopterPage.evaluate(() => window.XRRC_DIAGNOSTICS?.snapshot().remoteVehicles)
  )).toContain('tank');

  await context.close();
});
