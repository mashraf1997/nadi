'use strict';

// Storefront themes and fonts. A theme is a CSS class on <body>; every theme
// uses the same HTML, so adding one is a block of CSS in public/css/book.css.

const THEMES = ['fresh', 'soft', 'elegant', 'bold'];

// Every font covers Arabic (or pairs a Latin face with an Arabic one).
const FONTS = {
  cairo: { label: 'Cairo', stack: "'Cairo'", query: 'family=Cairo:wght@400;600;700;800' },
  tajawal: { label: 'Tajawal', stack: "'Tajawal'", query: 'family=Tajawal:wght@400;500;700;800' },
  plex: { label: 'IBM Plex', stack: "'IBM Plex Sans Arabic'", query: 'family=IBM+Plex+Sans+Arabic:wght@400;500;600;700' },
  serif: {
    label: 'Playfair · Amiri',
    stack: "'Playfair Display', 'Amiri'",
    query: 'family=Playfair+Display:wght@500;700;800&family=Amiri:wght@400;700',
  },
  rounded: {
    label: 'Nunito · Baloo',
    stack: "'Nunito', 'Baloo Bhaijaan 2'",
    query: 'family=Nunito:wght@400;600;800&family=Baloo+Bhaijaan+2:wght@400;600;800',
  },
};

const DEVANAGARI = 'family=Noto+Sans+Devanagari:wght@400;600;700';

function cleanTheme(v) {
  return THEMES.includes(v) ? v : 'fresh';
}

function cleanFont(v) {
  return Object.prototype.hasOwnProperty.call(FONTS, v) ? v : 'cairo';
}

function fontHref(font, lang) {
  const f = FONTS[cleanFont(font)];
  return `https://fonts.googleapis.com/css2?${f.query}${lang === 'hi' ? `&${DEVANAGARI}` : ''}&display=swap`;
}

function fontStack(font) {
  return `${FONTS[cleanFont(font)].stack}, 'Noto Sans Devanagari', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif`;
}

/** What the admin's appearance screen needs. */
function appearanceOptions(lang) {
  return {
    themes: THEMES,
    fonts: Object.entries(FONTS).map(([key, f]) => ({ key, label: f.label, stack: fontStack(key), href: fontHref(key, lang) })),
  };
}

// A stable pastel hue per product, for the placeholder tile behind its emoji.
function hueFor(text) {
  let h = 0;
  for (const ch of String(text || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

module.exports = { THEMES, FONTS, cleanTheme, cleanFont, fontHref, fontStack, appearanceOptions, hueFor };
