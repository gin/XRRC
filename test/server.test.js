'use strict';

const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { server } = require('../server');

let origin;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => resolve(JSON.parse(data)));
    socket.once('error', reject);
  });
}

test('serves the raw Three.js game at the site root', async () => {
  const response = await fetch(origin);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /three\.module\.js/);
  assert.match(html, /Use 8th Wall/);
  assert.doesNotMatch(html, /aframe/i);
});

test('signals peers in the same room', async () => {
  const websocketOrigin = origin.replace('http:', 'ws:');
  const first = new WebSocket(`${websocketOrigin}/ws?room=test-room`);
  const firstWelcome = await nextMessage(first);
  assert.equal(firstWelcome.type, 'welcome');
  assert.deepEqual(firstWelcome.peers, []);

  const peerJoined = nextMessage(first);
  const second = new WebSocket(`${websocketOrigin}/ws?room=test-room`);
  const secondWelcome = await nextMessage(second);
  assert.equal(secondWelcome.type, 'welcome');
  assert.deepEqual(secondWelcome.peers, [firstWelcome.id]);
  assert.equal((await peerJoined).type, 'peer-joined');

  first.close();
  second.close();
});
