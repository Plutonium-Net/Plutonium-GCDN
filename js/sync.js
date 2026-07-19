/**
 * sync.js — Plutonium GCDN save-sync shim
 *
 * Runs inside every game page (on g.cdn.plutoniumnet.work).
 * Bridges this origin's localStorage to the parent Plutonium page via postMessage.
 *
 * ── Protocol ────────────────────────────────────────────────────────────────
 *
 *  Game → Parent
 *    { plu:true, type:'plu_sync_ready' }
 *      Fired immediately on load. Parent should respond with plu_sync_restore
 *      as fast as possible — ideally it has the data pre-fetched already.
 *
 *    { plu:true, type:'plu_sync_data', saves:{ key:value, … } }
 *      Full localStorage snapshot. Sent in response to plu_sync_request,
 *      and automatically debounced 800 ms after any localStorage write/remove.
 *
 *  Parent → Game
 *    { plu:true, type:'plu_sync_restore', saves:{ key:value, … } }
 *      Write every key/value into this origin's localStorage synchronously.
 *      Sent as a direct reply to plu_sync_ready (pre-fetched saves) or
 *      on-demand after a fresh Firestore fetch.
 *
 *    { plu:true, type:'plu_sync_request' }
 *      Ask for a fresh snapshot right now (e.g. on viewer close).
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
      window.parent.postMessage(
        { plu: true, type: 'plu_sync_data', saves: snapshot() },
        '*'
      );
    } catch (_) {}
  }

  function applyRestore(saves) {
    if (!saves) return;
    try {
      var keys = Object.keys(saves);
      for (var i = 0; i < keys.length; i++) {
        localStorage.setItem(keys[i], saves[keys[i]]);
      }
    } catch (_) {}
  }

  /* ── Debounced auto-push on any localStorage write ─────────────────────── */
  var _debounce = null;
  function scheduleSnapshot() {
    clearTimeout(_debounce);
    _debounce = setTimeout(sendSnapshot, 800);
  }

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

    if (e.data.type === 'plu_sync_restore') {
      applyRestore(e.data.saves);
    }

    if (e.data.type === 'plu_sync_request') {
      sendSnapshot();
    }
  });

  /* ── Announce ready to parent so it can push pre-fetched saves ──────────── */
  try {
    window.parent.postMessage({ plu: true, type: 'plu_sync_ready' }, '*');
  } catch (_) {}

})();
