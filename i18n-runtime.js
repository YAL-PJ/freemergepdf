/**
 * i18n-runtime.js
 * Loaded ONLY on localized pages (/es/, /fr/, ...). Translates strings that
 * the app scripts (index-page.js, advanced-pdf-merger.js, page-merge-ui.js)
 * write into the DOM at runtime — status messages, button labels, errors —
 * without modifying those scripts.
 *
 * Reads window.I18N_RUNTIME injected by tools/build-i18n.mjs:
 *   { map: { "English": "Translated", ... },
 *     patterns: [{ match: "^regex$", replace: "template with $1" }, ...] }
 *
 * Works by observing text mutations and rewriting any text node whose
 * (trimmed) content matches a known English string or pattern. Rewrites only
 * happen when the translation differs, so the observer cannot loop.
 */
(function () {
  'use strict';

  var config = window.I18N_RUNTIME;
  if (!config || typeof MutationObserver === 'undefined') return;

  var map = config.map || {};
  var patterns = (config.patterns || []).map(function (p) {
    try {
      return { re: new RegExp(p.match), replace: p.replace };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);

  function translate(text) {
    var trimmed = text.trim();
    if (!trimmed) return null;

    var exact = map[trimmed];
    if (exact) return text.replace(trimmed, exact);

    for (var i = 0; i < patterns.length; i++) {
      var m = trimmed.match(patterns[i].re);
      if (!m) continue;
      var out = patterns[i].replace;
      for (var g = m.length - 1; g >= 1; g--) {
        // Captured fragments (e.g. a skip reason) may themselves be known strings.
        var frag = m[g] === undefined ? '' : m[g];
        out = out.split('$' + g).join(map[frag] || frag);
      }
      return text.replace(trimmed, out);
    }
    return null;
  }

  function translateTextNode(node) {
    var translated = translate(node.nodeValue || '');
    if (translated !== null && translated !== node.nodeValue) {
      node.nodeValue = translated;
    }
  }

  function walk(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    var tag = root.nodeName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var parent = n.parentNode && n.parentNode.nodeName;
        return (parent === 'SCRIPT' || parent === 'STYLE' || parent === 'NOSCRIPT')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      }
    });
    var current;
    while ((current = walker.nextNode())) translateTextNode(current);
  }

  function start() {
    walk(document.body);
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (mutation.type === 'characterData') {
          translateTextNode(mutation.target);
        } else if (mutation.type === 'childList') {
          for (var j = 0; j < mutation.addedNodes.length; j++) {
            walk(mutation.addedNodes[j]);
          }
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
