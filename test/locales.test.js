'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('every locale has exactly the same keys as English', () => {
  const dir = path.join(__dirname, '..', 'locales');
  const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 8);
  for (const file of files) {
    const loc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.ok(loc.meta && loc.meta.name && ['ltr', 'rtl'].includes(loc.meta.dir), `${file} meta`);
    for (const section of ['store', 'admin']) {
      assert.deepEqual(Object.keys(loc[section]).sort(), Object.keys(en[section]).sort(), `${file} ${section}`);
      for (const [k, v] of Object.entries(loc[section])) assert.ok(typeof v === 'string' && v.length, `${file} ${section}.${k}`);
    }
    // Placeholders must survive translation, in every string.
    for (const section of ['store', 'admin']) {
      for (const [k, v] of Object.entries(en[section])) {
        for (const ph of v.match(/\{\w+\}/g) || []) assert.ok(loc[section][k].includes(ph), `${file} ${section}.${k} keeps ${ph}`);
      }
    }
  }
});
