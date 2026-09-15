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
        if (keys[i] === IDB_KEY || keys[i] === C3_KEY) continue;
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

  /* ── IndexedDB bridge for Construct 3 (localforage) ─────────────────────
     A Construct export does not touch localStorage either. Its LocalStorage
     plugin and its save slots both sit on top of localforage, which picks the
     IndexedDB driver whenever IndexedDB is available, and localforage gives
     each store its own database:

         database: "c3-localstorage-<projectUniqueId>"   store: "keyvaluepairs"
         database: "c3-savegames-<projectUniqueId>"      store: "keyvaluepairs"
         record:   { key: <string>, value: <structured clone> }
         version 2, out-of-line string keys

     So a C3 game's progress is invisible to the localStorage half above and to
     the Unity /idbfs half below; it needs this third bridge. We carry the
     records as packed JSON under C3_KEY, covering every c3-* database on the
     origin at once, the same way one /idbfs snapshot covers every Unity game.
  ─────────────────────────────────────────────────────────────────────────── */

  var C3_KEY = '__plu_c3__';
  var C3_STORE = 'keyvaluepairs';
  var C3_PREFIXES = ['c3-localstorage-', 'c3-savegames-'];
  var C3_RELOAD_COUNT_KEY = '__plu_c3_reloads__';
  var C3_SETTLE_MS = 500; // wait out the write transaction before re-reading

  var restoring = false; // a restore is in flight; stop snapshots
  var lastIdbPayload = null;
  var lastC3Payload = null;
  var c3DbNames = [];

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
  function openStoreDb(name, store, create, upgrade, cb) {
    if (typeof indexedDB === 'undefined') return cb('no indexeddb');
    var created = false;
    var req;
    try {
      req = indexedDB.open(name);
    } catch (e) {
      return cb(e);
    }
    req.onupgradeneeded = function () {
      created = true;
      if (!create) return;
      try {
        var store2 = req.result.createObjectStore(store);
        if (upgrade) upgrade(store2);
      } catch (_) {}
    };
    req.onsuccess = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(store)) {
        try { db.close(); } catch (_) {}
        if (created && !create) {
          try { indexedDB.deleteDatabase(name); } catch (_) {}
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

  /* The Unity wrapper: same dance, plus the "timestamp" index IDBFS expects. */
  function openIdb(create, cb) {
    openStoreDb(IDB_DB, IDB_STORE, create, function (store) {
      store.createIndex('timestamp', 'timestamp', { unique: false });
    }, cb);
  }

  function readAll(db, store, cb) {
    var out = [];
    var tx, req;
    try {
      tx = db.transaction([store], 'readonly');
      req = tx.objectStore(store).openCursor();
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

  function writeAll(db, store, recs, cb) {
    var tx;
    try {
      tx = db.transaction([store], 'readwrite');
      var objectStore = tx.objectStore(store);
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (!r || !r.p) continue;
        var rec = { timestamp: new Date(typeof r.t === 'number' ? r.t : Date.now()), mode: r.m };
        if (r.d) rec.contents = bytesFromB64(r.d);
        objectStore.put(rec, r.p); // out-of-line key, exactly like IDBFS does
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
      readAll(db, IDB_STORE, function (err2, recs) {
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
      readAll(db, IDB_STORE, function (err2, local) {
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
        writeAll(db, IDB_STORE, incoming, function (werr) {
          try { db.close(); } catch (_) {}
          if (werr) { restoring = false; return; }
          try { sessionStorage.setItem(RELOAD_COUNT_KEY, String(reloads + 1)); } catch (_) {}
          try { location.reload(); } catch (_) {}
        });
      });
    });
  }

  /* ── Construct 3 records ────────────────────────────────────────────────
     Values come straight out of localforage, so they are whatever the game
     stored: nearly always strings, but possibly numbers, plain objects or
     binary. Strings stay strings (nothing here should have to guess at JSON
     round-tripping), bytes become base64, anything else JSON-able is
     stringified; every record carries a one-letter tag so a restore knows
     what to hand back to localforage.
  ─────────────────────────────────────────────────────────────────────────── */

  function isBlob(v) {
    return !!v && typeof v.size === 'number' && typeof v.type === 'string' &&
      typeof v.arrayBuffer === 'function';
  }

  function packValue(v, cb) {
    if (typeof v === 'string') return cb({ s: v });
    var bytes = asBytes(v);
    if (bytes) return cb({ b: b64FromBytes(bytes) });
    if (isBlob(v)) {
      try {
        v.arrayBuffer().then(function (buf) {
          cb({ b: b64FromBytes(new Uint8Array(buf)) });
        }, function () { cb(null); });
      } catch (_) {
        cb(null);
      }
      return;
    }
    if (v === undefined) return cb(null);
    try {
      cb({ j: JSON.stringify(v) });
    } catch (_) {
      cb(null);
    }
  }

  function unpackValue(v) {
    if (!v) return undefined;
    if (typeof v.s === 'string') return v.s;
    if (typeof v.b === 'string') return bytesFromB64(v.b);
    if (typeof v.j === 'string') {
      try { return JSON.parse(v.j); } catch (_) { return undefined; }
    }
    return undefined;
  }

  function packRecords(raw, cb) {
    var out = [];
    var i = 0;
    (function next() {
      if (i >= raw.length) return cb(out);
      var rec = raw[i++];
      packValue(rec.v, function (packed) {
        if (packed) out.push({ k: rec.k, v: packed });
        next();
      });
    })();
  }

  function isC3Db(name) {
    if (typeof name !== 'string') return false;
    for (var i = 0; i < C3_PREFIXES.length; i++) {
      if (name.indexOf(C3_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  function noteC3Name(name) {
    if (!isC3Db(name)) return;
    if (c3DbNames.indexOf(name) < 0) c3DbNames.push(name);
  }

  /* indexedDB.databases() is the direct way to enumerate the game's stores.
     Older engines lack it, but they still tell us every database the game
     opens, so IDBFactory.open is watched as a second, independent source. */
  (function installOpenHook() {
    if (typeof IDBFactory === 'undefined' || !IDBFactory.prototype) return;
    var proto = IDBFactory.prototype;
    if (proto.__pluHooked) return;
    var originalOpen = proto.open;
    proto.open = function (name) {
      try { noteC3Name(name); } catch (_) {}
      return originalOpen.apply(this, arguments);
    };
    try { proto.__pluHooked = true; } catch (_) {}
  })();

  /* Sorted output keeps the payload byte-stable: a host that decides whether
     to store a save by comparing serialized snapshots should not see the save
     "change" merely because the databases were discovered in another order. */
  function listC3Dbs(cb) {
    var done = function () { cb(c3DbNames.slice().sort()); };
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
      return done();
    }
    try {
      indexedDB.databases().then(function (list) {
        for (var i = 0; i < (list || []).length; i++) noteC3Name(list[i] && list[i].name);
        done();
      }, done);
    } catch (_) {
      done();
    }
  }

  function readC3Db(db, cb) {
    var raw = [];
    var tx, req;
    try {
      tx = db.transaction([C3_STORE], 'readonly');
      req = tx.objectStore(C3_STORE).openCursor();
    } catch (e) {
      return cb(e);
    }
    req.onsuccess = function (e) {
      var cur = e.target.result;
      if (!cur) return packRecords(raw, function (recs) { cb(null, recs); });
      raw.push({ k: String(cur.key), v: cur.value });
      cur.continue();
    };
    req.onerror = function () {
      cb(req.error || 'read failed');
    };
  }

  function writeC3Db(db, recs, cb) {
    var tx;
    try {
      tx = db.transaction([C3_STORE], 'readwrite');
      var objectStore = tx.objectStore(C3_STORE);
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (!r || typeof r.k !== 'string') continue;
        var value = unpackValue(r.v);
        if (value === undefined) continue;
        objectStore.put(value, r.k); // out-of-line string key, exactly like localforage
      }
    } catch (e) {
      return cb(e);
    }
    tx.oncomplete = function () { cb(null); };
    tx.onerror = function () { cb(tx.error || 'write failed'); };
    tx.onabort = function () { cb(tx.error || 'write aborted'); };
  }

  function readC3Payload(cb) {
    listC3Dbs(function (names) {
      if (!names.length) return cb(null);
      var out = {};
      var any = false;
      var i = 0;
      (function next() {
        if (i >= names.length) return cb(any ? JSON.stringify(out) : null);
        var name = names[i++];
        openStoreDb(name, C3_STORE, false, null, function (err, db) {
          if (err || !db) return next();
          readC3Db(db, function (err2, recs) {
            try { db.close(); } catch (_) {}
            if (!err2 && recs && recs.length) {
              out[name] = recs;
              any = true;
            }
            next();
          });
        });
      })();
    });
  }

  function canonical(recs) {
    var parts = [];
    for (var i = 0; i < recs.length; i++) {
      parts.push(String(recs[i].k) + '\u0000' + JSON.stringify(recs[i].v));
    }
    parts.sort();
    return parts.join('\n');
  }

  /* Restore follows the Unity shape for the same reason: stage the records in
     IndexedDB, then reload so the game boots against them. localforage reads
     on demand, but a layout that has already run has already acted on the
     values it read, so a reload is the honest way to apply a save.

     Only databases whose contents actually differ are rewritten, and only
     names that look like Construct storage are ever written to, so a host
     that replays the same save on every launch cannot loop us. */
  function maybeRestoreC3(json) {
    if (!json || restoring) return;
    var incoming;
    try {
      incoming = JSON.parse(json);
    } catch (e) {
      return;
    }
    if (!incoming) return;

    var names = [];
    for (var k in incoming) {
      if (incoming.hasOwnProperty(k) && isC3Db(k) && incoming[k] && incoming[k].length) {
        names.push(k);
      }
    }
    if (!names.length) return;

    var reloads = 0;
    try {
      reloads = parseInt(sessionStorage.getItem(C3_RELOAD_COUNT_KEY), 10) || 0;
    } catch (_) {}
    if (reloads >= MAX_RELOADS) return;

    function stage() {
      if (restoring) return;
      restoring = true;
      var j = 0;
      (function next() {
        if (j >= names.length) {
          try { sessionStorage.setItem(C3_RELOAD_COUNT_KEY, String(reloads + 1)); } catch (_) {}
          try { location.reload(); } catch (_) {}
          return;
        }
        var name = names[j++];
        openStoreDb(name, C3_STORE, true, null, function (err, db) {
          if (err || !db) { restoring = false; return; }
          writeC3Db(db, incoming[name], function (werr) {
            try { db.close(); } catch (_) {}
            if (werr) { restoring = false; return; }
            next();
          });
        });
      })();
    }

    var changed = false;
    var i = 0;
    (function scan() {
      if (i >= names.length) {
        if (changed) stage();
        return;
      }
      var name = names[i++];
      openStoreDb(name, C3_STORE, false, null, function (err, db) {
        if (err || !db) { changed = true; return scan(); } // nothing here yet: seed it
        readC3Db(db, function (err2, local) {
          try { db.close(); } catch (_) {}
          if (!err2 && canonical(local || []) !== canonical(incoming[name])) changed = true;
          scan();
        });
      });
    })();
  }

  var _c3debounce = null;
  function scheduleC3Refresh() {
    clearTimeout(_c3debounce);
    _c3debounce = setTimeout(refreshC3, C3_SETTLE_MS);
  }

  function refreshC3() {
    if (restoring) return;
    readC3Payload(function (payload) {
      if (payload === lastC3Payload) return;
      lastC3Payload = payload;
      scheduleSnapshot();
    });
  }

  /* ── Snapshot scheduling ───────────────────────────────────────────────── */

  function sendSnapshot() {
    if (restoring) return;
    var saves = snapshotLocal();
    if (lastIdbPayload) saves[IDB_KEY] = lastIdbPayload;
    if (lastC3Payload) saves[C3_KEY] = lastC3Payload;
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
  setInterval(refreshC3, IDB_POLL_MS);
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
     exposed on window in release builds.

     The same hook covers Construct, whose localforage writes land in the
     keyvaluepairs store; there the debounce is not just an optimisation, it
     lets the game's own transaction commit before we re-read it. */
  (function installWriteHook() {
    if (typeof IDBObjectStore === 'undefined') return;
    var proto = IDBObjectStore.prototype;
    if (proto.__pluHooked) return;
    var originalPut = proto.put;
    var originalDelete = proto.delete;

    function noteStoreWrite(objectStore) {
      try {
        if (objectStore.name === IDB_STORE) { refreshIdb(); return; }
        if (objectStore.name !== C3_STORE) return;
        var tx = objectStore.transaction;
        if (tx && tx.db && isC3Db(tx.db.name)) scheduleC3Refresh();
      } catch (_) {}
    }

    proto.put = function () {
      var result = originalPut.apply(this, arguments);
      noteStoreWrite(this);
      return result;
    };
    proto.delete = function () {
      var result = originalDelete.apply(this, arguments);
      noteStoreWrite(this);
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
      maybeRestoreC3(saves[C3_KEY]);
    }
    if (e.data.type === 'plu_sync_request') {
      refreshIdb();
      refreshC3();
      sendSnapshot();
    }
  });

  try {
    window.parent.postMessage({ plu: true, type: 'plu_sync_ready' }, '*');
  } catch (_) {}

})();
