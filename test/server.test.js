'use strict';

const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { createXrrcServer } = require('../server');

const PAGES_ORIGIN = 'https://lab.liambroza.com';
let service;
let origin;

before(async () => {
  service = createXrrcServer({ allowedOrigins: [PAGES_ORIGIN] });
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${service.server.address().port}`;
});

after(async () => {
  for (const socket of service.wss.clients) socket.terminate();
  await new Promise((resolve) => service.server.close(resolve));
});

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString())));
    socket.once('error', reject);
  });
}

function openSocket(room, originHeader = PAGES_ORIGIN) {
  const websocketOrigin = origin.replace('http:', 'ws:');
  return new WebSocket(`${websocketOrigin}/ws?room=${room}`, {
    headers: { Origin: originHeader },
  });
}

function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once('close', resolve);
    socket.close();
  });
}

test('serves the rally game and its runtime configuration', async () => {
  const response = await fetch(origin);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /XRRC Backyard Rally/);
  assert.match(html, /runtime-config\.js/);
  assert.match(html, /three\.module\.min\.js/);
  assert.match(html, /Tailscale Serve URL/);
  assert.doesNotMatch(html, /aframe/i);
});

test('reports health to the configured GitHub Pages origin', async () => {
  const response = await fetch(`${origin}/health`, {
    headers: { Origin: PAGES_ORIGIN },
  });
  const health = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), PAGES_ORIGIN);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(health, {
    status: 'ok',
    service: 'xrrc-signaling',
    connections: 0,
    rooms: 0,
  });
});

test('rejects health requests from an unconfigured browser origin', async () => {
  const response = await fetch(`${origin}/health`, {
    headers: { Origin: 'https://attacker.example' },
  });

  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await response.json(), { status: 'forbidden' });
});

test('rejects WebSocket upgrades from an unconfigured origin', async () => {
  const socket = openSocket('origin-check', 'https://attacker.example');
  socket.on('error', () => {});

  const statusCode = await new Promise((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    socket.once('open', () => reject(new Error('Disallowed socket opened')));
  });

  assert.equal(statusCode, 403);
});

test('isolates rooms and relays validated signaling messages', async () => {
  const first = openSocket('test-room');
  const firstWelcome = await nextMessage(first);
  assert.equal(firstWelcome.type, 'welcome');
  assert.deepEqual(firstWelcome.peers, []);

  const joined = nextMessage(first);
  const second = openSocket('test-room');
  const secondWelcome = await nextMessage(second);
  assert.equal(secondWelcome.type, 'welcome');
  assert.deepEqual(secondWelcome.peers, [firstWelcome.id]);
  assert.deepEqual(await joined, {
    type: 'peer-joined',
    id: secondWelcome.id,
  });

  const isolated = openSocket('another-room');
  const isolatedWelcome = await nextMessage(isolated);
  assert.deepEqual(isolatedWelcome.peers, []);

  const relayed = nextMessage(second);
  first.send(JSON.stringify({
    type: 'offer',
    to: secondWelcome.id,
    sdp: { type: 'offer', sdp: 'test-sdp' },
  }));
  assert.deepEqual(await relayed, {
    type: 'offer',
    from: firstWelcome.id,
    to: secondWelcome.id,
    sdp: { type: 'offer', sdp: 'test-sdp' },
  });

  const invalid = nextMessage(first);
  first.send(JSON.stringify({ type: 'drive-state', velocity: 9001 }));
  assert.deepEqual(await invalid, {
    type: 'error',
    code: 'invalid-signal',
  });

  await Promise.all([
    closeSocket(first),
    closeSocket(second),
    closeSocket(isolated),
  ]);
});
