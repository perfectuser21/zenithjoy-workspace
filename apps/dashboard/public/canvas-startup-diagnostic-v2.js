/* global window, document, fetch, URL */
/* Staging bootstrap diagnostics: only fixed error categories, asset basenames,
   and readiness flags are reported; never send error text or page data. */
(function () {
  'use strict';
  var count = 0, probes = 0, probed = {};
  function report(kind, detail, essential) {
    if (!essential && count++ >= 12) return;
    try {
      fetch('/api/creative-canvas/__diag/' + kind + '/' + detail, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', keepalive: true
      }).catch(function () {});
    } catch { /* Diagnostics must not interrupt the canvas. */ }
  }
  function assetInfo(value) {
    try {
      var url = new URL(value, window.location.origin);
      var match = url.pathname.match(/^\/(?:api\/creative-canvas\/assets|assets\/comfy\/593af1d79767cefc3587c862dd3b3d90ff00530c5f83071522f8f9807c175346\/assets)\/([a-zA-Z0-9_.-]+-[a-zA-Z0-9_-]{8,}\.(?:js|css))$/);
      if (url.origin === window.location.origin && match && match[1].length <= 100) return {name: match[1], path: url.pathname};
    } catch { /* Diagnostics must not interrupt the canvas. */ }
    return {name: 'other', path: ''};
  }
  function classify(message) {
    var text = String(message || '').toLowerCase();
    if (/syntaxerror|unexpected token|invalid regular expression/.test(text)) return 'syntax';
    if (/importing a module|dynamically imported module|failed to fetch.*module/.test(text)) return 'module-fetch';
    if (/content security policy|securityerror|blocked by.*policy/.test(text)) return 'security';
    return 'other';
  }
  function probe(name, path) {
    if (name === 'other' || probes >= 2 || probed[name]) return;
    probed[name] = true;
    probes++;
    // Build the request from the validated basename, never from the URL or query.
    var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    var timeout = controller ? window.setTimeout(function () { controller.abort(); }, 10000) : null;
    function clearProbeTimeout() { if (timeout !== null) window.clearTimeout(timeout); }
    try {
      var options = {method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'manual'};
      if (controller) options.signal = controller.signal;
      fetch(path, options).then(function (response) {
        clearProbeTimeout();
        var code = response.status;
        var kind = code === 401 || code === 403 || code === 404 || code === 429 ? String(code) :
          code >= 500 && code <= 599 ? '5xx' : code >= 200 && code <= 299 ? '2xx' :
          code >= 300 && code <= 399 ? '3xx' : 'other';
        if (kind === '2xx' && response.headers) {
          var mime = String(response.headers.get('content-type') || '').toLowerCase();
          kind += mime.indexOf('text/html') === 0 ? 'html' : /^(text|application)\/(javascript|x-javascript)/.test(mime) ? 'js' : 'other';
        }
        if (response.body && typeof response.body.cancel === 'function') {
          try { response.body.cancel().catch(function () {}); } catch { /* Ignore cleanup failure. */ }
        }
        report('probe' + kind, name, true);
      }).catch(function () { clearProbeTimeout(); report('probenetwork', name, true); });
    } catch { clearProbeTimeout(); report('probenetwork', name, true); }
  }
  report('start', 'ok', true);
  window.addEventListener('error', function (event) {
    var name = event.filename || (event.target && (event.target.src || event.target.href)) || '';
    var asset = assetInfo(name), safeName = asset.name;
    report(event.message ? classify((event.error && event.error.name || '') + ' ' + event.message) : 'resource', safeName);
    if (!event.message) probe(safeName, asset.path);
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    report(classify(event.reason && ((event.reason.name || '') + ' ' + (event.reason.message || ''))), 'promise');
  });
  [10000, 60000, 120000].forEach(function (delay) {
    window.setTimeout(function () {
      var app = window.app;
      var status = 'a' + (app ? '1' : '0') + 'g' + (app && app.graph ? '1' : '0') + 's' + (document.getElementById('splash-loader') ? '1' : '0');
      var styles = document.querySelectorAll('link[rel=stylesheet]');
      var total = 0, loaded = 0;
      for (var i = 0; i < styles.length; i++) {
        if (assetInfo(styles[i].href || '').name !== 'other') { total++; if (styles[i].sheet) loaded++; }
      }
      report('t' + (delay / 1000), status + 'c' + total + 'l' + loaded, true);
    }, delay);
  });
}());
