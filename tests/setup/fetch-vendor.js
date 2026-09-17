/**
 * Playwright globalSetup: cache the two CDN libraries the app loads (pdf.js and
 * pdf-lib) into tests/.cache so the tests can serve them locally.
 *
 * Why: index.html pulls pdf.js and pdf-lib from cdnjs. In a sandboxed or offline CI
 * box the browser often cannot reach (or cannot verify TLS for) that CDN, which would
 * make every merge test fail for a reason that has nothing to do with the app. We
 * download the files once with Node, cache them (gitignored — no vendored binaries in
 * the repo), and the test harness fulfils the browser's CDN requests from that cache.
 *
 * If the download fails and nothing is cached, the merge tests say so loudly instead of
 * failing with a confusing "PDFLib is undefined".
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CACHE_DIR = path.join(__dirname, '..', '.cache');

// Keep in sync with the <script src> tags in index.html.
const VENDOR = [
  {
    file: 'pdf.min.js',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    match: '/pdf.js/3.11.174/pdf.min.js'
  },
  {
    file: 'pdf-lib.min.js',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
    match: '/pdf-lib/1.17.1/pdf-lib.min.js'
  }
];

async function ensureVendorCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  for (const entry of VENDOR) {
    const target = path.join(CACHE_DIR, entry.file);
    if (fs.existsSync(target) && fs.statSync(target).size > 1000) continue;
    try {
      const res = await fetch(entry.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      console.log(`[tests] cached ${entry.file}`);
    } catch (err) {
      console.warn(`[tests] could not cache ${entry.file} (${err.message}); ` +
        'the browser will try the CDN directly.');
    }
  }
}

module.exports = ensureVendorCache;
module.exports.VENDOR = VENDOR;
module.exports.CACHE_DIR = CACHE_DIR;

if (require.main === module) ensureVendorCache();
