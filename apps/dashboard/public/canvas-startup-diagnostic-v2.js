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
  function assetName(value) {
    try {
      var url = new URL(value, window.location.origin);
      var prefix = '/api/creative-canvas/assets/';
      var name = url.pathname.slice(prefix.length);
      if (url.origin === window.location.origin && url.pathname.indexOf(prefix) === 0 && /^(?=.{1,100}$)[a-zA-Z0-9_.-]+-[a-zA-Z0-9_-]{8,}\.js$/.test(name)) return name;
    } catch { /* Diagnostics must not interrupt the canvas. */ }
    return 'other';
  }
  function classify(message) {
    var text = String(message || '').toLowerCase();
    if (/syntaxerror|unexpected token|invalid regular expression/.test(text)) return 'syntax';
    if (/importing a module|dynamically imported module|failed to fetch.*module/.test(text)) return 'module-fetch';
    if (/content security policy|securityerror|blocked by.*policy/.test(text)) return 'security';
    return 'other';
  }
  function probe(name) {
    if (name === 'other' || probes >= 2 || probed[name]) return;
    probed[name] = true;
    probes++;
    // Build the request from the validated basename, never from the URL or query.
    try {
      fetch('/api/creative-canvas/assets/' + name, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'manual'
      }).then(function (response) {
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
      }).catch(function () { report('probenetwork', name, true); });
    } catch { report('probenetwork', name, true); }
  }
  report('start', 'ok', true);
  window.addEventListener('error', function (event) {
    var name = event.filename || (event.target && (event.target.src || event.target.href)) || '';
    var safeName = assetName(name);
    report(event.message ? classify((event.error && event.error.name || '') + ' ' + event.message) : 'resource', safeName);
    if (!event.message) probe(safeName);
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
        if ((styles[i].href || '').indexOf('/api/creative-canvas/assets/') >= 0) { total++; if (styles[i].sheet) loaded++; }
      }
      report('t' + (delay / 1000), status + 'c' + total + 'l' + loaded, true);
    }, delay);
  });
}());
