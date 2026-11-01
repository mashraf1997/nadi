'use strict';

// Translations live in /locales/<code>.json. Adding a language = adding a file.
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'locales');
const LOCALES = {};
for (const file of fs.readdirSync(DIR).sort()) {
  if (!file.endsWith('.json')) continue;
  LOCALES[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
}

// English first, Arabic second, then alphabetical by code.
const LANGS = Object.keys(LOCALES).sort((a, b) => {
  const rank = (c) => (c === 'en' ? 0 : c === 'ar' ? 1 : 2);
  return rank(a) - rank(b) || a.localeCompare(b);
});

const LANGUAGES = LANGS.map((code) => ({ code, name: LOCALES[code].meta.name, dir: LOCALES[code].meta.dir }));

// Storefront strings (plus dir/langName), falling back to English for any missing key.
function strings(lang) {
  const loc = LOCALES[lang] || LOCALES.en;
  return { ...LOCALES.en.store, ...loc.store, dir: loc.meta.dir, langName: loc.meta.name };
}

function adminStrings(lang) {
  const loc = LOCALES[lang] || LOCALES.en;
  return { ...LOCALES.en.admin, ...loc.admin, dir: loc.meta.dir };
}

module.exports = { strings, adminStrings, LANGS, LANGUAGES };
