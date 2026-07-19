'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const publicDirectory = path.join(root, 'public');
const html = fs.readFileSync(path.join(publicDirectory, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(publicDirectory, 'css/style.css'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');

test('keeps local page assets relative and present for the /XRRC/ subpath', () => {
  const references = Array.from(html.matchAll(/(?:href|src)="([^"]+)"/g))
    .map((match) => match[1])
    .filter((reference) => (
      !reference.startsWith('http') &&
      !reference.startsWith('#') &&
      !reference.startsWith('data:')
    ));

  for (const reference of references) {
    const cleanReference = reference.replace(/^\.\//, '').split(/[?#]/)[0];
    assert.equal(
      fs.existsSync(path.join(publicDirectory, cleanReference)),
      true,
      `Missing local asset: ${reference}`
    );
    assert.equal(reference.startsWith('/'), false, `Root-relative asset: ${reference}`);
  }
});

test('uses unique element IDs and includes accessibility fallbacks', () => {
  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /aria-live="assertive"/);
  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /user-scalable=no/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
});

test('generates Pages runtime configuration for the canonical site', () => {
  assert.match(html, /https:\/\/lab\.liambroza\.com\/XRRC\//);
  assert.match(workflow, /XRRC_SIGNAL_URL: \$\{\{ vars\.XRRC_SIGNAL_URL \}\}/);
  assert.match(workflow, /siteUrl: 'https:\/\/lab\.liambroza\.com\/XRRC\/'/);
  assert.match(workflow, /path: public/);
});
