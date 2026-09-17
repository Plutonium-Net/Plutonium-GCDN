/*
 * PluStore — text-only save storage for browser games.
 *
 * A Unity WebGL build keeps its save in IndexedDB: Emscripten's IDBFS
 * mounts over /idbfs, and PlayerPrefs are written there as a binary blob.
 * That store is opaque, one directory per build, and shared by every game
 * on the origin.
 *
 * PluStore replaces it. The player's /idbfs becomes a plain in-memory
 * filesystem whose entire contents are serialised into a single
 * human-readable text document on every flush, and re-seeded from that
 * document before the player reads anything at boot. Nothing about the
 * save touches IndexedDB any more.
 *
 * Engines that are not Unity keep their save somewhere else again — a
 * GameMaker HTML5 runner holds every local file as one string in
 * localStorage, keyed "<game guid>.<version>.<name>". Those engines are
 * hosted through PluStore.files: the same document, one @file block per
 * name, four verbs (read, exists, write, remove) instead of a filesystem.
 *
 * The whole endpoint is text in, text out: get(), set(), list(), getValue(),
 * setValue(), clear(), on(). Swap PluStore.backend for any object with
 * read()/write()/clear() to move the save somewhere else entirely.
 */
(function (global) {
  'use strict';

  /* ── Configuration ────────────────────────────────────────────────────── */

  var cfg = {
    game: 'default',
    key: 'plu:text:default',
    mount: '/idbfs',
    /* Some hosts hand over a name already carrying their own storage prefix
       (GameMaker's runner prefixes every local file with "<guid>.<version>.").
       It is bookkeeping, not part of the save, so it never reaches the
       document. Empty means names arrive bare, which is the common case. */
    filePrefix: '',
    backend: null // filled in below
  };

  var DOC_HEADER = '#plu-text-store 1';

  /* Unity's PlayerPrefs file is a binary blob with a fixed 16-byte lead-in:
     "UnityPrf\0" then seven bytes of version/capacity bookkeeping. We keep
     those seven bytes verbatim so a re-encode is byte-identical to what the
     player itself writes. */
  var PREFS_MAGIC = 'UnityPrf';
  var PREFS_DEFAULT_HEADER = '00010000001000';

  /* The byte after a name is a type tag, or the byte length of a string value.
     Unity 2018 builds only ever wrote 0xFE; the 2019 builds we host also write
     0xFD for floats (a volume slider lands there). Both are reserved tags, so a
     string value must stay under them — see MAX_PREFS_STRING below. */
  var PREFS_INT = 0xfe;   // int32 little-endian follows
  var PREFS_FLOAT = 0xfd; // float32 little-endian follows
  var MAX_PREFS_STRING = PREFS_FLOAT - 1; // 252: the largest unambiguous string

  /* ── Storage backends ─────────────────────────────────────────────────── */

  /* The endpoint is a plain string in and a plain string out — nothing here
     knows about IndexedDB, files, or the network. Swap `PluStore.backend`
     for any object with read()/write() to move the save somewhere else. */

  /* The browser's own Storage, captured once while nothing has replaced it.

     This is not incidental. A game page may swap window.localStorage for an
     area of its own — that is what installWebStorage does — and the document
     must not follow that swap: the document lives in the browser's store, the
     game's keys live in the document. Resolving `global.localStorage` per call
     would make the backend read and write through the game's own view of this
     document, i.e. recurse into itself on every access, which is a loop rather
     than a save. Capturing at load also means the order of the page's own
     scripts cannot change where the document ends up. */
  var hostStore = (function () {
    try { return global.localStorage || null; } catch (e) { return null; }
  })();

  function hostStorage() {
    if (hostStore) return hostStore;
    /* Only if the first capture failed — a browser that throws on the getter
       before a document exists will not throw later. */
    try { return global.localStorage || null; } catch (e) { return null; }
  }

  function localStorageBackend(key) {
    return {
      read: function () {
        var s = hostStorage();
        try { return s ? s.getItem(key) : null; } catch (e) { return null; }
      },
      write: function (text) {
        var s = hostStorage();
        try { if (s) s.setItem(key, text); } catch (e) {}
      },
      clear: function () {
        var s = hostStorage();
        try { if (s) s.removeItem(key); } catch (e) {}
      }
    };
  }

  function memoryBackend() {
    var held = null;
    return {
      read: function () { return held; },
      write: function (text) { held = text; },
      clear: function () { held = null; }
    };
  }

  /* ── Byte helpers ─────────────────────────────────────────────────────── */

  function bytesToText(u8) {
    try { return new TextDecoder('utf-8').decode(u8); }
    catch (e) {
      var s = '';
      for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
      return s;
    }
  }

  function textToBytes(str) {
    try { return new TextEncoder().encode(str); }
    catch (e) {
      var u8 = new Uint8Array(str.length);
      for (var i = 0; i < str.length; i++) u8[i] = str.charCodeAt(i) & 0xff;
      return u8;
    }
  }

  /* Base64, for the files that are not text. Binary stored as text is not a
     save, it is a ticking data-loss bug: a UTF-8 decode turns every invalid
     byte into U+FFFD and re-encoding writes the replacement character back. */
  function b64FromBytes(u8) {
    var s = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < u8.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    try { return global.btoa(s); }
    catch (e) { return Buffer.from(u8).toString('base64'); }
  }

  function bytesFromB64(b64) {
    var bin;
    try { bin = global.atob(b64); }
    catch (e) { return new Uint8Array(Buffer.from(b64, 'base64')); }
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i) & 0xff;
    return u8;
  }

  /* Returns the text only when decoding it is provably lossless, so a caller
     can tell "this is a text file" from "this merely survived a decode". */
  function textIfLossless(u8) {
    var text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(u8);
    } catch (e) {
      return null;
    }
    var back = textToBytes(text);
    if (back.length !== u8.length) return null;
    for (var i = 0; i < u8.length; i++) if (back[i] !== u8[i]) return null;
    return text;
  }

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length >> 1);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function bytesToHex(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
    return s;
  }

  /* ── PlayerPrefs codec ────────────────────────────────────────────────────
     Layout, verified against a real file the player wrote:

       "UnityPrf\0"              9 bytes
       header                    7 bytes (kept verbatim)
       then repeated entries of:
         uint8  nameLength
         bytes  name (utf-8)
         uint8  type            0xFE = int32 little-endian follows
                                0xFD = float32 little-endian follows
                                otherwise the byte is the string's byte length
         bytes  value
  ─────────────────────────────────────────────────────────────────────────── */

  function decodePrefs(u8) {
    if (!u8 || u8.length < 16) return null;
    var magic = bytesToText(u8.subarray(0, 9));
    if (magic !== PREFS_MAGIC + '\0') return null;

    var headerHex = bytesToHex(u8.subarray(9, 16));
    var entries = [];
    var i = 16;
    while (i < u8.length) {
      var nameLen = u8[i++];
      if (i + nameLen > u8.length) return null;
      var name = bytesToText(u8.subarray(i, i + nameLen));
      i += nameLen;
      var type = u8[i++];
      if (type === PREFS_INT) {
        if (i + 4 > u8.length) return null;
        var v = u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16) | (u8[i + 3] << 24);
        i += 4;
        entries.push({ name: name, type: 'int', value: v | 0 });
      } else if (type === PREFS_FLOAT) {
        if (i + 4 > u8.length) return null;
        var fv = new DataView(u8.buffer, u8.byteOffset + i, 4).getFloat32(0, true);
        i += 4;
        entries.push({ name: name, type: 'float', value: fv });
      } else {
        if (i + type > u8.length) return null;
        entries.push({ name: name, type: 'str', value: bytesToText(u8.subarray(i, i + type)) });
        i += type;
      }
    }
    return { headerHex: headerHex, entries: entries };
  }

  function encodePrefs(prefs) {
    var headerBytes = hexToBytes(prefs.headerHex || PREFS_DEFAULT_HEADER);
    var body = [];

    for (var n = 0; n < prefs.entries.length; n++) {
      var e = prefs.entries[n];
      var nameBytes = textToBytes(e.name);
      if (nameBytes.length > 255) throw new Error('PlayerPrefs name too long: ' + e.name);
      body.push([nameBytes.length]);
      body.push(nameBytes);

      if (e.type === 'int') {
        var v = Number(e.value) | 0;
        body.push([PREFS_INT, v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
      } else if (e.type === 'float') {
        var fbuf = new ArrayBuffer(4);
        new DataView(fbuf).setFloat32(0, Number(e.value), true);
        var fb = new Uint8Array(fbuf);
        body.push([PREFS_FLOAT, fb[0], fb[1], fb[2], fb[3]]);
      } else {
        var valBytes = textToBytes(String(e.value));
        if (valBytes.length > MAX_PREFS_STRING) {
          throw new Error('PlayerPrefs value too long for a string type tag (' +
            valBytes.length + ' > ' + MAX_PREFS_STRING + '): ' + e.name);
        }
        body.push([valBytes.length]);
        body.push(valBytes);
      }
    }

    var size = 9 + headerBytes.length;
    for (var b = 0; b < body.length; b++) size += body[b].length;

    var out = new Uint8Array(size);
    out.set(textToBytes(PREFS_MAGIC + '\0'), 0);
    out.set(headerBytes, 9);
    var at = 9 + headerBytes.length;
    for (var c = 0; c < body.length; c++) { out.set(body[c], at); at += body[c].length; }
    return out;
  }

  /* ── Field escaping ───────────────────────────────────────────────────────
     Entries are tab-separated so the document stays greppable, which means
     the three characters that would break a line have to be escaped. Order
     matters: backslash first, or the escapes escape each other.
  ─────────────────────────────────────────────────────────────────────────── */

  function escapeField(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/\t/g, '\\t')
      .replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  }

  function unescapeField(s) {
    return String(s).replace(/\\(.)/g, function (m, c) {
      if (c === 't') return '\t';
      if (c === 'r') return '\r';
      if (c === 'n') return '\n';
      if (c === '\\') return '\\';
      return m;
    });
  }

  /* ── Document format ──────────────────────────────────────────────────────

       #plu-text-store 1
       #game snow-rider-3d
       #saved 2026-09-16T03:30:00.000Z
       @dir /idbfs/38f7b574447025292645b04c764b759c
       @unity-prefs /idbfs/38f7b574447025292645b04c764b759c/PlayerPrefs
       header\t00010000001000
       AvailableTime\tint\t150
       unity.cloud_userid\tstr\t1cb7ff20391f56574b190be8783244af
       @end
       @text /idbfs/38f7b574447025292645b04c764b759c/RemoteConfig.json
       {}
       @end
       @base64 /idbfs/38f7b574447025292645b04c764b759c/SomeBinaryFile
       AAECAwQ=
       @end
       @file items.json
       {\"unlocks\":[],\"stash\":[]}
       @end
       @store c3-localstorage-1a2b3c4d
       version\tstr\t1.4.2
       highScore\tnum\t120

     Blocks are closed by a line reading exactly "@end". A raw line reading
     "@end" cannot occur inside a JSON document (newlines are escaped there),
     which is what makes the terminator safe for the text blocks we store.
     A @file body is escaped the same way and is always exactly one line, so a
     save that contains newlines — a GameMaker .ini is CRLF-separated — still
     lands in the document intact and cannot break a block open.

     A @store body is one escaped line per entry, "key\ttag\tvalue", which is
     why a value's tabs and newlines cannot break a block open either.
  ─────────────────────────────────────────────────────────────────────────── */

  function serialize(tree, savedAt) {
    var lines = [DOC_HEADER, '#game ' + cfg.game, '#saved ' + (savedAt || new Date().toISOString())];
    var i;

    for (i = 0; i < tree.dirs.length; i++) lines.push('@dir ' + tree.dirs[i]);

    for (i = 0; i < tree.files.length; i++) {
      var f = tree.files[i];
      if (f.kind === 'prefs') {
        lines.push('@unity-prefs ' + f.path);
        lines.push('header\t' + (f.prefs.headerHex || PREFS_DEFAULT_HEADER));
        for (var e = 0; e < f.prefs.entries.length; e++) {
          var entry = f.prefs.entries[e];
          lines.push(escapeField(entry.name) + '\t' + entry.type + '\t' + escapeField(entry.value));
        }
      } else if (f.kind === 'base64') {
        lines.push('@base64 ' + f.path);
        lines.push(f.b64);
      } else if (f.kind === 'file') {
        lines.push('@file ' + f.path);
        lines.push(escapeField(f.text));
      } else if (f.kind === 'store') {
        lines.push('@store ' + f.path);
        for (var s = 0; s < f.entries.length; s++) {
          lines.push(escapeField(f.entries[s].key) + '\t' + f.entries[s].tag +
            '\t' + escapeField(f.entries[s].text));
        }
      } else {
        lines.push('@text ' + f.path);
        lines.push(f.text);
      }
      lines.push('@end');
    }
    return lines.join('\n') + '\n';
  }

  function parse(doc) {
    if (typeof doc !== 'string') return null;
    var lines = doc.split('\n');
    if (lines.length === 0 || lines[0].indexOf('#plu-text-store') !== 0) return null;

    var tree = { dirs: [], files: [] };
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (line.indexOf('@dir ') === 0) {
        tree.dirs.push(line.slice(5).trim());
        i++;
        continue;
      }

      if (line.indexOf('@unity-prefs ') === 0) {
        var prefs = { headerHex: PREFS_DEFAULT_HEADER, entries: [] };
        var prefsPath = line.slice(13).trim();
        i++;
        while (i < lines.length && lines[i] !== '@end') {
          var parts = lines[i].split('\t');
          if (parts[0] === 'header') prefs.headerHex = parts[1] || PREFS_DEFAULT_HEADER;
          else if (parts.length >= 3) {
            var etype = parts[1] === 'int' ? 'int' : (parts[1] === 'float' ? 'float' : 'str');
            prefs.entries.push({
              name: unescapeField(parts[0]),
              type: etype,
              value: etype === 'str' ? unescapeField(parts[2]) : Number(parts[2])
            });
          }
          i++;
        }
        i++; // step over @end
        tree.files.push({ path: prefsPath, kind: 'prefs', prefs: prefs });
        continue;
      }

      if (line.indexOf('@file ') === 0) {
        var fileName = line.slice(6).trim();
        i++;
        var fileText = i < lines.length ? lines[i++] : '';
        if (lines[i] === '@end') i++;
        tree.files.push({ path: fileName, kind: 'file', text: unescapeField(fileText) });
        continue;
      }

      if (line.indexOf('@store ') === 0) {
        var storeName = line.slice(7).trim();
        var stored = [];
        i++;
        while (i < lines.length && lines[i] !== '@end') {
          var fields = lines[i].split('\t');
          /* Two fields is a value-less tag (null, undefined) whose padding tab
             was dropped — an edited document may well be written that way. */
          if (fields.length >= 2) {
            stored.push({
              key: unescapeField(fields[0]),
              tag: fields[1],
              text: fields.length >= 3 ? unescapeField(fields[2]) : ''
            });
          }
          i++;
        }
        i++; // step over @end
        tree.files.push({ path: storeName, kind: 'store', entries: stored });
        continue;
      }

      if (line.indexOf('@text ') === 0) {
        var textPath = line.slice(6).trim();
        i++;
        var body = [];
        while (i < lines.length && lines[i] !== '@end') body.push(lines[i++]);
        i++; // step over @end
        tree.files.push({ path: textPath, kind: 'text', text: body.join('\n') });
        continue;
      }

      if (line.indexOf('@base64 ') === 0) {
        var b64Path = line.slice(8).trim();
        i++;
        var chunk = [];
        while (i < lines.length && lines[i] !== '@end') chunk.push(lines[i++]);
        i++; // step over @end
        tree.files.push({ path: b64Path, kind: 'base64', b64: chunk.join('') });
        continue;
      }

      i++;
    }
    return tree;
  }

  /* ── Reading the player's filesystem ──────────────────────────────────── */

  function pathJoin(a, b) {
    return a.charAt(a.length - 1) === '/' ? a + b : a + '/' + b;
  }

  function readTree(FS, mount) {
    var tree = { dirs: [], files: [] };

    (function walk(dir) {
      var names;
      try { names = FS.readdir(dir); } catch (e) { return; }
      for (var i = 0; i < names.length; i++) {
        if (names[i] === '.' || names[i] === '..') continue;
        var full = pathJoin(dir, names[i]);
        var stat;
        try { stat = FS.stat(full); } catch (e) { continue; }

        if (FS.isDir(stat.mode)) {
          tree.dirs.push(full);
          walk(full);
        } else {
          var u8 = null;
          try { u8 = new Uint8Array(FS.readFile(full)); } catch (e) { continue; }
          var prefs = decodePrefs(u8);
          if (prefs) {
            tree.files.push({ path: full, kind: 'prefs', prefs: prefs });
          } else {
            var text = textIfLossless(u8);
            if (text === null) tree.files.push({ path: full, kind: 'base64', b64: b64FromBytes(u8) });
            else tree.files.push({ path: full, kind: 'text', text: text });
          }
        }
      }
    })(mount);

    // Shallow directories first, so restoring can mkdir in order.
    tree.dirs.sort(function (a, b) {
      var da = a.split('/').length, db = b.split('/').length;
      return da === db ? (a < b ? -1 : a > b ? 1 : 0) : da - db;
    });
    return tree;
  }

  /* ── Writing back into the player's filesystem ────────────────────────── */

  function mkdirp(FS, path) {
    var parts = path.split('/');
    var cur = '';
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      cur += '/' + parts[i];
      try { FS.mkdir(cur); } catch (e) { /* already there */ }
    }
  }

  /* Writing bytes is the one emscripten call whose meaning changed under us. An
     old player (Unity 5.x, emscripten 1.35) reads a two-argument writeFile as
     *UTF-8 text*: it runs the value through stringToUTF8Array, which turns every
     byte of a Uint8Array into "str.charCodeAt is not a function" — after opening
     the file, so the restore leaves a save full of empty files and no usable
     error. The stream calls below mean the same thing in every version. */
  function writeBytes(FS, path, bytes) {
    var stream = FS.open(path, 'w');
    try {
      FS.write(stream, bytes, 0, bytes.length, 0);
    } finally {
      FS.close(stream);
    }
  }

  function restoreTree(FS, tree) {
    var i;
    for (i = 0; i < tree.dirs.length; i++) mkdirp(FS, tree.dirs[i]);
    for (i = 0; i < tree.files.length; i++) {
      var f = tree.files[i];
      var slash = f.path.lastIndexOf('/');
      if (slash > 0) mkdirp(FS, f.path.slice(0, slash));
      try {
        if (f.kind === 'prefs') writeBytes(FS, f.path, encodePrefs(f.prefs));
        else if (f.kind === 'base64') writeBytes(FS, f.path, bytesFromB64(f.b64));
        else writeBytes(FS, f.path, textToBytes(f.text));
      } catch (e) { warn('could not restore ' + f.path + ': ' + e); }
    }
  }

  /* ── Hosted views of the document ─────────────────────────────────────────
     Not every engine keeps its save where Unity does. A GameMaker HTML5
     runner keeps every local file as one string in localStorage, keyed
     "<game guid>.<version>.<name>": an .ini is one entry, a .json another.
     Those engines want four verbs and nothing else — read, exists, write,
     remove — so their files ride in the same document as @file blocks, one
     block per name, and the caller keeps calling them by name.

     Two quirks of GameMaker's own semantics are preserved deliberately,
     because a save that behaves differently is a broken save:

       * a stored-but-empty file answers exists() false — the runner tests the
         *value's* truthiness (window.localStorage[name] && ...), not whether
         the name is there
       * ensure() tests presence instead, because the file_ensure_js helper it
         stands in for compares against null, so an empty default is written
         exactly once and never again

     A Construct 3 export keeps no files at all. Its save is two key/value
     stores — localforage instances named "c3-localstorage-<project id>" and
     "c3-savegames-<project id>" — so those ride as @store blocks and the
     caller keeps the promise-shaped getItem / setItem / removeItem / clear /
     keys surface it was written against.

     Both are views *of the same document*, parsed once and cached against its
     text. One cache deliberately, rather than one per view: an engine using
     both, or an inspector reading while a game writes, would otherwise hold a
     stale half and write it back over the fresh half.
  ─────────────────────────────────────────────────────────────────────────── */

  var viewCache = null;    // { files: name -> text, stores: name -> entries }
  var viewCacheDoc = null; // the document that cache was built from

  /* ── One Web Storage area, over the @file blocks ──────────────────────────

     Cookie Clicker keeps its whole save in localStorage: one key per save
     slot, one for the language, and a clear() that wipes them. The engine
     never calls anything else, so rather than editing twenty call sites
     inside a 1.2 MB game file, the area itself is swapped out before the
     game loads. Every key becomes an @file block, still text.

     The four methods are the whole of what a Storage area offers a game
     that saves this way, plus key()/length for the ones that enumerate.
     Names are sorted so the same save always serialises to the same bytes,
     and `length` is a getter rather than a number, because a copy of a count
     goes stale the moment the game writes.
  ─────────────────────────────────────────────────────────────────────────── */

  function webStorageArea() {
    var area = {
      getItem: function (key) {
        var map = view().files;
        var k = fileKey(key);
        return map.hasOwnProperty(k) ? map[k] : null;
      },

      setItem: function (key, value) {
        var v = view();
        v.files[fileKey(key)] = value === undefined || value === null ? '' : String(value);
        stats.fileWrites++;
        writeView(v);
      },

      removeItem: function (key) {
        var v = view();
        delete v.files[fileKey(key)];
        stats.fileWrites++;
        writeView(v);
      },

      /* clear() empties this area, i.e. the @file blocks. A Unity save living
         in the same document as @unity-prefs blocks is a different area and
         keeps its own; nothing else in the document is touched. */
      clear: function () {
        var v = view();
        var names = fileNames(v.files);
        for (var i = 0; i < names.length; i++) delete v.files[names[i]];
        stats.fileWrites++;
        writeView(v);
      },

      key: function (index) {
        var names = fileNames(view().files);
        var i = Number(index) | 0;
        return i >= 0 && i < names.length ? names[i] : null;
      }
    };

    Object.defineProperty(area, 'length', {
      get: function () { return fileNames(view().files).length; },
      enumerable: true
    });

    return area;
  }

  /* The name a host hands over may carry its own storage prefix. Strip it once
     here, so every caller — the runner's file layer and the extension helper
     alike — ends up in the same namespace in the document. */
  function fileKey(name) {
    var n = String(name);
    var prefix = cfg.filePrefix;
    if (prefix && n.indexOf(prefix) === 0) return n.slice(prefix.length);
    return n;
  }

  function fileNames(map) {
    var names = [];
    for (var name in map) if (map.hasOwnProperty(name)) names.push(name);
    return names.sort();
  }

  /* The document as the hosted views see it: @file blocks as a name -> text
     map, @store blocks as a name -> entries list. Cached against the document
     text, so a read does not re-parse on every call. Entry text is kept raw,
     tag and all: the tag is what a re-write needs to put back, and decoding
     here would throw away the difference between a stored null and a value
     that failed to decode. */
  function view() {
    var doc = cfg.backend.read() || '';
    if (viewCache && viewCacheDoc === doc) return viewCache;

    var v = { files: {}, stores: {} };
    var tree = parse(doc);
    if (tree) {
      for (var i = 0; i < tree.files.length; i++) {
        var f = tree.files[i];
        if (f.kind === 'file') v.files[f.path] = f.text;
        else if (f.kind === 'store') v.stores[f.path] = f.entries;
      }
    }
    viewCache = v;
    viewCacheDoc = doc;
    return v;
  }

  /* Rewrite the document as this view says it should be. Blocks the view does
     not own are read back and carried across, so a game that somehow had both
     a Unity /idbfs and hosted blocks would not lose one to the other. Names
     and keys are sorted, so the same save always serialises to the same
     bytes: a host that decides whether to store a save by diffing it should
     not see it "change" for free. */
  function writeView(v) {
    var stored = parse(cfg.backend.read() || '');
    var tree = stored || { dirs: [], files: [] };
    var files = [];
    var i, names;

    for (i = 0; i < tree.files.length; i++) {
      var kind = tree.files[i].kind;
      if (kind !== 'file' && kind !== 'store') files.push(tree.files[i]);
    }

    names = fileNames(v.files);
    for (i = 0; i < names.length; i++) {
      files.push({ path: names[i], kind: 'file', text: v.files[names[i]] });
    }

    names = Object.keys(v.stores).sort();
    for (i = 0; i < names.length; i++) {
      var entries = v.stores[names[i]].slice().sort(byKey);
      v.stores[names[i]] = entries; // the view and the document agree on order
      if (!entries.length) continue; // an empty store earns no block
      files.push({ path: names[i], kind: 'store', entries: entries });
    }

    var doc = serialize({ dirs: tree.dirs, files: files }, new Date().toISOString());
    cfg.backend.write(doc);
    viewCache = v;
    viewCacheDoc = doc;
    lastDoc = doc;
    stats.savedAt = new Date().toISOString();
    emit(doc);
  }

  function byKey(a, b) {
    return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
  }

  function entriesOf(v, name) {
    if (!v.stores[name]) v.stores[name] = [];
    return v.stores[name];
  }

  function indexOfKey(entries, key) {
    for (var i = 0; i < entries.length; i++) if (entries[i].key === key) return i;
    return -1;
  }

  /* A Unity flush rewrites the whole document out of /idbfs, which knows
     nothing about hosted blocks. They are carried across instead of dropped. */
  function carriedHostedBlocks() {
    var tree = parse(cfg.backend.read() || '');
    var out = [];
    if (!tree) return out;
    for (var i = 0; i < tree.files.length; i++) {
      var kind = tree.files[i].kind;
      if (kind === 'file' || kind === 'store') out.push(tree.files[i]);
    }
    return out;
  }

  /* ── Store value codec ────────────────────────────────────────────────────

     A key/value store holds structured-clone data, not text, so every entry
     carries a type tag: the number 3 and the string "3" are different saves,
     and so are a Date and its ISO string. Each tag below names a JS type we
     can rebuild exactly. Anything else — a Map, a Set, a Float64Array, a
     function — is refused with a warning rather than stored as something
     lossy, because a save that quietly comes back as a different type is
     worse than one that never happened.
  ─────────────────────────────────────────────────────────────────────────── */

  function encodeStoreValue(v) {
    if (typeof v === 'string') return { tag: 'str', text: v };
    if (typeof v === 'number') {
      /* -0 is the one number String() loses; JSON.stringify loses it too. */
      return { tag: 'num', text: v === 0 && 1 / v < 0 ? '-0' : String(v) };
    }
    if (typeof v === 'boolean') return { tag: 'bool', text: v ? 'true' : 'false' };
    if (v === null) return { tag: 'null', text: '' };
    if (v === undefined) return { tag: 'undef', text: '' };
    if (Object.prototype.toString.call(v) === '[object Date]') {
      return { tag: 'date', text: v.toISOString() };
    }
    if (v instanceof ArrayBuffer) return { tag: 'ab', text: b64FromBytes(new Uint8Array(v)) };
    if (v instanceof Uint8Array) {
      return { tag: 'u8', text: b64FromBytes(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    }
    if (jsonSafe(v)) return { tag: 'json', text: JSON.stringify(v) };
    return null;
  }

  function decodeStoreValue(tag, text) {
    if (tag === 'str') return text;
    if (tag === 'num') return Number(text);
    if (tag === 'bool') return text === 'true';
    if (tag === 'null') return null;
    if (tag === 'undef') return undefined;
    if (tag === 'date') return new Date(text);
    if (tag === 'u8') return bytesFromB64(text);
    if (tag === 'ab') return bytesFromB64(text).buffer;
    if (tag === 'json') {
      try { return JSON.parse(text); } catch (e) { return undefined; }
    }
    return undefined; // a tag from a newer engine: unknown, so never guessed at
  }

  /* True only when JSON can carry this value back unchanged: plain objects and
     arrays of strings, finite numbers, booleans and null. A nested Date, a
     typed array or an undefined property all fail here, because JSON would
     silently turn them into something else. */
  function jsonSafe(v) {
    if (v === null) return true;
    var t = typeof v;
    if (t === 'string' || t === 'boolean') return true;
    if (t === 'number') return isFinite(v);
    if (t !== 'object') return false;
    if (Object.prototype.toString.call(v) === '[object Date]') return false;
    if (v instanceof ArrayBuffer || v instanceof Uint8Array) return false;
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) if (!jsonSafe(v[i])) return false;
      return true;
    }
    var proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return false;
    for (var k in v) {
      if (v.hasOwnProperty(k) && !jsonSafe(v[k])) return false;
    }
    return true;
  }

  function describeValue(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'object') return Object.prototype.toString.call(v).slice(8, -1).toLowerCase();
    return typeof v;
  }

  /* ── Public endpoint ──────────────────────────────────────────────────── */

  var listeners = [];
  var lastDoc = null;
  var lastBackendKey = null; // the key the live backend was built for
  var stats = { booted: 0, flushed: 0, fileWrites: 0, storeWrites: 0, savedAt: null, lastError: null };

  function warn(msg) {
    stats.lastError = String(msg);
    if (global.console && console.warn) console.warn('[PluStore] ' + msg);
  }

  function emit(doc) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](doc); } catch (e) {}
    }
    try {
      if (global.parent && global.parent !== global) {
        global.parent.postMessage({ pluTextStore: true, game: cfg.game, doc: doc, stats: stats }, '*');
      }
    } catch (e) {}
  }

  var PluStore = {
    /* The endpoint surface. Everything is plain text in, plain text out. */

    get: function () {
      return cfg.backend.read() || '';
    },

    set: function (doc) {
      var tree = parse(doc);
      if (!tree) throw new Error('not a PluStore document');
      cfg.backend.write(doc);
      lastDoc = doc;
      viewCacheDoc = null; // the hosted views have to be rebuilt from this document
      stats.savedAt = new Date().toISOString();
      emit(doc);
      return tree;
    },

    list: function () {
      var tree = parse(this.get());
      if (!tree) return [];
      return tree.files.map(function (f) {
        return {
          path: f.path,
          kind: f.kind,
          keys: f.kind === 'prefs' ? f.prefs.entries.map(function (e) { return e.name; }) : undefined
        };
      });
    },

    /* Read one PlayerPrefs entry out of the stored document. */
    getValue: function (name) {
      var prefs = this.prefs();
      if (!prefs) return undefined;
      for (var i = 0; i < prefs.entries.length; i++) {
        if (prefs.entries[i].name === name) return prefs.entries[i].value;
      }
      return undefined;
    },

    /* Write one entry back, leaving the rest of the document untouched. */
    setValue: function (name, value, type) {
      var doc = this.get();
      var tree = parse(doc);
      if (!tree) return false;
      for (var f = 0; f < tree.files.length; f++) {
        if (tree.files[f].kind !== 'prefs') continue;
        var entries = tree.files[f].prefs.entries;
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].name === name) {
            entries[i].type = type || entries[i].type;
            entries[i].value = entries[i].type === 'str' ? String(value) : Number(value);
            this.set(serialize(tree, new Date().toISOString()));
            return true;
          }
        }
        entries.push({
          name: name,
          type: type || (typeof value === 'number' ? 'int' : 'str'),
          value: typeof value === 'number' ? value : String(value)
        });
        this.set(serialize(tree, new Date().toISOString()));
        return true;
      }
      return false;
    },

    /* The first PlayerPrefs block in the document, decoded. */
    prefs: function () {
      var tree = parse(this.get());
      if (!tree) return null;
      for (var i = 0; i < tree.files.length; i++) {
        if (tree.files[i].kind === 'prefs') return tree.files[i].prefs;
      }
      return null;
    },

    clear: function () {
      cfg.backend.clear();
      lastDoc = null;
      viewCache = null;
      viewCacheDoc = null;
      stats.savedAt = null;
      emit('');
    },

    on: function (cb) { listeners.push(cb); return cb; },
    off: function (cb) {
      var i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },

    /* ── Hosted file maps — for engines whose save is a set of named files ──

         PluStore.files.write('pig.ini', '[stats]\r\n')   // store a file
         PluStore.files.read('pig.ini')                    // text, or null
         PluStore.files.exists('pig.ini')                  // non-empty?
         PluStore.files.has('pig.ini')                     // present at all?
         PluStore.files.ensure('missions.json', '')        // default if absent
         PluStore.files.remove('pig.ini')                  // delete it
         PluStore.files.list()                             // [{name, size}]

       Every call reads and rewrites the one document, so the whole save
       stays text you can copy out of an inspector.
    */
    files: {
      list: function () {
        var map = view().files;
        var names = fileNames(map);
        var out = [];
        for (var i = 0; i < names.length; i++) {
          out.push({ name: names[i], size: map[names[i]].length });
        }
        return out;
      },

      names: function () { return fileNames(view().files); },

      /* A missing file is null, which is what the runner's read expects. */
      read: function (name) {
        var map = view().files;
        var k = fileKey(name);
        return map.hasOwnProperty(k) ? map[k] : null;
      },

      /* The value's truthiness, matching file_exists in the runner. */
      exists: function (name) {
        var text = view().files[fileKey(name)];
        return !!(text && text.length);
      },

      /* The name's presence, matching getItem(path) == null. */
      has: function (name) {
        return view().files.hasOwnProperty(fileKey(name));
      },

      write: function (name, text) {
        var v = view();
        v.files[fileKey(name)] = text === undefined || text === null ? '' : String(text);
        stats.fileWrites++;
        writeView(v);
        return true;
      },

      /* Store a default only when the file is not there yet. */
      ensure: function (name, text) {
        if (this.has(name)) return false;
        this.write(name, text);
        return true;
      },

      /* removeItem never minded whether the key existed, so neither does this. */
      remove: function (name) {
        var v = view();
        delete v.files[fileKey(name)];
        stats.fileWrites++;
        writeView(v);
        return true;
      }
    },

    /* ── Hosted key/value stores — for engines whose save is a set of them ──

         var db = PluStore.stores.instance('c3-savegames-abc123');
         await db.setItem('slot1', '{"score":42}');
         await db.getItem('slot1');   // that string back, or null
         await db.removeItem('slot1');
         await db.clear();
         await db.keys();             // [ 'score', 'slot1' ] — sorted

       Every call resolves a promise, like the localforage instance this can
       stand in for, and every call reads and rewrites the one document, so
       the whole save stays text you can copy out of an inspector. A value the
       codec above cannot restore exactly is refused, not mangled.
    */
    stores: {
      instance: function (name) {
        var store = String(name);
        return {
          getItem: function (key) {
            var entries = view().stores[store] || [];
            var at = indexOfKey(entries, String(key));
            return Promise.resolve(at < 0 ? null : decodeStoreValue(entries[at].tag, entries[at].text));
          },

          setItem: function (key, value) {
            var encoded = encodeStoreValue(value);
            if (!encoded) {
              warn('store "' + store + '" refused a ' + describeValue(value) +
                ' value for "' + key + '": it cannot be restored without changing it');
              return Promise.resolve(undefined);
            }
            var v = view();
            var entries = entriesOf(v, store);
            var entry = { key: String(key), tag: encoded.tag, text: encoded.text };
            var at = indexOfKey(entries, entry.key);
            if (at < 0) entries.push(entry);
            else entries[at] = entry;
            stats.storeWrites++;
            writeView(v);
            return Promise.resolve(undefined);
          },

          removeItem: function (key) {
            var v = view();
            var entries = v.stores[store] || [];
            var at = indexOfKey(entries, String(key));
            if (at >= 0) {
              entries.splice(at, 1);
              stats.storeWrites++;
              writeView(v);
            }
            return Promise.resolve(undefined);
          },

          clear: function () {
            var v = view();
            if (v.stores[store] && v.stores[store].length) {
              v.stores[store] = [];
              stats.storeWrites++;
              writeView(v);
            }
            return Promise.resolve(undefined);
          },

          keys: function () {
            var entries = view().stores[store] || [];
            var out = [];
            for (var i = 0; i < entries.length; i++) out.push(entries[i].key);
            return Promise.resolve(out);
          },

          /* The instance this replaces has to be opened before it can be
             used, and falls back to memory when opening fails. Ours is a
             document that is already open, so there is nothing to wait for
             and nothing to fall back to. */
          ready: function () { return Promise.resolve(true); },
          IsUsingFallback: function () { return false; },
          disableMemoryMode: function () {},

          /* A store made from a store stays in the same document. */
          createInstance: function (options) {
            if (!options || typeof options !== 'object') {
              throw new TypeError('invalid options object');
            }
            return PluStore.stores.instance(options.name);
          }
        };
      },

      /* Decoded entries of one store, for an inspector. The tag travels
         beside the value because "3" and 3 are different saves. */
      entries: function (name) {
        var entries = view().stores[String(name)] || [];
        var out = [];
        for (var i = 0; i < entries.length; i++) {
          out.push({
            key: entries[i].key,
            tag: entries[i].tag,
            value: decodeStoreValue(entries[i].tag, entries[i].text)
          });
        }
        return out;
      },

      /* Emptied stores are left out, because that is what the document says:
         a store with no entries has no block. */
      names: function () {
        var stores = view().stores;
        var out = [];
        for (var name in stores) {
          if (stores.hasOwnProperty(name) && stores[name].length) out.push(name);
        }
        return out.sort();
      },

      /* ── One store wearing localforage's callback API ────────────────────

           var lf = PluStore.stores.localforage('localforage');
           lf.setItem('TotalDeaths_keyhs', '12', function (err) { ... });
           lf.getItem('TotalDeaths_keyhs', function (err, value) { ... });

         Construct 2's WebStorage plugin is written against the localforage
         *global*: node-style callbacks, and no promise anywhere in it. This
         is the instance above with the callback added, so a plugin written
         that way keeps calling what it always called and the save still
         lands in the one document.

         The methods nothing needs are split deliberately. Configuration the
         engine may call at startup is inert — setDriver, config and friends
         succeed and change nothing, because the document is already open and
         there is no driver to choose. Anything that would have to *lie*
         about the data — length, key, iterate — throws instead, the way
         Construct's own shim reports what it does not implement. A save is
         never the place to guess. */
      localforage: function (name) {
        var store = PluStore.stores.instance(name);

        function settle(promise, callback) {
          if (typeof callback !== 'function') return promise;
          promise.then(function (value) { callback(null, value); },
                       function (error) { callback(error); });
          return promise;
        }

        function notImplemented(method) {
          return function () {
            throw new Error('localforage.' + method + '() is not implemented by PluStore');
          };
        }

        return {
          getItem: function (key, callback) { return settle(store.getItem(key), callback); },
          setItem: function (key, value, callback) { return settle(store.setItem(key, value), callback); },
          removeItem: function (key, callback) { return settle(store.removeItem(key), callback); },
          clear: function (callback) { return settle(store.clear(), callback); },
          keys: function (callback) { return settle(store.keys(), callback); },
          ready: function (callback) { return settle(store.ready(), callback); },

          length: notImplemented('length'),
          key: notImplemented('key'),
          iterate: notImplemented('iterate'),

          driver: function () { return 'plustore'; },
          supports: function () { return true; },
          ready_driver: function () {},
          config: function () {},
          setDriver: function () {},
          defineDriver: function () {},
          dropInstance: function () {},
          disableMemoryMode: function () {},
          IsUsingFallback: function () { return false; }
        };
      }
    },

    /* ── Web Storage areas — for engines whose save is localStorage ────────

         PluStore.installWebStorage();          // in the page, before the game
         localStorage.setItem('CookieClickerGame', save);

       installWebStorage() replaces window.localStorage with an area over this
       document, so a game that saves through it — including one that calls
       localStorage directly instead of through its own helper — cannot reach
       the browser's store at all. It returns the installed area, or null when
       the browser refused the swap, which is the one case a caller has to know
       about: a game writing to the real localStorage would look like it saved
       while the document stayed empty.

       webStorage() is the same object without installing it, for a page that
       would rather hand one to a single script than replace the global.
    */
    webStorage: function () {
      return webStorageArea();
    },

    installWebStorage: function () {
      var area = webStorageArea();
      try {
        Object.defineProperty(global, 'localStorage', {
          value: area, configurable: true, enumerable: true
        });
      } catch (e) {
        warn('could not replace window.localStorage: ' + e);
        return null;
      }
      if (global.localStorage !== area) {
        warn('window.localStorage could not be replaced; the save would not be ours');
        return null;
      }
      return area;
    },

    /* ── Unity hooks — called from the patched player, not by the page ──── */

    /* Seed /idbfs from the stored document. Runs as a preRun step, i.e.
       before the player opens the directory, which is the only moment a
       save can be handed to it: a running player has already acted on the
       values it read. Synchronous, so it needs no run dependency. */
    boot: function (FS, mount) {
      stats.booted++;
      try {
        if (FS && mount) { try { FS.mkdir(mount); } catch (e) {} }
        var doc = cfg.backend.read();
        if (!doc) return;
        var tree = parse(doc);
        if (!tree) { warn('stored document did not parse; starting clean'); return; }
        restoreTree(FS, tree);
        lastDoc = doc;
      } catch (e) {
        warn('boot failed: ' + e);
      }
    },

    /* Serialise the whole of /idbfs to text. Called on every flush the
       player asks for, and on its periodic sync tick. Writing only happens
       when something actually changed. */
    flush: function (FS, mount) {
      try {
        var tree = readTree(FS, mount || cfg.mount);
        if (!tree.files.length) return;
        tree.files = tree.files.concat(carriedHostedBlocks());
        var doc = serialize(tree, new Date().toISOString());
        stats.flushed++;
        if (doc === lastDoc) return;
        lastDoc = doc;
        stats.savedAt = new Date().toISOString();
        cfg.backend.write(doc);
        emit(doc);
      } catch (e) {
        warn('flush failed: ' + e);
      }
    },

    /* ── Setup and diagnostics ──────────────────────────────────────────── */

    /* Re-callable. A game page configures before its player starts, which is
       always after this file has already configured itself once — so a changed
       key has to move the backend with it, or the new game silently writes into
       whichever slot the previous configuration happened to pick. */
    configure: function (options) {
      options = options || {};
      var explicitBackend = options.backend;
      for (var k in options) if (options.hasOwnProperty(k)) cfg[k] = options[k];

      /* Name the slot off the game when the caller did not name one, so a game
         can never inherit another game's save by forgetting to pass a key.
         This is bookkeeping even when the caller brought its own backend: the
         name is what stats() and an inspector label the save with. */
      if (options.game && !options.key) cfg.key = 'plu:text:' + options.game;

      if (explicitBackend) {
        cfg.backend = explicitBackend;
        lastBackendKey = null;
      } else if (!cfg.backend || lastBackendKey !== cfg.key) {
        cfg.backend = localStorageBackend(cfg.key);
        lastBackendKey = cfg.key;
        lastDoc = null; // the cached document belonged to the old slot
        viewCache = null;
        viewCacheDoc = null;
      }
      return this;
    },

    stats: function () {
      return { game: cfg.game, key: cfg.key, mount: cfg.mount,
        booted: stats.booted, flushed: stats.flushed,
        fileWrites: stats.fileWrites,
        storeWrites: stats.storeWrites,
        savedAt: stats.savedAt, lastError: stats.lastError };
    },

    decodePrefs: decodePrefs,
    encodePrefs: encodePrefs,
    parse: parse,
    serialize: serialize,
    backends: { localStorage: localStorageBackend, memory: memoryBackend }
  };

  PluStore.configure({});
  global.PluStore = PluStore;
})(window);
