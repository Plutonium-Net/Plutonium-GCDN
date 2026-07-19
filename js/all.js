/* all.js — Plutonium GCDN global script, injected into every game page */

(function () {
  'use strict';

  var s = document.createElement('script');
  s.src = '/js/sync.js';
  (document.head || document.documentElement).appendChild(s);
})();
