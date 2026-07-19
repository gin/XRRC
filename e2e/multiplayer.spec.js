'use strict';

const { test, expect } = require('@playwright/test');

test('announces a peer when its data channel is already open', async ({ page }) => {
  await page.goto('/?signal=off');

  const result = await page.evaluate(() => {
    const manager = new window.NetworkManager();
    manager._createPeerRecord('fast-peer');
    let joined = null;
    manager.addEventListener('peer-join', ({ detail }) => {
      joined = detail;
    });
    const channel = { readyState: 'open' };
    manager._setupDataChannel(channel, 'fast-peer');
    return {
      announced: manager._peers.get('fast-peer').announced,
      joined,
    };
  });

  expect(result).toMatchObject({
    announced: true,
    joined: { id: 'fast-peer' },
  });
  expect(result.joined.color).toMatch(/^#[\da-f]{6}$/i);
});

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
    tankPage.waitForFunction(() => window.XRRC_DIAGNOSTICS?.snapshot().calls > 0),
    helicopterPage.waitForFunction(() => window.XRRC_DIAGNOSTICS?.snapshot().calls > 0),
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
