/**
 * all.js — Plutonium GCDN global script
 *
 * Injected into every game page via <script src="/js/all.js">.
 * Must run synchronously before any game scripts so that localStorage
 * is pre-populated with cloud saves before the game reads it.
 *
 * ── postMessage protocol ─────────────────────────────────────────────────────
 *
 *  Game → Parent
 *    { plu:true, type:'plu_sync_ready' }
 *      Fired at the end of this script. Parent replies immediately with
 *      plu_sync_restore if it has pre-fetched saves ready.
 *
 *    { plu:true, type:'plu_sync_data', saves:{ key:value, … } }
 *      Full localStorage snapshot. Sent every 1 s and after any write.
 *
 *  Parent → Game
 *    { plu:true, type:'plu_sync_restore', saves:{ key:value, … } }
 *      Writes every key/value into localStorage synchronously.
 *
 *    { plu:true, type:'plu_sync_request' }
 *      Asks for a fresh snapshot immediately.
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function snapshot() {
    var out = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        out[k] = localStorage.getItem(k);
      }
    } catch (_) {}
    return out;
  }

  function sendSnapshot() {
    try {
      var saves = snapshot();
      console.log('[plu-sync] sending snapshot —', Object.keys(saves).length, 'key(s)');
      window.parent.postMessage({ plu: true, type: 'plu_sync_data', saves: saves }, '*');
    } catch (_) {}
  }

  function applyRestore(saves) {
    if (!saves) return;
    try {
      var keys = Object.keys(saves);
      console.log('[plu-sync] restoring', keys.length, 'key(s):', keys);
      for (var i = 0; i < keys.length; i++) {
        localStorage.setItem(keys[i], saves[keys[i]]);
      }
      console.log('[plu-sync] restore complete');
    } catch (_) {}
  }

  /* ── Auto-push: every 1 s + debounce 800 ms after any write ────────────── */
  var _debounce = null;
  function scheduleSnapshot() {
    clearTimeout(_debounce);
    _debounce = setTimeout(sendSnapshot, 800);
  }

  setInterval(sendSnapshot, 1000);

  /* ── Intercept localStorage writes ─────────────────────────────────────── */
  var _origSetItem    = Storage.prototype.setItem;
  var _origRemoveItem = Storage.prototype.removeItem;
  var _origClear      = Storage.prototype.clear;

  try {
    Storage.prototype.setItem = function (key, value) {
      _origSetItem.call(this, key, value);
      if (this === localStorage) scheduleSnapshot();
    };
    Storage.prototype.removeItem = function (key) {
      _origRemoveItem.call(this, key);
      if (this === localStorage) scheduleSnapshot();
    };
    Storage.prototype.clear = function () {
      _origClear.call(this);
      if (this === localStorage) scheduleSnapshot();
    };
  } catch (_) {}

  /* ── Respond to parent messages ─────────────────────────────────────────── */
  window.addEventListener('message', function (e) {
    if (!e.data || !e.data.plu) return;
    if (e.data.type === 'plu_sync_restore') applyRestore(e.data.saves);
    if (e.data.type === 'plu_sync_request') sendSnapshot();
  });

  /* ── Announce ready — parent will reply with plu_sync_restore if saves exist */
  console.log('[plu-sync] ready');
  try {
    window.parent.postMessage({ plu: true, type: 'plu_sync_ready' }, '*');
  } catch (_) {}

})();
