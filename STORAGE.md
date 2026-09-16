# PluStore — text save storage

PluStore is how a game in this catalogue saves its progress. Instead of each
engine writing to whatever browser storage it likes, the save is a **single
plain-text document** that the page owns, reads, and writes.

The reference implementation and working example is `snow-rider-3d`. Read
`games/snow-rider-3d/index.html` alongside this document.

- Engine: [`js/plustore.js`](js/plustore.js)
- Inspector page: [`games/snow-rider-3d/storage.html`](games/snow-rider-3d/storage.html)

---

## 1. Why

| | Engine-owned storage | PluStore |
|---|---|---|
| Format | opaque binary / engine internals | readable text |
| Where | one IndexedDB database per engine, shared by every game on the origin | one backend you choose, one document per game |
| Debugging | needs a devtools deep dive | read the document, or open the inspector page |
| Backup | not practical | copy a string |
| Editing | not practical | edit the text, reload, done |

Unity WebGL is the clearest case, and the reason this exists. A Unity build
mounts Emscripten's IDBFS over `/idbfs` and drops `PlayerPrefs` in there as a
binary blob (`UnityPrf\0` magic, length-prefixed entries). That data is real
but hostile: per-build MD5 directory names, no readable keys, and every Unity
game on the origin sharing one `/idbfs` store. PluStore decodes it to:

```
#plu-text-store 1
#game snow-rider-3d
#saved 2026-09-16T03:10:38.494Z
@dir /idbfs/38f7b574447025292645b04c764b759c
@unity-prefs /idbfs/38f7b574447025292645b04c764b759c/PlayerPrefs
header	00010000001000
AvailableTime	int	150
ControlMode	int	1
unity.cloud_player_id	str	a0c474d75ad0d88ae8fc0f854cc07440
@end
```

---

## 2. The contract

PluStore is not a general-purpose filesystem. It makes four promises, and a
game wired to it must keep them:

1. **The save is one text document.** Everything a game persists fits in it.
2. **The document only changes through `set()`.** No engine writes around it.
3. **A save can only be applied at boot.** A running game has already acted on
   the values it read, so applying an imported save means reloading the page.
4. **Writes are whole-document.** There is no per-key write path to the
   backing store; `setValue()` rewrites the document.

---

## 3. Quick start: connect a game

Four steps, whatever the engine.

### 3.1 Load the engine, before the game starts

The script must be present and configured *before* the game initialises, since
the game reads its save during startup.

```html
<script src="../../js/plustore.js"></script>
<script>PluStore.configure({ game: 'my-game', key: 'plu:text:my-game' });</script>
```

`game` is the label that lands in the document header, and it also names the
backend slot: omit `key` and the slot becomes `plu:text:<game>`. Pass `key` only
to point a game at a slot that already exists — two games that share a key share
one save and overwrite each other. `configure()` is re-callable, and calling it
again with a different `key` moves the backend with it, which matters because
that inline call always runs *after* the engine has already configured itself
once at load time.

### 3.2 Remove the old storage method

Do this **before** wiring the new one, or the two will write over each other.
See [section 5](#5-removing-the-old-storage-method) — it is a checklist, not a
suggestion.

### 3.3 Capture the save

Ask the engine for its save bytes and hand the whole thing to `set()`:

```js
PluStore.set(document);
```

Building that document is the only engine-specific part. For Unity the engine
does it for you (`flush`, see [section 6](#6-unity-webgl)), and for GameMaker
`PluStore.files` does (see [section 7](#7-gamemaker-html5)); for anything else
you serialise the engine's own storage into the format in
[section 4](#4-document-format).

### 3.4 Restore the save

Rebuild the engine's native storage from the document, then let the game start.
`PluStore.get()` returns the raw document; `PluStore.parse(doc)` turns it into a
tree of directories, `@unity-prefs` blocks, `@text` blocks and `@file` blocks.

```js
var tree = PluStore.parse(PluStore.get());
// walk tree.dirs / tree.files and write them back into the engine
```

Then reload the page so the game boots against the restored data.

### Adapters

Restoring is where engines differ, so it is worth being blunt about what
exists today:

| Engine | Adapter | Status |
|---|---|---|
| Unity WebGL | `PluStore.boot(FS, mount)` + `PluStore.flush(FS, mount)` | implemented, in use |
| GameMaker HTML5 (flat named files) | `PluStore.files.read/exists/has/write/ensure/remove` | implemented, in use |
| Anything else using `localStorage` | call `getValue` / `setValue` in place of `localStorage.getItem` / `setItem` | pattern, not implemented |
| Anything using `localforage` / Construct 3 IndexedDB | read the store, serialise into `@text` blocks | pattern, not implemented |

A new adapter needs exactly two functions: one that reads the engine's save and
returns a document, one that takes a document and rebuilds the engine's save.
Put them next to the engine hooks in `js/plustore.js`.

---

## 4. Document format

Line-oriented, tab-separated, versioned on the first line.

```
#plu-text-store 1          ← format version, required, must be line 1
#game snow-rider-3d        ← informational
#saved 2026-09-16T03:10Z   ← informational, rewritten on every save
@dir <path>                ← a directory to recreate
@unity-prefs <path>        ← a PlayerPrefs block
header	<hex>              ←   7 header bytes, preserved verbatim
<name>	int	<number>       ←   one line per entry
<name>	float	<number>     ←   a float is written as its exact decimal
<name>	str	<text>
@end
@text <path>               ← a file that is valid UTF-8, stored verbatim
<any number of lines>
@end
@base64 <path>             ← a file that is not UTF-8, stored losslessly
<base64, wrapped or not>
@end
@file <name>               ← one named file, for a host that keeps files flat
<the file's text, escaped onto a single line>
@end
```

Five rules matter:

- **Blocks end at a line reading exactly `@end`.** This is safe for `@text`
  blocks because a raw newline cannot occur inside JSON (it is escaped), and
  every file Unity keeps next to `PlayerPrefs` is JSON. `@file` blocks carry no
  such assumption: their body is escaped onto one line, so a save containing
  CRLF or even a line reading `@end` still cannot break a block open.
- **Tab is the field separator**, so `\`, tab, CR and LF are escaped inside
  fields (`\\`, `\t`, `\r`, `\n`). A reader must unescape; the engine does.
- **Binary files go to `@base64`, never to `@text`.** A UTF-8 decode turns
  every invalid byte into U+FFFD, so storing binary as text loses data the
  moment it is written back. The engine only emits `@text` when a decode is
  provably lossless, and falls back to base64 otherwise.
- **Unknown lines are ignored**, so a game may add its own directives.

`@base64` and `@text` blocks are how any engine stores anything that is not
Unity PlayerPrefs. A Construct save slot, a GameMaker save file, a JSON blob —
all of them become blocks keyed by whatever path or name you like. `@file` is
the same idea for an engine whose save is a *flat set of named files* rather
than a filesystem, and it is what [section 7](#7-gamemaker-html5) uses.

---

## 5. Removing the old storage method

The old method and PluStore cannot coexist: whichever writes last wins, and the
result is a save that looks fine and silently loses data. Remove all of it.

1. **Delete the old bridge script tag.** For three of the four converted games
   that was `<script src="../../js/sync.js"></script>`. Gone.
2. **Delete the engine's own persistence path.** For Unity that is the IDBFS
   mount — [section 6.3](#63-cut-the-indexeddb-persistence). Whatever the old
   path was, the game must stop writing there.
3. **Leave the old data alone.** Do not migrate it and do not delete it. The
   browser still holds it, it is inert, and if the new path turns out wrong the
   old save is still on disk to fall back on.
4. **Check `details.json`.** A truthy `cloudSync` for that game depended on the
   old bridge. `snow-rider-3d` is `false`, so nothing was lost — but a game set
   to `true` loses that capability unless the host is adapted to the text
   document.
5. **Verify nothing else still writes.** Open the game, play, and confirm the
   old store stops changing. For Unity that is the `indexedDB /idbfs` record
   count in [section 8](#8-verifying-a-conversion).

---

## 6. Unity WebGL

Two changes to the page, two changes to the build. That is the whole job.

### 6.1 Load PluStore before the player

In the game's `index.html`, ahead of the loader:

```html
<head>
  <script src="../../js/plustore.js"></script>
  <script>PluStore.configure({ game: 'snow-rider-3d', key: 'plu:text:snow-rider-3d' });</script>
</head>
```

Ordering is not optional. The player reads `PlayerPrefs` while it boots, so
`PluStore` must exist before `UnityLoader.instantiate` runs.

### 6.2 Find the patch points in the build

A Unity build ships two scripts; only the second needs touching:

```
Build/UnityLoader.js                              ← loader; leave alone
Build/<name>.wasm.framework.unityweb.js           ← player glue; patch this
```

The framework file is minified onto a handful of enormous lines. Find the two
spots by searching for these markers:

```bash
grep -o 'FS.mount(IDBFS'        Build/*.wasm.framework.unityweb.js   # the mount
grep -o 'FS.syncfs'             Build/*.wasm.framework.unityweb.js   # the flush
grep -o '_JS_FileSystem_Sync'   Build/*.wasm.framework.unityweb.js   # the flush
```

Both patch points are exact string replacements. There are no line numbers to
follow — the file is minified onto a few enormous lines.

**The surrounding text differs by Unity version**, so grep for the *shape* of
the code, not for one exact snippet. Two variants are known to be in this
catalogue:

| | Unity 2018 (Snow Rider 3D) | Unity 2019+ (10 Minutes Till Dawn) |
|---|---|---|
| boot | `FS.mount(IDBFS,{},…)` then `FS.syncfs(true,…)` | identical |
| flush call | `_JS_FileSystem_Sync()` | identical |
| tick | `_JS_FileSystem_SetSyncInterval(ms)` | `_JS_FileSystem_Initialize()`, which registers the same timer itself via `Module.setInterval(…, fs.syncInternal)` |
| `fs` literal | `sync:(…)` with `numPendingSync` | same, plus a `syncInternal` period field |
| boot wrapper | bare `Module["preRun"].push(…)` | the same push, wrapped in an `if(typeof ENVIRONMENT_IS_PTHREAD==="undefined"||!ENVIRONMENT_IS_PTHREAD){…}` guard |

Replace only the `push(...)` statement and leave any `ENVIRONMENT_IS_PTHREAD`
wrapper in place — it gates the whole filesystem step, not just this part.

**Builds split into `.partN` chunks.** 10 Minutes Till Dawn ships its framework
as `…wasm.framework.unityweb.part1` and its page merges the parts into a blob at
runtime. Patch the part file that *contains the glue*, not a file that does not
exist — `.part1` here is the whole framework.

### 6.3 Cut the IndexedDB persistence

Two replacement sites. In each, the parts being replaced only depend on
PluStore being on `window`, so the patch is the same for every Unity build; only
white space differs.

**Site 1 — the boot mount.** Find the `preRun` step that mounts IDBFS and
replaces it with a synchronous seed. This is the *original*:

```js
Module["preRun"].push((function(){var unityFileSystemInit=Module["unityFileSystemInit"]||(function(){if(!Module.indexedDB){console.log("IndexedDB is not available. Data will not persist in cache and PlayerPrefs will not be saved.")}FS.mkdir("/idbfs");FS.mount(IDBFS,{},"/idbfs");Module.addRunDependency("JS_FileSystem_Mount");FS.syncfs(true,(function(err){Module.removeRunDependency("JS_FileSystem_Mount")}))});unityFileSystemInit()}));
```

and this is the replacement:

```js
Module["preRun"].push((function(){var unityFileSystemInit=Module["unityFileSystemInit"]||(function(){var P=typeof window!=="undefined"&&window.PluStore;FS.mkdir("/idbfs");if(P)P.boot(FS,"/idbfs")});unityFileSystemInit()}));
```

Two things changed and both matter. `FS.mount(IDBFS, …)` and `FS.syncfs(true, …)`
are gone — `/idbfs` is now an ordinary in-memory directory. And the
`addRunDependency` / `removeRunDependency` pair is gone, because seeding from a
string is synchronous and needs no run dependency held open.

**Site 2 — the flush.** Find the `fs` helper and the two exported functions that
call it:

```js
var fs={numPendingSync:0,syncIntervalID:0,syncInProgress:false,sync:(function(onlyPendingSync){if(onlyPendingSync){if(fs.numPendingSync==0)return}else if(fs.syncInProgress){fs.numPendingSync++;return}fs.syncInProgress=true;FS.syncfs(false,(function(err){fs.syncInProgress=false}));fs.numPendingSync=0})};function _JS_FileSystem_SetSyncInterval(ms){if(!Module.indexedDB)return;fs.syncIntervalID=window.setInterval((function(){fs.sync(true)}),ms)}function _JS_FileSystem_Sync(){if(!Module.indexedDB)return;fs.sync(false)}
```

Replace it with:

```js
var fs={numPendingSync:0,syncIntervalID:0,syncInProgress:false,sync:(function(onlyPendingSync){var P=typeof window!=="undefined"&&window.PluStore;if(P)P.flush(FS,"/idbfs")})};function _JS_FileSystem_SetSyncInterval(ms){fs.syncIntervalID=window.setInterval((function(){fs.sync(true)}),ms)}function _JS_FileSystem_Sync(){var P=typeof window!=="undefined"&&window.PluStore;if(P)P.flush(FS,"/idbfs")}
```

Three details:

- **Both `if(!Module.indexedDB) return;` guards must go.** They gate on a
  capability probe the loader runs at startup. Leaving them in means the flush
  silently never happens in any browser where that probe fails.
- **`_JS_FileSystem_SetSyncInterval` must keep registering its interval.** That
  timer is the periodic save tick; only the gate in front of it was wrong.
- **The counter fields are kept but unused.** They tracked overlapping IDBFS
  syncs. `flush` is synchronous and deduplicates internally, so there is nothing
  to serialise.

`IDBFS` itself stays defined in the file. That is deliberate: it is unreachable
dead code once nothing mounts it or calls `FS.syncfs`, and deleting it is a much
larger, riskier edit for no benefit.

### 6.4 What the page then does

The game's own code changes not at all. `PlayerPrefs.SetInt("Best", 42)` in C#
still writes the same file at the same path; PluStore just owns where that file
lives:

```
boot   preRun → PluStore.boot(FS, "/idbfs")  → decode document → write PlayerPrefs bytes into memory
play   the player reads and writes /idbfs freely, entirely in memory
save   PlayerPrefs.Save()/_JS_FileSystem_Sync → flush → walk /idbfs → encode to text → backend
```

`flush()` walks the whole mount, re-reads every file, and writes only when the
produced text differs from the last document. There is nothing to configure: the
per-build MD5 directory name is whatever the player created, and the document
records the real paths it found.

### 6.5 Applying an imported save

Restoring happens at boot only, so an import is two steps — `PluStore.set(doc)`
and then reload the frame. `games/snow-rider-3d/storage.html` does exactly this
and is the model to copy for another game.

---

## 7. GameMaker HTML5

A GameMaker Studio 2 HTML5 export keeps its save in `localStorage`, but not
under the game's own file names: every local file is one entry keyed
`<sanitised game guid>.<version>.<name>`. An `.ini` is one entry, a `.json`
another, and `file_text_*`, `ini_*`, `file_exists`, `file_delete` and the
`file_ensure_js` extension are all views onto that one flat map of name to
string. There is no filesystem to mount and no flush to hook, so this conversion
is smaller than the Unity one: each name becomes an `@file` block, and
`PluStore.files` is everything the runner needs.

`bacon-may-die` is the worked example. It keeps seven files: `items.json`,
`pig.ini`, `missions.json`, `mods_bmd_custom.ini` and three per-mode
`save_*.ini`.

### 7.1 Load PluStore before the runner

In the game's `index.html`, ahead of the runner script:

```html
<head>
  <script src="../../js/plustore.js"></script>
  <script>PluStore.configure({ game: 'bacon-may-die', filePrefix: 'BaconMayDiebySnoutUp.0.' });</script>
</head>
```

The runner starts on `window.onload` (`GameMaker_Init`), so a classic script tag
in the head is early enough. There is no boot hook to call, because nothing has
to be in place before the engine reads a file — a read is just a function call.
`filePrefix` is the host's own storage prefix; [section 7.5](#75-the-storage-prefix)
explains why it has to be named.

### 7.2 The four functions that are the whole file layer

Everything goes through `html5game/<Game>.js`, minified onto a handful of
enormous lines. The function names are minified and differ per build; the bodies
are what is stable. Find them by shape:

```bash
grep -o 'window.localStorage\[_794' html5game/*.js          # the only writer
grep -o 'window.localStorage\[_794(_uj6)\]' html5game/*.js  # the only reader
grep -o "localStorage\['removeItem'\]" html5game/*.js      # the only deleter
grep -o 'window.localStorage\[name\]' html5game/*.js       # the exists test
```

Four exact string replacements, each independent of the others. Only the
`localStorage` half of each body is replaced; the remote-file branches stay.

**Write.** The old body stores the file under the prefixed key:

```js
function _294(_Bz4,_Rf4){if(_Tj6){return false}else if(_694){try{window.localStorage[_794(_Bz4)]=_Rf4;return true}catch(_894){return false}}}
```

```js
function _294(_Bz4,_Rf4){try{return PluStore.files.write(_Bz4,_Rf4)}catch(_894){return false}}
```

**Read.** Both `file_text_open_read` and `buffer_load` come through here, so
the file map is the single source for the game's data:

```js
if(_Tj6){return null}else if(_694){
try{_yT3=window.localStorage[_794(_uj6)]}catch(_894){return null}if((_yT3==undefined)||(_yT3==null))return null}
```

```js
{
try{_yT3=PluStore.files.read(_uj6)}catch(_894){return null}if((_yT3==undefined)||(_yT3==null))return null}
```

**Exists.** `file_exists` and the internal `file_text_open_read` guard both call
this:

```js
if(_Tj6){return false}else if(_694){try{var name=_794(_uj6);if(window.localStorage[name]&&(window.localStorage[name]!==undefined)){return true}return false}
catch(_894){return false}}
```

```js
{try{if(PluStore.files.exists(_uj6)){return true}return false}
catch(_894){return false}}
```

**Delete.** `file_delete` and the `file_copy` helper both call this:

```js
function _mn(_Y84){if(_694){try{window.localStorage['removeItem'](_794(yyGetString(_Y84)));return true}catch(_894){return false}}return false}
```

```js
function _mn(_Y84){try{return !!PluStore.files.remove(yyGetString(_Y84))}catch(_894){return false}}
```

Two of those bodies wrap onto a second line mid-expression, and the snippets
above keep the wrap rather than closing it up as a single line. That is not
cosmetic: reproduce it in the replacement, or the vendored file gains two
spurious whitespace changes that a reviewer will stop to wonder about. The
runner's line count should be unchanged by the patch, and `git diff` should show
only these four sites — 3 lines changed, 3 inserted, for `bacon-may-die`.

**And the extension.** `file_ensure_js` lives in its own file,
`html5game/xph_file_ensure.js`, loaded by the runner as a script tag, and writes
to the same prefixed keys behind the runner's back. It writes a default only
when the key is absent, so the read-modify-write pair matches that:

```js
        if (localStorage.getItem(path) == null) {
            localStorage.setItem(path, content);
```

```js
        if (!PluStore.files.has(path)) {
            PluStore.files.write(path, content);
```

After the four replacements, `grep -c localStorage html5game/<Game>.js` still
finds three or four hits. They are capability probes (`('localStorage' in
window)`), the Chrome-packaged-app check, and a debug console's `hasLocalStorage`
test. None of them read or write a game file; leave them alone.

### 7.3 Semantics worth preserving on purpose

`PluStore.files` is not a thin `localStorage` wrapper, and two verbs differ on
purpose, because changing them changes the game:

- **`exists` is the value's truthiness, not the name's presence.** The runner
tests `window.localStorage[name] && …`, so a stored-but-empty file answers
`false` to `file_exists` while `read()` still returns `''`. `bacon-may-die`
stores two empty files (`missions.json`, `mods_bmd_custom.ini`) and its startup
logic depends on that distinction.
- **`has` is the presence test**, because `file_ensure_js` compares against
`null`. That is what makes `ensure` write an empty default exactly once.

`remove` returns `true` whether or not the name was there, matching
`removeItem`, which never complained about a missing key.

### 7.4 Whole-file writes, one document

Unlike Unity there is no flush to wait for: the runner writes a file when the
game closes it (`file_text_close`, `ini_close`) and `PluStore.files` serialises
the whole map to the document at that moment. In `bacon-may-die` that is seven
document writes per boot, at a document size of about 4.5 KB.

Reads are cached against the document text, so a boot that reads seven files
parses once and not seven times.

### 7.5 The storage prefix

The runner builds its keys as `<prefix><name>` through one helper, `_794(path)`,
where the prefix is `<sanitised guid>.<version>.` (`BaconMayDiebySnoutUp.0.` for
this build). The four primitives are handed the *bare* name and 
prefix it themselves; `file_ensure_js` is handed an already-prefixed name by its
GML caller. `filePrefix` normalises both, so the document is keyed by the file
names the game itself uses and the prefix never reaches the save.

It is one string in the page, and it is the one thing here that is coupled to
the build: a new game guid or version means editing that line. The alternative —
keying the document by the prefixed name — would put a guid and a build number
inside the save file.

---

## 8. Verifying a conversion

Do all five. The first two catch a patch that silently did nothing, which is the
failure mode that looks like success.

1. **The document appears.** `localStorage` holds one key, and it is readable
   text: `localStorage.getItem('plu:text:<game>')`.
2. **The old store is untouched.** With the game open, check the old location.
   For GameMaker that means no key in `localStorage` starts with the runner's
   prefix any more:

   ```js
   Object.keys(localStorage).filter(function (k) {
     return k.indexOf('BaconMayDiebySnoutUp.0.') === 0;
   });   // → []
   ```

   Clear those keys once by hand first, or a boot from before the patch leaves
   them behind and the check passes for the wrong reason.

   For Unity it must be zero records:

   ```js
   indexedDB.open('/idbfs').onsuccess = function (e) {
     var db = e.target.result;
     db.transaction(['FILE_DATA']).objectStore('FILE_DATA').count().onsuccess =
       function (ev) { console.log('old store records:', ev.target.result); };
   };
   ```

3. **A value round-trips.** Play, note a value, reload, and confirm it survived.
   For Unity, `unity.player_session_count` increments once per boot — a clean,
   zero-effort check that the player really read the seeded file rather than
   starting fresh. For GameMaker, clear the save and boot again: a game whose
   defaults are deterministic reproduces them byte-for-byte, which is what
   `bacon-may-die` does across all seven files.
4. **A hand-edited value reaches the game.** Change a stored value, reload, and
   confirm the game read it. Re-installs and re-defaults mean the seed did not
   parse.
5. **No errors.** `PluStore.stats().lastError` is `null` after a boot and a save.

---

## 9. Inspecting a save

Every converted game has one, and they take the shape the engine needs:

- `games/snow-rider-3d/storage.html`, `10-minutes-till-dawn`, `backrooms-3d` —
  the decoded PlayerPrefs table, the file tree, and the raw document.
- `games/bacon-may-die/storage.html` — the file list (name, type, size, first
  line), a decoded view of the selected file (an `.ini` as key/value rows, a
  `.json` pretty-printed), and the raw document.

All of them frame the game beside a live panel with Copy, Export `.txt`, Import,
Reload and Reset, and all of them listen for the `postMessage` that every write
broadcasts, so the panel updates as the game saves.

To reuse one for another game, copy the page and change two things: the iframe
`src`, and the `PluStore.configure` call.

---

## 10. Backends

The document is a string, and where it lives is a separate decision. A backend
is any object with three methods:

```js
PluStore.backend = {
  read:  function () { /* → string | null */ },
  write: function (text) { /* persist */ },
  clear: function () { /* remove */ }
};
```

Two ship with the engine: `PluStore.backends.localStorage(key)` (the default —
one key, plain text) and `PluStore.backends.memory()` (nothing persisted; useful
for tests and for a save that should die with the tab). Point it at a file, a
host API, or a remote endpoint by writing your own — nothing else in the engine
needs to change.

---

## 11. Reference

### API

| Call | Does |
|---|---|
| `configure({game, key, mount, filePrefix, backend})` | set up before the game loads |
| `get()` | the whole save as a string |
| `set(doc)` | validate, store, and broadcast a document |
| `list()` | `[{path, kind, keys}]` for every file in the save |
| `files.read(name)` / `files.write(name, text)` | one named file, for a flat file host |
| `files.exists(name)` / `files.has(name)` | non-empty? / present at all? |
| `files.ensure(name, text)` | write a default only if absent |
| `files.remove(name)` | delete it |
| `files.list()` / `files.names()` | `[{name, size}]` / sorted names |
| `prefs()` | the first PlayerPrefs block, decoded |
| `getValue(name)` / `setValue(name, value, type)` | read/write one PlayerPrefs entry |
| `clear()` | drop the save |
| `on(cb)` / `off(cb)` | subscribe to changes |
| `stats()` | `{game, key, mount, booted, flushed, savedAt, lastError}` |
| `boot(FS, mount)` / `flush(FS, mount)` | Unity hooks, called from the patched player |

### PlayerPrefs binary layout

Relevant only when reading a capture by hand:

```
"UnityPrf\0"        9 bytes
header              7 bytes, preserved verbatim (00 01 00 00 00 10 00)
then repeated:
  uint8  nameLength
  bytes  name, UTF-8
  uint8  type         0xFE = int32 little-endian follows
                      0xFD = float32 little-endian follows
                      otherwise the byte is the byte length of a string
  bytes  value
```

The value byte is a type tag, and 0xFE and 0xFD are reserved for it — so a
string value has to stay under 0xFD (252 bytes) or it cannot be told apart from
a float. The encoder enforces that and says so rather than writing an ambiguous
file. A build that writes floats is not exotic: 10 Minutes Till Dawn stores its
`MusicVolume` and `SFXVolume` settings as floats, which is why the codec has to
handle both tags. A build that only ever wrote ints (Snow Rider 3D, Unity 2018)
decodes identically with or without float support.

`PluStore.encodePrefs(PluStore.decodePrefs(bytes))` returns the original bytes
unchanged, header included. The seven header bytes are carried through rather
than interpreted — their meaning is internal to the player, and preserving them
is what makes a re-encode safe to hand back.

---

## 12. Known limits

- **Whole-document writes.** Every save rewrites the entire document. Fine for
  the few kilobytes a PlayerPrefs file holds; a game with a multi-megabyte save
  wants chunking first.
- **`flush()` re-reads everything.** It walks the mount and decodes every file
  on each sync tick — roughly 130 times per boot for Snow Rider 3D. It is free
  at 222 bytes of prefs, but a large save should compare size and mtime before
  decoding.
- **The patched framework file no longer matches upstream.** In Snow Rider 3D,
  `Build/SnowRider3D-gd-1.wasm.framework.unityweb.js` went from 514248 to 513912
  bytes. Re-downloading it from the CDN silently undoes the conversion.
- **Unity's loader still creates two empty databases.** `UnityLoader.js` opens a
  `/idbfs-test` capability probe and a `UnityCache` for its download cache. No
  game data goes near either, but they are IndexedDB activity if the goal is
  zero IndexedDB.
- **Nothing is migrated.** A game converted from the old bridge starts from a
  clean save unless you import it by hand.
- **A hosted file map rewrites the document per file.** Every
  `PluStore.files.write` re-serialises the whole save. At the few kilobytes these
  games keep that is free; a game with a large save wants batching.
- **GameMaker cannot list its own files.** HTML5 stubs `file_find_first` and the
  `directory_*` functions out, so no game code can enumerate the save through
  `PluStore.files.list()`. That is an inspector-level view, not an engine one.
- **The runner patch is per-build.** The four bodies [section 7.2](#72-the-four-functions-that-are-the-whole-file-layer)
  replaces are minified and can change between GameMaker versions. They are
  small and greppable, but a re-export means re-checking them, the same way a
  re-downloaded Unity framework file silently undoes a Unity conversion.
- **The inspector is same-origin only.** The panel reads the backend directly,
  so a cross-origin game frame would need the `postMessage` path only.

---

*Pluto GCDN — 9/16/2026*
