'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ShareCore = require('../public/js/share-core');

test('composes an invite message with one readable URL', () => {
  assert.equal(
    ShareCore.composeShareMessage(
      'Join my XRRC backyard rally.',
      'https://example.com/XRRC/?room=pit-crew'
    ),
    'Join my XRRC backyard rally.\n\nhttps://example.com/XRRC/?room=pit-crew'
  );
  assert.equal(
    ShareCore.composeShareMessage('', 'https://example.com/XRRC/'),
    'https://example.com/XRRC/'
  );
});

test('builds encoded email, text, and WhatsApp targets', () => {
  const title = 'XRRC room #pit-crew';
  const text = 'Join my XRRC backyard rally.';
  const url = 'https://example.com/XRRC/?room=pit-crew&signal=wss%3A%2F%2Frally.test%2Fws';
  const targets = ShareCore.buildShareTargets({ title, text, url });
  const message = `${text}\n\n${url}`;

  const email = new URL(targets.email);
  assert.equal(email.protocol, 'mailto:');
  assert.equal(email.searchParams.get('subject'), title);
  assert.equal(email.searchParams.get('body'), message);

  const sms = new URL(targets.sms);
  assert.equal(sms.protocol, 'sms:');
  assert.equal(sms.searchParams.get('body'), message);

  const whatsapp = new URL(targets.whatsapp);
  assert.equal(whatsapp.origin, 'https://wa.me');
  assert.equal(whatsapp.searchParams.get('text'), message);
  assert.equal(Object.isFrozen(targets), true);
});

test('rejects share targets without a room URL', () => {
  assert.throws(
    () => ShareCore.buildShareTargets({ title: 'XRRC', text: 'Join me' }),
    /room URL is required/
  );
});
