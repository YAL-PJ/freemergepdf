#!/usr/bin/env node
/**
 * build-i18n.mjs
 * Generates the localized homepages (<lang>/index.html) from the English
 * index.html plus the per-language dictionaries in tools/i18n/<lang>.json.
 *
 * Usage:  node tools/build-i18n.mjs          (from the repo root)
 *
 * After editing index.html or any dictionary, re-run this script and commit
 * the regenerated <lang>/index.html files. The script fails loudly when a
 * dictionary key no longer matches index.html, so translations can't silently
 * go stale.
 *
 * Per language it:
 *   1. Replaces every English string listed in the dictionary's "html" map
 *      (longest keys first, all occurrences).
 *   2. Localizes <html lang>, meta language, JSON-LD inLanguage, canonical /
 *      og:url / JSON-LD URLs (https://freemergepdf.com/ -> .../<lang>/),
 *      leaving the hreflang alternate cluster untouched.
 *   3. Rewrites relative asset URLs (css/js) to root-absolute so the shared
 *      assets load from the subdirectory.
 *   4. Marks the current language in the footer language switcher.
 *   5. Injects window.I18N_RUNTIME + i18n-runtime.js for strings that the app
 *      scripts write into the DOM at runtime.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const i18nDir = join(repoRoot, 'tools', 'i18n');

const source = readFileSync(join(repoRoot, 'index.html'), 'utf8');

const languageFiles = readdirSync(i18nDir).filter((f) => f.endsWith('.json')).sort();
if (languageFiles.length === 0) {
  console.error('No dictionaries found in tools/i18n/');
  process.exit(1);
}

const dictionaries = languageFiles.map((file) => {
  const dict = JSON.parse(readFileSync(join(i18nDir, file), 'utf8'));
  if (!dict.lang || !dict.html) {
    throw new Error(`${file}: dictionary must have "lang" and "html" fields`);
  }
  return dict;
});

// All dictionaries must translate the same set of English strings, so a key
// added for one language can't be silently missing from another.
const referenceKeys = Object.keys(dictionaries[0].html).sort();
for (const dict of dictionaries.slice(1)) {
  const keys = Object.keys(dict.html).sort();
  const missing = referenceKeys.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !referenceKeys.includes(k));
  if (missing.length || extra.length) {
    console.error(`Key mismatch in ${dict.lang}.json vs ${dictionaries[0].lang}.json`);
    missing.forEach((k) => console.error(`  missing: ${k.slice(0, 80)}`));
    extra.forEach((k) => console.error(`  extra:   ${k.slice(0, 80)}`));
    process.exit(1);
  }
}

let failures = 0;

for (const dict of dictionaries) {
  const { lang } = dict;
  let html = source;

  // 1. Translate static strings, longest keys first so that sentences
  //    containing shorter keys (e.g. button names quoted in FAQ answers)
  //    are replaced before the short key runs.
  const keys = Object.keys(dict.html).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (!html.includes(key)) {
      console.error(`[${lang}] key not found in index.html: ${key.slice(0, 100)}`);
      failures++;
      continue;
    }
    html = html.split(key).join(dict.html[key]);
  }

  // 2. Language + URL localization. Right-to-left languages (e.g. Arabic)
  //    declare "dir": "rtl" in their dictionary so the browser mirrors layout.
  const dirAttr = dict.dir ? ` dir="${dict.dir}"` : '';
  html = html.replace('<html lang="en">', `<html lang="${lang}"${dirAttr}>`);
  html = html.replace(
    '<meta name="language" content="English">',
    `<meta name="language" content="${dict.languageNameNative}">`
  );
  html = html.split('"inLanguage": "en"').join(`"inLanguage": "${lang}"`);
  html = html
    .split('\n')
    .map((line) => {
      // The hreflang cluster and the footer switcher must keep pointing at
      // every language's own URL.
      if (line.includes('rel="alternate" hreflang')) return line;
      return line
        .split('"https://freemergepdf.com/"').join(`"https://freemergepdf.com/${lang}/"`)
        .split('https://freemergepdf.com/#').join(`https://freemergepdf.com/${lang}/#`);
    })
    .join('\n');

  // 3. Root-relativize relative asset references (href/src not starting with
  //    a scheme, //, /, # or data:), e.g. src="index-page.js?v=14".
  html = html.replace(
    /\b(href|src)="(?!https?:|\/\/|\/|#|data:)([^"]+)"/g,
    (_, attr, url) => `${attr}="/${url}"`
  );

  // 4. Mark the active language in the footer switcher.
  html = html.replace(
    new RegExp(`<a href="/${lang}/" hreflang="${lang}"`),
    (m) => `${m.replace('<a ', '<a aria-current="page" ')}`
  );

  // 5. Inject the runtime translation dictionary + script.
  const runtimePayload = JSON.stringify({
    map: dict.runtime || {},
    patterns: dict.runtimePatterns || []
  });
  html = html.replace(
    '</body>',
    `    <script>window.I18N_RUNTIME = ${runtimePayload};</script>\n` +
    '    <script src="/i18n-runtime.js?v=1"></script>\n</body>'
  );

  const outDir = join(repoRoot, lang);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
  console.log(`Wrote ${lang}/index.html (${keys.length} strings)`);
}

if (failures > 0) {
  console.error(`\n${failures} dictionary key(s) no longer match index.html — fix before committing.`);
  process.exit(1);
}
