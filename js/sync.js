(function () {
  'use strict';

  /* ── localStorage bridge (unchanged) ───────────────────────────────────── */

  function snapshotLocal() {
    var out = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        out[k] = localStorage.getItem(k);
      }
    } catch (_) {}
    return out;
  }

  function applyLocal(saves) {
    try {
      var keys = Object.keys(saves);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i] === IDB_KEY) continue;
        localStorage.setItem(keys[i], saves[keys[i]]);
      }
    } catch (_) {}
  }

  /* ── IndexedDB bridge for Unity WebGL ───────────────────────────────────
     Unity's WebGL player never touches localStorage. It mounts Emscripten's
     IDBFS at /idbfs and keeps PlayerPrefs there, inside IndexedDB:

         database: "/idbfs"    store: "FILE_DATA"    index: "timestamp"
         record:   { timestamp: Date, mode: <int>, contents?: Uint8Array }
         keyed by absolute path through out-of-line keys (no keyPath)

     We copy those records out as opaque bytes and put them back verbatim, so
     nothing here needs to understand Unity's binary PlayerPrefs format.

     The payload rides inside the existing `saves` map under IDB_KEY, which
     means a host that persists `saves` opaquely needs no protocol changes.
  ─────────────────────────────────────────────────────────────────────────── */

  var IDB_KEY = '__plu_idb__';
  var IDB_DB = '/idbfs';
  var IDB_STORE = 'FILE_DATA';
  var RELOAD_COUNT_KEY = '__plu_idb_reloads__';
  var MAX_RELOADS = 3; // loop-breaker; not expected to be reached
  var IDB_POLL_MS = 15000;

  var restoring = false; // a restore is in flight; stop snapshots
  var lastIdbPayload = null;

  function b64FromBytes(u8) {
    var s = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < u8.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  function bytesFromB64(b64) {
    var bin = atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function asBytes(v) {
    if (!v) return null;
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    if (typeof v === 'string') {
      var out = new Uint8Array(v.length);
      for (var i = 0; i < v.length; i++) out[i] = v.charCodeAt(i) & 0xff;
      return out;
    }
    return null;
  }

  function stamp(rec) {
    var t = rec && rec.timestamp;
    if (t instanceof Date) return t.getTime();
    if (typeof t === 'number') return t;
    return 0;
  }

  function newest(recs) {
    var max = 0;
    for (var i = 0; i < recs.length; i++) {
      var t = typeof recs[i].t === 'number' ? recs[i].t : 0;
      if (t > max) max = t;
    }
    return max;
  }

  /* Opens /idbfs without ever passing an explicit version, so we can never
     force an upgrade Unity would not expect. With `create` we lay down the
     same schema Unity uses (no keyPath, non-unique "timestamp" index) so a
     save can be seeded into a browser that has never run the game; Unity
     later opens the same database at its own version and finds it in place.
     Without `create`, a database we had to create ourselves is torn down. */
  function openIdb(create, cb) {
    if (typeof indexedDB === 'undefined') return cb('no indexeddb');
    var created = false;
    var req;
    try {
      req = indexedDB.open(IDB_DB);
    } catch (e) {
      return cb(e);
    }
    req.onupgradeneeded = function () {
      created = true;
      if (!create) return;
      try {
        req.result.createObjectStore(IDB_STORE).createIndex('timestamp', 'timestamp', { unique: false });
      } catch (_) {}
    };
    req.onsuccess = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        try { db.close(); } catch (_) {}
        if (created && !create) {
          try { indexedDB.deleteDatabase(IDB_DB); } catch (_) {}
        }
        return cb('no store');
      }
      cb(null, db);
    };
    req.onerror = function () {
      cb(req.error || 'open failed');
    };
    req.onblocked = function () {
      cb('blocked');
    };
  }

  function readAll(db, cb) {
    var out = [];
    var tx, req;
    try {
      tx = db.transaction([IDB_STORE], 'readonly');
      req = tx.objectStore(IDB_STORE).openCursor();
    } catch (e) {
      return cb(e);
    }
    req.onsuccess = function (e) {
      var cur = e.target.result;
      if (!cur) return cb(null, out);
      var v = cur.value || {};
      var bytes = asBytes(v.contents);
      out.push({
        p: String(cur.key),
        m: typeof v.mode === 'number' ? v.mode : 0,
        t: stamp(v) || Date.now(),
        d: bytes ? b64FromBytes(bytes) : null
      });
      cur.continue();
    };
    req.onerror = function () {
      cb(req.error || 'read failed');
    };
  }

  function writeAll(db, recs, cb) {
    var tx;
    try {
      tx = db.transaction([IDB_STORE], 'readwrite');
      var store = tx.objectStore(IDB_STORE);
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (!r || !r.p) continue;
        var rec = { timestamp: new Date(typeof r.t === 'number' ? r.t : Date.now()), mode: r.m };
        if (r.d) rec.contents = bytesFromB64(r.d);
        store.put(rec, r.p); // out-of-line key, exactly like IDBFS does
      }
    } catch (e) {
      return cb(e);
    }
    tx.oncomplete = function () { cb(null); };
    tx.onerror = function () { cb(tx.error || 'write failed'); };
    tx.onabort = function () { cb(tx.error || 'write aborted'); };
  }

  /* Snapshot the whole /idbfs store. Records belonging to other Unity games
     may be present (one MD5-named directory per game); they are inert on
     restore, because each game only ever reads its own directory. */
  function readIdbPayload(cb) {
    openIdb(false, function (err, db) {
      if (err || !db) return cb(null);
      readAll(db, function (err2, recs) {
        try { db.close(); } catch (_) {}
        if (err2 || !recs || !recs.length) return cb(null);
        cb(JSON.stringify(recs));
      });
    });
  }

  /* Restore is staged into IndexedDB and then the page reloads, because the
     player populates its in-memory filesystem from /idbfs exactly once while
     booting: FS.mount(IDBFS, {}, "/idbfs") then FS.syncfs(true, ...) held open
     as a run dependency. Landing the bytes before that populate makes it just
     work; injecting them into a running player would be reconciled away.
     The reload is the boring, bulletproof half of this design. */
  function maybeRestoreIdb(json) {
    if (!json || restoring) return;
    var incoming;
    try {
      incoming = JSON.parse(json);
    } catch (e) {
      return;
    }
    if (!incoming || !incoming.length) return;

    openIdb(true, function (err, db) {
      if (err || !db) return;
      readAll(db, function (err2, local) {
        if (err2) { try { db.close(); } catch (_) {} return; }

        // Never roll a player's newer local progress back to an older save.
        // This also stops a host that re-pushes the same save on every launch
        // from causing a reload loop.
        if (newest(incoming) <= newest(local)) {
          try { db.close(); } catch (_) {}
          return;
        }

        var reloads = 0;
        try {
          reloads = parseInt(sessionStorage.getItem(RELOAD_COUNT_KEY), 10) || 0;
        } catch (_) {}
        if (reloads >= MAX_RELOADS) {
          try { db.close(); } catch (_) {}
          return;
        }

        restoring = true;
        writeAll(db, incoming, function (werr) {
          try { db.close(); } catch (_) {}
          if (werr) { restoring = false; return; }
          try { sessionStorage.setItem(RELOAD_COUNT_KEY, String(reloads + 1)); } catch (_) {}
          try { location.reload(); } catch (_) {}
        });
      });
    });
  }

  /* ── Snapshot scheduling ───────────────────────────────────────────────── */

  function sendSnapshot() {
    if (restoring) return;
    var saves = snapshotLocal();
    if (lastIdbPayload) saves[IDB_KEY] = lastIdbPayload;
    try {
      window.parent.postMessage({ plu: true, type: 'plu_sync_data', saves: saves }, '*');
    } catch (_) {}
  }

  var _debounce = null;
  function scheduleSnapshot() {
    clearTimeout(_debounce);
    _debounce = setTimeout(sendSnapshot, 800);
  }

  /* Cheap path: the cached payload goes out on every tick, but IndexedDB is
     only re-read on a real write or every IDB_POLL_MS. */
  setInterval(refreshIdb, IDB_POLL_MS);
  setInterval(sendSnapshot, 5000);

  function refreshIdb() {
    if (restoring) return;
    readIdbPayload(function (payload) {
      if (payload === lastIdbPayload) return;
      lastIdbPayload = payload;
      scheduleSnapshot();
    });
  }

  var _origSetItem = Storage.prototype.setItem;
  var _origRemoveItem = Storage.prototype.removeItem;
  var _origClear = Storage.prototype.clear;

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

  /* ── Flush detection ────────────────────────────────────────────────────
     The player keeps its working copy in memory and only pushes it into
     IndexedDB when it flushes (PlayerPrefs.Save(), plus a periodic sync).
     Watching writes to the IDBFS store gives us that exact moment without
     needing a handle on Unity's internal FS/IDBFS objects, which are not
     exposed on window in release builds. */
  (function installWriteHook() {
    if (typeof IDBObjectStore === 'undefined') return;
    var proto = IDBObjectStore.prototype;
    if (proto.__pluHooked) return;
    var originalPut = proto.put;
    var originalDelete = proto.delete;
    proto.put = function () {
      var result = originalPut.apply(this, arguments);
      try { if (this.name === IDB_STORE) refreshIdb(); } catch (_) {}
      return result;
    };
    proto.delete = function () {
      var result = originalDelete.apply(this, arguments);
      try { if (this.name === IDB_STORE) refreshIdb(); } catch (_) {}
      return result;
    };
    try { proto.__pluHooked = true; } catch (_) {}
  })();

  /* ── Host messages ─────────────────────────────────────────────────────── */

  window.addEventListener('message', function (e) {
    if (!e.data || !e.data.plu) return;
    if (e.data.type === 'plu_sync_restore') {
      var saves = e.data.saves || {};
      applyLocal(saves);
      maybeRestoreIdb(saves[IDB_KEY]);
    }
    if (e.data.type === 'plu_sync_request') {
      refreshIdb();
      sendSnapshot();
    }
  });

  try {
    window.parent.postMessage({ plu: true, type: 'plu_sync_ready' }, '*');
  } catch (_) {}

})();
