/* DeckHack preview bridge.
   Runs INSIDE the sandboxed preview iframe, before any deck code. It is injected at preview time only
   and is never written into the deck. It has no access to the DeckHack app, its storage or the API key:
   the iframe has an opaque origin, and the only channel is postMessage with a per-load token.
   The config placeholder below is replaced with a JSON object when the preview document is built. */
(function () {
  'use strict';
  var CFG = __PC_CONFIG__;
  var post = function (type, data) {
    var msg = { pc: CFG.token, type: type };
    for (var k in data || {}) msg[k] = data[k];
    parent.postMessage(msg, '*');
  };

  /* ---------- storage shim: sandboxed documents may not touch localStorage ---------- */
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try { void window[name].length; } catch (e) {
      var mem = {};
      var shim = {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem: function (k, v) { mem[k] = String(v); },
        removeItem: function (k) { delete mem[k]; },
        clear: function () { mem = {}; },
        key: function (i) { return Object.keys(mem)[i] || null; },
        get length() { return Object.keys(mem).length; },
      };
      try { Object.defineProperty(window, name, { value: shim, configurable: true }); } catch (e2) { /* keep going */ }
    }
  });

  /* history shim: a sandboxed document may not rewrite its URL; decks that sync ?slide= must not crash */
  ['replaceState', 'pushState'].forEach(function (name) {
    var orig = history[name];
    history[name] = function () { try { return orig.apply(history, arguments); } catch (e) { /* ignored in preview */ } };
  });

  /* ---------- errors ---------- */
  var errors = [];
  var report = function (text) {
    text = String(text).slice(0, 400);
    if (errors.length < 30 && errors.indexOf(text) < 0) { errors.push(text); post('error', { text: text }); }
  };
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && t.tagName) {
      if (t.hasAttribute('data-pc-asset') || t.hasAttribute('data-pc-pending')) return;
      var ref = t.getAttribute('src') || t.getAttribute('href') || '';
      if (ref && ref.slice(0, 5) !== 'data:') report('Failed to load ' + t.tagName.toLowerCase() + ': ' + ref);
      return;
    }
    report((e.message || 'Script error') + (e.lineno ? ' (line ' + e.lineno + ')' : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    report('Unhandled promise rejection: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });
  var origError = console.error;
  console.error = function () {
    report(Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : String(a); }).join(' '));
    return origError.apply(console, arguments);
  };

  /* ---------- assets: map relative references to data URLs or remote URLs ---------- */
  var ASSET_ATTRS = ['src', 'href', 'poster'];
  var norm = function (ref) {
    if (!ref || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null;
    var parts = CFG.entryDir ? CFG.entryDir.split('/') : [];
    var segs = ref.split('#')[0].split('?')[0].split('/');
    for (var i = 0; i < segs.length; i++) {
      if (!segs[i] || segs[i] === '.') continue;
      if (segs[i] === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(segs[i]);
    }
    return parts.join('/');
  };
  var fixEl = function (el) {
    if (el.nodeType !== 1 || el.tagName === 'A') return;
    for (var i = 0; i < ASSET_ATTRS.length; i++) {
      var v = el.getAttribute(ASSET_ATTRS[i]);
      if (!v) continue;
      var path = norm(v);
      if (path && CFG.assets[path]) {
        el.setAttribute('data-pc-asset', path);
        el.setAttribute(ASSET_ATTRS[i], CFG.assets[path]);
      }
    }
  };
  var fixTree = function (node) {
    if (node.nodeType !== 1) return;
    fixEl(node);
    var all = node.querySelectorAll ? node.querySelectorAll('[src],[href],[poster]') : [];
    for (var i = 0; i < all.length; i++) fixEl(all[i]);
  };
  new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'attributes') fixEl(r.target);
      else for (var j = 0; j < r.addedNodes.length; j++) fixTree(r.addedNodes[j]);
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ASSET_ATTRS });

  /* fetch() of text files that live in the deck (data.json and the like) */
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input && input.url;
    var path = norm(url || '');
    if (path && Object.prototype.hasOwnProperty.call(CFG.texts, path)) {
      return Promise.resolve(new Response(CFG.texts[path], { status: 200 }));
    }
    if (path && CFG.assets[path]) return origFetch.call(window, CFG.assets[path], init);
    return origFetch.apply(window, arguments);
  };

  /* ---------- animation freeze ("without animation") ---------- */
  var freezeStyle = null;
  var setFrozen = function (on) {
    if (on && !freezeStyle) {
      freezeStyle = document.createElement('style');
      freezeStyle.setAttribute('data-pc', 'freeze');
      freezeStyle.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;' +
        'transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}';
      (document.head || document.documentElement).appendChild(freezeStyle);
    } else if (!on && freezeStyle) { freezeStyle.remove(); freezeStyle = null; }
  };
  if (CFG.frozen) setFrozen(true);

  /* ---------- slide adapters ---------- */
  var SECTION_SELECTORS = ['.reveal .slides > section', 'section.slide', '.slide', '[data-slide]', 'main > section', 'body > section', 'article > section'];
  var COUNTER = /^\s*0*(\d{1,3})\s*(?:\/|\||of|von)\s*0*(\d{1,3})\s*$/i;
  var adapter = 'single', slides = [], counterEl = null;

  var detect = function () {
    var manifest = CFG.manifest || {};
    var selectors = manifest.slideSelector ? [manifest.slideSelector] : SECTION_SELECTORS;
    if (manifest.adapter !== 'keys') {
      for (var i = 0; i < selectors.length; i++) {
        var found;
        try { found = Array.prototype.slice.call(document.querySelectorAll(selectors[i])); } catch (e) { found = []; }
        found = found.filter(function (el) { return !found.some(function (o) { return o !== el && o.contains(el); }); });
        if (found.length >= 2) { adapter = 'sections'; slides = found; return; }
      }
    }
    var all = manifest.counterSelector ? document.querySelectorAll(manifest.counterSelector) : document.querySelectorAll('body *');
    for (var j = 0; j < all.length; j++) {
      if (all[j].children.length === 0 && COUNTER.test(all[j].textContent || '')) { adapter = 'keys'; counterEl = all[j]; return; }
    }
    adapter = 'single';
  };

  var readCounter = function () {
    var m = counterEl && COUNTER.exec(counterEl.textContent || '');
    return m ? { cur: +m[1], total: +m[2] } : { cur: 1, total: 1 };
  };
  var visibleArea = function (el) {
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return 0;
    var r = el.getBoundingClientRect();
    var w = Math.min(r.right, innerWidth) - Math.max(r.left, 0), h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
  };
  var count = function () { return adapter === 'sections' ? slides.length : adapter === 'keys' ? readCounter().total : 1; };
  var current = function () {
    if (adapter === 'keys') return readCounter().cur;
    if (adapter !== 'sections') return 1;
    var best = 0, bestArea = -1;
    for (var i = 0; i < slides.length; i++) { var a = visibleArea(slides[i]); if (a > bestArea) { bestArea = a; best = i; } }
    return best + 1;
  };
  var KEYCODES = { ArrowRight: 39, ArrowLeft: 37, Home: 36, End: 35, ' ': 32 };
  var press = function (key) {
    var init = { key: key, code: key === ' ' ? 'Space' : key, keyCode: KEYCODES[key] || 0, which: KEYCODES[key] || 0, bubbles: true, cancelable: true };
    var target = document.body || document.documentElement;
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
  };
  var walkTo = function (n) {
    for (var guard = 0; guard < 600 && current() !== n; guard++) {
      var before = current();
      press(before < n ? 'ArrowRight' : 'ArrowLeft');
      if (current() === before && guard > 40 && adapter === 'sections') break;
    }
  };
  var go = function (n) {
    n = Math.max(1, Math.min(count(), n | 0));
    if (adapter === 'sections') {
      slides[n - 1].scrollIntoView({ block: 'start', inline: 'start', behavior: 'instant' });
      if (current() !== n) walkTo(n);
    } else if (adapter === 'keys') {
      if (current() > n) { press('Home'); }
      walkTo(n);
    }
    return current();
  };
  var titleOf = function (n) {
    var root = adapter === 'sections' ? slides[n - 1] : document.body;
    if (!root) return '';
    var explicit = root.getAttribute('data-title') || root.getAttribute('aria-label');
    if (explicit) return explicit.trim().slice(0, 80);
    var hs = root.querySelectorAll('h1,h2,h3');
    for (var i = 0; i < hs.length; i++) {
      var t = (hs[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (t && (adapter === 'sections' || visibleArea(hs[i]) > 0)) return t.slice(0, 80);
    }
    return '';
  };

  /* Fingerprint of what is on screen now: markup, text and a few computed styles, hashed (FNV-1a). */
  var fingerprint = function (n) {
    var root = adapter === 'sections' ? slides[n - 1] : document.body;
    var h = 0x811c9dc5;
    var add = function (s) { for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } };
    if (!root) return '0';
    var els = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*'), 0, 800));
    var origin = root.getBoundingClientRect();
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.hasAttribute('data-pc') || el.tagName === 'SCRIPT') continue;
      var cs = getComputedStyle(el), r = el.getBoundingClientRect();
      add(el.tagName + '.' + (el.getAttribute('class') || '') + '|' + cs.display + cs.color + cs.backgroundColor + cs.fontSize + cs.fontFamily + cs.fontWeight +
        '|' + Math.round((r.left - origin.left) / 8) + ',' + Math.round((r.top - origin.top) / 8) + ',' + Math.round(r.width / 8) + ',' + Math.round(r.height / 8));
      var src = el.getAttribute('data-pc-asset') || (el.tagName === 'IMG' ? '' : el.getAttribute('src')) || '';
      if (src) add(src.slice(0, 200));
      for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) add(c.nodeValue.replace(/\s+/g, ' ').trim());
    }
    return (h >>> 0).toString(16);
  };

  var wait = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
  var probe = async function () {
    var wasFrozen = !!freezeStyle;
    setFrozen(true);
    var total = count(), titles = [], prints = [];
    for (var n = 1; n <= total; n++) {
      go(n);
      await wait(40);
      titles.push(titleOf(n));
      prints.push(fingerprint(n));
    }
    go(1);
    setFrozen(wasFrozen);
    return { adapter: adapter, count: total, titles: titles, fingerprints: prints, errors: errors.slice() };
  };

  /* ---------- pointing at an element (for comments about one thing on a slide) ---------- */
  var pickStyle = null, picking = false;
  var describe = function (el) {
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text && el.getAttribute) text = el.getAttribute('alt') || el.getAttribute('aria-label') || '';
    return { tag: el.tagName.toLowerCase(), text: text.slice(0, 80) };
  };
  var onPick = function (e) {
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();
    var el = e.target && e.target.nodeType === 1 ? e.target : null;
    if (!el || el === document.documentElement || el === document.body) return;
    var d = describe(el);
    post('picked', { tag: d.tag, text: d.text, slide: current() });
  };
  var setPicking = function (on) {
    picking = !!on;
    if (picking && !pickStyle) {
      pickStyle = document.createElement('style');
      pickStyle.setAttribute('data-pc', 'pick');
      pickStyle.textContent = '*{cursor:crosshair!important}*:hover{outline:2px solid #f2c12e!important;outline-offset:2px!important}';
      (document.head || document.documentElement).appendChild(pickStyle);
    } else if (!picking && pickStyle) { pickStyle.remove(); pickStyle = null; }
  };
  window.addEventListener('click', onPick, true);

  /* ---------- wiring ---------- */
  var lastPos = 0;
  var sendPos = function () {
    var cur = current();
    if (cur !== lastPos) { lastPos = cur; post('pos', { current: cur, count: count() }); }
  };
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (e.source !== parent || !m || m.pc !== CFG.token) return;
    if (m.cmd === 'go') { go(m.n); sendPos(); }
    else if (m.cmd === 'key') { press(m.key); sendPos(); }
    else if (m.cmd === 'freeze') setFrozen(!!m.on);
    else if (m.cmd === 'pick') setPicking(!!m.on);
    else if (m.cmd === 'probe') probe().then(function (result) { post('probe', { id: m.id, result: result }); });
  });
  var start = function () {
    setTimeout(function () {
      detect();
      if (CFG.startAt > 1) go(CFG.startAt);
      lastPos = current();
      post('ready', { adapter: adapter, count: count(), current: lastPos });
      setInterval(sendPos, 250);
    }, 60);
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
  setTimeout(function () { if (!lastPos) start(); }, 4000); /* decks whose load event never fires */
})();
