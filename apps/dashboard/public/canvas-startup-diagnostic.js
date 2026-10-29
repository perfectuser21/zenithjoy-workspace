/* Staging bootstrap diagnostics: only fixed error categories, asset basenames,
   and readiness flags are reported; never send error text or page data. */
(function () {
  'use strict';
  var count = 0;
  function report(kind, detail) {
    if (count++ >= 12) return;
    try {
      fetch('/api/creative-canvas/__diag/' + kind + '/' + detail, {
        method: 'POST', credentials: 'same-origin', keepalive: true
      }).catch(function () {});
    } catch (_) {}
  }
  function assetName(value) {
    try {
      var url = new URL(value, window.location.origin);
      var prefix = '/api/creative-canvas/assets/';
      var name = url.pathname.slice(prefix.length);
      if (url.origin === window.location.origin && url.pathname.indexOf(prefix) === 0 && /^(?=.{1,100}$)[a-zA-Z0-9_.-]+-[a-zA-Z0-9_-]{8,}\.js$/.test(name)) return name;
    } catch (_) {}
    return 'other';
  }
  function classify(message) {
    var text = String(message || '').toLowerCase();
    if (/syntaxerror|unexpected token|invalid regular expression/.test(text)) return 'syntax';
    if (/importing a module|dynamically imported module|failed to fetch.*module/.test(text)) return 'module-fetch';
    if (/content security policy|securityerror|blocked by.*policy/.test(text)) return 'security';
    return 'other';
  }
  report('start', 'ok');
  window.addEventListener('error', function (event) {
    var name = event.filename || (event.target && (event.target.src || event.target.href)) || '';
    report(event.message ? classify((event.error && event.error.name || '') + ' ' + event.message) : 'resource', assetName(name));
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
      report('t' + (delay / 1000), status + 'c' + total + 'l' + loaded);
    }, delay);
  });
}());
